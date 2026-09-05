/* =============================================================================
   018_modulo_validar_cambio_tipo_io.sql — SIEI
   Recrea TR_modulo_generar_canales (001_initial_schema.sql) para rechazar
   un cambio de catalogo_modulo_id que cambie el TIPO DE E/S (tipo_io_id) de
   un módulo que ya tiene canales con señal activa.

   CONTEXTO / DECISION DE NEGOCIO (aprobada explícitamente por el usuario,
   sesión de trabajo sobre la sección CONTROL — hallazgo real usando la
   pantalla de gabinetes):

   - El trigger original (001) solo protege la CANTIDAD de canales: si
     bajas canales_max y algún canal que quedaría fuera de rango tiene
     señal activa, rechaza (error 51001). Pero NUNCA valida el TIPO de
     E/S — cambiar el catálogo de un módulo DI a uno DO (o AI a AO, etc.)
     con la MISMA cantidad de canales pasa esa validación sin problema,
     porque ningún canal queda "fuera de rango". El usuario lo encontró
     directamente en la UI: "no puedes cambiar el módulo por un módulo de
     otro tipo... porque las señales ya están destinadas para DI o DO".

   - Nunca se llega a esta migración desde `nucleo.senal` — el trigger que
     valida canal/ruta de la señal (TR_senal_validar_canal_ruta) solo
     reacciona a cambios en la propia fila de SEÑAL (canal_id/activo/
     dueño), no a un cambio en `nucleo.modulo.catalogo_modulo_id`. El
     único lugar donde este cambio de tipo realmente ocurre es acá.

   - Se agrega un chequeo temprano, ANTES de generar/desactivar canales:
     si el catalogo_modulo_id de un módulo EXISTENTE (no una fila nueva)
     cambió a otro con tipo_io_id DISTINTO, y ese módulo tiene aunque sea
     un canal activo con señal activa, se rechaza TODO el cambio — mismo
     principio de "resources in use cannot be deactivated/reassigned" que
     ya usa el resto de SIEI. Un módulo SIN señales activas puede seguir
     cambiando de tipo libremente (ej. corregir un tipo mal elegido antes
     de cablear nada).

   El resto del trigger queda BYTE-IDÉNTICO al original (verificado a
   mano contra 001_initial_schema.sql) — solo se agrega el bloque nuevo
   justo después de calcular @max_canales.
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

DROP TRIGGER nucleo.TR_modulo_generar_canales;
GO

-- -----------------------------------------------------------------------------
-- 7.1 TR_modulo_generar_canales
--     Genera canales faltantes y desactiva/bloquea los sobrantes al reducir
--     canales_max. Solo actúa sobre módulos NUEVOS o cuyo catalogo_modulo_id
--     cambió REALMENTE de valor (no solo "participó" en el UPDATE).
--     FIX #3: un numero_canal cuenta como "ya existente" solo si tiene una
--     fila ACTIVA — una fila histórica inactiva no bloquea la regeneración
--     al reexpandir capacidad (16 -> 8 -> 16 genera una fila NUEVA para
--     CH08..CH15, sin reactivar ni alterar la fila histórica).
--     FIX #5: sin techo artificial de 256 — la recursión se acota al máximo
--     canales_max realmente presente en el lote (@max_canales), no a un
--     número inventado; OPTION (MAXRECURSION 0) deja que esa cota dinámica
--     sea la única frontera.
--     MIGRACIÓN 018: nuevo guard temprano — un cambio de catalogo_modulo_id
--     que además cambia tipo_io_id se rechaza si el módulo ya tiene un
--     canal activo con señal activa (antes solo se protegía la CANTIDAD de
--     canales, nunca el TIPO).
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_modulo_generar_canales ON nucleo.modulo
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(catalogo_modulo_id) RETURN;  -- filtro barato: ¿participó la columna?

    DECLARE @max_canales SMALLINT;
    SELECT @max_canales = MAX(cmi.canales_max)
    FROM inserted i
    LEFT JOIN deleted d ON d.id = i.id
    JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
    WHERE d.id IS NULL OR d.catalogo_modulo_id <> i.catalogo_modulo_id;

    IF @max_canales IS NULL RETURN;  -- ningún módulo cambió realmente de catálogo

    -- MIGRACIÓN 018: cambio de TIPO de E/S con canales en uso — rechazo
    -- temprano, antes de tocar ningún canal. Solo aplica a filas que YA
    -- existían (INNER JOIN a deleted) — un módulo nuevo (INSERT) nunca
    -- tiene canales todavía, así que nunca puede violar esto.
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN cat.cat_modulo_io old_cmi ON old_cmi.id = d.catalogo_modulo_id
        JOIN cat.cat_modulo_io new_cmi ON new_cmi.id = i.catalogo_modulo_id
        WHERE old_cmi.tipo_io_id <> new_cmi.tipo_io_id
          AND EXISTS (
              SELECT 1
              FROM nucleo.canal ch
              JOIN nucleo.senal s ON s.canal_id = ch.id AND s.activo = 1
              WHERE ch.modulo_id = i.id AND ch.activo = 1
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51035, 'No se puede cambiar el tipo de E/S del modulo: tiene canales con senal activa.', 1;
    END

    ;WITH cambios AS (
        -- filtro real: fila nueva, o catalogo_modulo_id cambió de valor de verdad
        SELECT i.id AS modulo_id, i.proyecto_id, i.catalogo_modulo_id
        FROM inserted i
        LEFT JOIN deleted d ON d.id = i.id
        WHERE d.id IS NULL
           OR d.catalogo_modulo_id <> i.catalogo_modulo_id
    ),
    afectados AS (
        SELECT c.modulo_id, c.proyecto_id, cmi.canales_max
        FROM cambios c
        JOIN cat.cat_modulo_io cmi ON cmi.id = c.catalogo_modulo_id
    ),
    numeros AS (
        -- FIX punto 1: ancla y miembro recursivo deben tener el MISMO tipo;
        -- INT evita el choque de tipos anchor(SMALLINT) vs recursivo(n+1 => INT).
        -- numero_canal en la tabla sigue siendo SMALLINT; la conversión al
        -- insertar es segura porque num.n siempre queda acotado por canales_max.
        SELECT CAST(0 AS INT) AS n
        UNION ALL
        SELECT n + 1 FROM numeros WHERE n + 1 < @max_canales
    )
    INSERT INTO nucleo.canal (proyecto_id, modulo_id, numero_canal, activo)
    SELECT a.proyecto_id, a.modulo_id, num.n, 1
    FROM afectados a
    CROSS JOIN numeros num
    WHERE num.n < a.canales_max
      AND NOT EXISTS (
          -- FIX #3: solo una fila ACTIVA cuenta como "ya existe" para este numero_canal
          SELECT 1 FROM nucleo.canal ch
          WHERE ch.modulo_id = a.modulo_id AND ch.numero_canal = num.n AND ch.activo = 1
      )
    OPTION (MAXRECURSION 0);

    IF EXISTS (
        SELECT 1
        FROM nucleo.canal ch
        JOIN inserted i ON i.id = ch.modulo_id
        JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
        JOIN nucleo.senal s ON s.canal_id = ch.id AND s.activo = 1
        WHERE ch.numero_canal >= cmi.canales_max AND ch.activo = 1
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51001, 'No se puede reducir la capacidad del modulo: hay canales fuera de rango con senal activa.', 1;
    END

    UPDATE ch SET ch.activo = 0
    FROM nucleo.canal ch
    JOIN inserted i ON i.id = ch.modulo_id
    JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
    WHERE ch.numero_canal >= cmi.canales_max AND ch.activo = 1;
END
GO


COMMIT TRANSACTION;
GO
