/* =============================================================================
   026_bloque_terminal_dueno_equipo.sql — SIEI

   Agrega EQUIPO como cuarto dueño posible de nucleo.bloque_terminal (junto
   a caja/gabinete/modulo, migración 015) — pedido explícito del usuario al
   modelar el "ruteo" de Control: no siempre lo que sigue después del
   RIO/gabinete es una caja real. A veces el cable de campo llega
   directamente al panel/tablero PROPIO de un equipo (ej. "620-AFM-5005",
   el armario de un variador) — un panel que necesita su propio TB con
   bornes reales, exactamente el mismo rol físico que cumple una caja, pero
   sin ser una caja: es un nucleo.equipo (catálogo curado a mano, migración
   007), nunca una nucleo.caja.

   Rechazado explícitamente por el usuario: modelar estos paneles como
   filas de nucleo.caja (aunque hubiera evitado este cambio de esquema,
   reutilizando toda la infraestructura de bornes ya construida) — "la
   idea es que no sea una caja en sí". Se opta por extender el esquema en
   vez de forzar el dato a encajar en un concepto que no es.

   Alcance: exactamente el mismo patrón que ya existe para caja/gabinete/
   modulo — columna nullable, XOR de 4 vías (antes 3), FK compuesta,
   índice único filtrado de código por dueño. Los dos triggers que ya
   distinguían los 3 dueños existentes se extienden (no se reemplazan) para
   reconocer también equipo:
     - TR_terminacion_validar_propietario_y_canal (015): su chequeo (a) ya
       tenía "OR (pto.equipo_id IS NOT NULL)" — un rechazo INCONDICIONAL de
       cualquier extremo cuyo punto_conexion fuera un equipo, porque hasta
       ahora bloque_terminal no podía pertenecer a uno. Se reemplaza por la
       misma comparación que ya usan caja/gabinete/modulo (el equipo del
       punto_conexion debe coincidir con el equipo_id del bloque_terminal).
     - TR_bloque_terminal_validar_plano_dueno (025): la comparación "mismo
       dueño para el mismo plano" debe incluir equipo_id — sin este cambio,
       dos bloques de EQUIPOS DISTINTOS pero ambos con caja_id/gabinete_id/
       modulo_id en NULL se verían como "el mismo dueño" por accidente.
       Mismo criterio que con módulo (migración 025): no se agrega
       auto-asociación (no existe una tabla nucleo.equipo_plano) — es
       simple simetría de esquema, no un caso de uso pedido todavía.

   El chequeo (b) de TR_terminacion_validar_propietario_y_canal (número de
   canal del catálogo) no cambia: solo aplica a bloques de MODULO, ajeno a
   este cambio.
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

ALTER TABLE nucleo.bloque_terminal
    ADD equipo_id BIGINT NULL;
GO

ALTER TABLE nucleo.bloque_terminal
    ADD CONSTRAINT FK_bloque_terminal_equipo FOREIGN KEY (equipo_id, proyecto_id)
        REFERENCES nucleo.equipo (id, proyecto_id);
GO

-- El CHECK viejo (3 vías) no se puede "ALTER" en SQL Server — se elimina
-- y se recrea con las 4 vías, mismo nombre de constraint.
ALTER TABLE nucleo.bloque_terminal
    DROP CONSTRAINT CK_bloque_terminal_pertenencia_xor;
GO

ALTER TABLE nucleo.bloque_terminal
    ADD CONSTRAINT CK_bloque_terminal_pertenencia_xor CHECK (
        (IIF(caja_id IS NOT NULL, 1, 0) + IIF(gabinete_id IS NOT NULL, 1, 0)
         + IIF(modulo_id IS NOT NULL, 1, 0) + IIF(equipo_id IS NOT NULL, 1, 0)) = 1
    );
GO

CREATE UNIQUE INDEX UX_bloque_terminal_equipo_codigo
    ON nucleo.bloque_terminal (equipo_id, codigo) WHERE equipo_id IS NOT NULL AND activo = 1;
GO

COMMIT TRANSACTION;
GO


/* ============================================================================
   TR_terminacion_validar_propietario_y_canal — recreación (015): el
   chequeo (a) reconoce EQUIPO como un dueño más de bloque_terminal, igual
   que caja/gabinete/modulo, en vez de rechazar cualquier extremo de
   equipo de forma incondicional. El chequeo (b) queda literal, sin
   cambios.
   ============================================================================ */

DROP TRIGGER nucleo.TR_terminacion_validar_propietario_y_canal;
GO

CREATE TRIGGER nucleo.TR_terminacion_validar_propietario_y_canal ON nucleo.terminacion
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- (a) propietario del bloque_terminal vs. propietario real del
    --     punto_conexion del extremo correspondiente del tramo.
    IF EXISTS (
        SELECT 1
        FROM inserted te
        JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id
        JOIN nucleo.tramo_conexion tc   ON tc.id = tcd.tramo_conexion_id
        JOIN nucleo.punto_conexion pto  ON pto.id = CASE te.extremo WHEN N'ORIGEN' THEN tc.punto_origen_id ELSE tc.punto_destino_id END
        JOIN nucleo.posicion_terminal pos ON pos.id = te.posicion_terminal_id
        JOIN nucleo.terminal ter        ON ter.id = pos.terminal_id
        JOIN nucleo.bloque_terminal bt  ON bt.id = ter.bloque_terminal_id
        WHERE te.activo = 1
          AND (
                (pto.caja_id        IS NOT NULL AND ISNULL(bt.caja_id, -1)     <> pto.caja_id)
             OR (pto.gabinete_id    IS NOT NULL AND ISNULL(bt.gabinete_id, -1) <> pto.gabinete_id)
             OR (pto.modulo_id      IS NOT NULL AND ISNULL(bt.modulo_id, -1)   <> pto.modulo_id)
             OR (pto.equipo_id      IS NOT NULL AND ISNULL(bt.equipo_id, -1)   <> pto.equipo_id)
             OR (pto.instrumento_id IS NOT NULL)   -- sin bloque_terminal de instrumento, sigue fuera de alcance
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51024, 'La terminacion no pertenece al mismo propietario que el punto_conexion del extremo del tramo.', 1;
    END

    -- (b) si el terminal es de modulo y viene de catalogo, el numero_canal
    --     del catalogo debe coincidir con el canal real de la señal de la ruta.
    IF EXISTS (
        SELECT 1
        FROM inserted te
        JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id
        JOIN nucleo.tramo_conexion tc   ON tc.id = tcd.tramo_conexion_id
        JOIN nucleo.ruta_conexion rc    ON rc.id = tc.ruta_conexion_id
        JOIN nucleo.senal sg            ON sg.id = rc.senal_id AND sg.canal_id IS NOT NULL
        JOIN nucleo.canal cn            ON cn.id = sg.canal_id
        JOIN nucleo.posicion_terminal pos ON pos.id = te.posicion_terminal_id
        JOIN nucleo.terminal ter        ON ter.id = pos.terminal_id
        JOIN nucleo.bloque_terminal bt  ON bt.id = ter.bloque_terminal_id AND bt.modulo_id IS NOT NULL
        JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = ter.catalogo_modulo_io_terminal_id
        WHERE te.activo = 1
          AND (cn.modulo_id <> bt.modulo_id OR cn.numero_canal <> cmit.numero_canal)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51025, 'La terminacion en un terminal de modulo no corresponde al canal real de la señal.', 1;
    END
END
GO


/* ============================================================================
   TR_bloque_terminal_validar_plano_dueno — recreación (025): la
   comparación "mismo dueño" para un mismo plano_id ahora incluye
   equipo_id — sin esto, dos bloques de EQUIPOS DISTINTOS con caja_id/
   gabinete_id/modulo_id en NULL se verían como el mismo dueño por
   accidente. No se agrega auto-asociación para equipo (no existe
   nucleo.equipo_plano) — mismo criterio ya usado con módulo.
   ============================================================================ */

DROP TRIGGER nucleo.TR_bloque_terminal_validar_plano_dueno;
GO

CREATE TRIGGER nucleo.TR_bloque_terminal_validar_plano_dueno
ON nucleo.bloque_terminal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(plano_id)
        RETURN;

    DECLARE @afectados TABLE (
        id           BIGINT NOT NULL,
        proyecto_id  BIGINT NOT NULL,
        plano_id     BIGINT NOT NULL,
        caja_id      BIGINT NULL,
        gabinete_id  BIGINT NULL,
        modulo_id    BIGINT NULL,
        equipo_id    BIGINT NULL
    );

    INSERT INTO @afectados (id, proyecto_id, plano_id, caja_id, gabinete_id, modulo_id, equipo_id)
    SELECT i.id, i.proyecto_id, i.plano_id, i.caja_id, i.gabinete_id, i.modulo_id, i.equipo_id
    FROM inserted i
    WHERE i.plano_id IS NOT NULL;

    IF EXISTS (
        SELECT 1
        FROM @afectados a
        JOIN nucleo.bloque_terminal b2
            ON b2.plano_id = a.plano_id
           AND b2.proyecto_id = a.proyecto_id
           AND b2.activo = 1
           AND b2.id <> a.id
        WHERE ISNULL(b2.caja_id, -1) <> ISNULL(a.caja_id, -1)
           OR ISNULL(b2.gabinete_id, -1) <> ISNULL(a.gabinete_id, -1)
           OR ISNULL(b2.modulo_id, -1) <> ISNULL(a.modulo_id, -1)
           OR ISNULL(b2.equipo_id, -1) <> ISNULL(a.equipo_id, -1)
    )
    BEGIN
        THROW 51038, 'Todos los bloques de terminales asignados a un mismo plano deben pertenecer al mismo dueño (caja, gabinete, modulo o equipo).', 1;
    END;

    -- Auto-asocia (o reactiva) caja_plano para bloques dueños de CAJA.
    UPDATE cp
        SET cp.activo = 1, cp.updated_at = SYSUTCDATETIME()
    FROM nucleo.caja_plano cp
    JOIN (SELECT DISTINCT caja_id, plano_id, proyecto_id FROM @afectados WHERE caja_id IS NOT NULL) a
        ON a.caja_id = cp.caja_id AND a.plano_id = cp.plano_id AND a.proyecto_id = cp.proyecto_id
    WHERE cp.activo = 0;

    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id, activo, created_at)
    SELECT DISTINCT a.proyecto_id, a.caja_id, a.plano_id, 1, SYSUTCDATETIME()
    FROM @afectados a
    WHERE a.caja_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM nucleo.caja_plano cp
          WHERE cp.caja_id = a.caja_id AND cp.plano_id = a.plano_id AND cp.proyecto_id = a.proyecto_id
      );

    -- Auto-asocia (o reactiva) gabinete_plano para bloques dueños de GABINETE.
    UPDATE gp
        SET gp.activo = 1, gp.updated_at = SYSUTCDATETIME()
    FROM nucleo.gabinete_plano gp
    JOIN (SELECT DISTINCT gabinete_id, plano_id, proyecto_id FROM @afectados WHERE gabinete_id IS NOT NULL) a
        ON a.gabinete_id = gp.gabinete_id AND a.plano_id = gp.plano_id AND a.proyecto_id = gp.proyecto_id
    WHERE gp.activo = 0;

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id, activo, created_at)
    SELECT DISTINCT a.proyecto_id, a.gabinete_id, a.plano_id, 1, SYSUTCDATETIME()
    FROM @afectados a
    WHERE a.gabinete_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM nucleo.gabinete_plano gp
          WHERE gp.gabinete_id = a.gabinete_id AND gp.plano_id = a.plano_id AND gp.proyecto_id = a.proyecto_id
      );
END;
GO
