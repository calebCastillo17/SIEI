/* =============================================================================
   024_modulo_plano_conexionado.sql — SIEI

   Agrega nucleo.modulo.plano_id (FK compuesta nullable -> nucleo.plano):
   "en qué plano de conexionado está dibujado este módulo/slot". Pedido
   explícito del usuario para poder planificar, antes de que exista el
   dibujo real, qué módulos van a quedar documentados en cada plano
   ("estos cuatro slots van en tal plano, los siguientes en este otro").

   Evidencia real que respalda el diseño (columna PLANO_GANCHO del Excel
   02_MASTER_IO_620.xlsm, hoja SENALES — ver docs/DIAGNOSTICO_SENALES_
   GABINETES.md sección 35, donde esta columna ya había sido evaluada y
   dejada pendiente a propósito): de 39 módulos reales con al menos una
   señal con PLANO_GANCHO, los 39 tienen un ÚNICO valor de PLANO_GANCHO
   consistente en todas sus señales (nunca dos señales del mismo módulo
   apuntan a planos distintos) — confirma que la unidad natural de
   asignación es el MÓDULO, no la señal. Y un mismo plano agrupa varios
   módulos (ej. 620-J-20037 documenta 4 módulos — SLOT-11/12/13/14 — en
   un solo plano), confirmando el caso de uso del usuario con datos reales.

   Por eso el campo va en nucleo.modulo (no en nucleo.senal, que hubiera
   calcado PLANO_GANCHO literalmente pero obligaría a asignar señal por
   señal en vez de una sola vez por módulo, y arriesgaría inconsistencia
   dentro de un mismo módulo).

   Regla de negocio confirmada con el usuario: todos los módulos
   asignados a un mismo plano deben pertenecer al MISMO gabinete (un
   plano de conexionado documenta físicamente un solo gabinete) — se
   enforcea en TR_modulo_validar_plano_gabinete (dura, sin excepción,
   error 51036), no solo advertida en el frontend.

   Como consecuencia querida por el usuario ("finalmente quedará como un
   RIO que tiene muchos planos asignados"), el mismo trigger auto-asocia
   (o reactiva) la fila correspondiente en nucleo.gabinete_plano la
   primera vez que se asigna un módulo de ese gabinete a un plano — nunca
   hace falta asociar el gabinete a mano por separado para este caso.
   gabinete_plano se mantiene igual de manual para los planos que no
   bajan a nivel de módulo (LAYOUT, UNIFILAR, etc.). Quitar la asignación
   de un módulo (plano_id -> NULL) NO desasocia gabinete_plano — puede
   haber otros módulos del mismo gabinete todavía usando esa asociación;
   se deja al usuario quitarla a mano desde el plano si ya no aplica.
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

ALTER TABLE nucleo.modulo
    ADD plano_id BIGINT NULL;
GO

ALTER TABLE nucleo.modulo
    ADD CONSTRAINT FK_modulo_plano FOREIGN KEY (plano_id, proyecto_id)
        REFERENCES nucleo.plano (id, proyecto_id);
GO

COMMIT TRANSACTION;
GO


/* ============================================================================
   TR_modulo_validar_plano_gabinete
   ----------------------------------
   Se dispara solo cuando plano_id participa en el INSERT/UPDATE
   (UPDATE(plano_id) devuelve TRUE tanto para INSERT como para UPDATE que
   toquen esa columna — evita trabajo de más en los PATCH de tag/
   surgeProtectorTag/catalogoModuloId que no tocan plano_id).

   1. Para cada módulo afectado con plano_id NO NULO, resuelve su
      gabinete real (modulo -> slot -> rack -> gabinete).
   2. Si ya existe otro módulo ACTIVO con el MISMO plano_id pero de un
      gabinete DISTINTO, rechaza (51036) — sin excepción, ver comentario
      de cabecera.
   3. Si pasa la validación, auto-asocia (o reactiva) la fila
      (gabinete_id, plano_id) en nucleo.gabinete_plano — set-based, sin
      cursor, mismo patrón que el resto de triggers de este archivo.
   ============================================================================ */

CREATE TRIGGER nucleo.TR_modulo_validar_plano_gabinete
ON nucleo.modulo
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(plano_id)
        RETURN;

    DECLARE @modulos_afectados TABLE (
        id           BIGINT NOT NULL,
        proyecto_id  BIGINT NOT NULL,
        plano_id     BIGINT NOT NULL,
        gabinete_id  BIGINT NOT NULL
    );

    INSERT INTO @modulos_afectados (id, proyecto_id, plano_id, gabinete_id)
    SELECT i.id, i.proyecto_id, i.plano_id, r.gabinete_id
    FROM inserted i
    JOIN nucleo.slot s ON s.id = i.slot_id
    JOIN nucleo.rack r ON r.id = s.rack_id
    WHERE i.plano_id IS NOT NULL;

    IF EXISTS (
        SELECT 1
        FROM @modulos_afectados ma
        JOIN nucleo.modulo m2
            ON m2.plano_id = ma.plano_id
           AND m2.proyecto_id = ma.proyecto_id
           AND m2.activo = 1
           AND m2.id <> ma.id
        JOIN nucleo.slot s2 ON s2.id = m2.slot_id
        JOIN nucleo.rack r2 ON r2.id = s2.rack_id
        WHERE r2.gabinete_id <> ma.gabinete_id
    )
    BEGIN
        THROW 51036, 'Todos los modulos asignados a un mismo plano deben pertenecer al mismo gabinete.', 1;
    END;

    UPDATE gp
        SET gp.activo = 1, gp.updated_at = SYSUTCDATETIME()
    FROM nucleo.gabinete_plano gp
    JOIN (SELECT DISTINCT gabinete_id, plano_id, proyecto_id FROM @modulos_afectados) ma
        ON ma.gabinete_id = gp.gabinete_id
       AND ma.plano_id = gp.plano_id
       AND ma.proyecto_id = gp.proyecto_id
    WHERE gp.activo = 0;

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id, activo, created_at)
    SELECT DISTINCT ma.proyecto_id, ma.gabinete_id, ma.plano_id, 1, SYSUTCDATETIME()
    FROM @modulos_afectados ma
    WHERE NOT EXISTS (
        SELECT 1 FROM nucleo.gabinete_plano gp
        WHERE gp.gabinete_id = ma.gabinete_id
          AND gp.plano_id = ma.plano_id
          AND gp.proyecto_id = ma.proyecto_id
    );
END;
GO
