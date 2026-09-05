/* =============================================================================
   025_bloque_terminal_plano_conexionado.sql — SIEI

   Agrega nucleo.bloque_terminal.plano_id (FK compuesta nullable ->
   nucleo.plano): "en qué plano de conexionado está dibujado este bloque de
   bornas" — la misma cara "Conexionado/Planos" que ya construimos para
   nucleo.modulo (migración 024), ahora para CAJAS (segunda etapa de la
   ruta de Control: Gabinete/RIO -> Cajas -> Instrumento).

   bloque_terminal es dueño XOR de caja/gabinete/modulo (migración 015) —
   a diferencia de modulo.plano_id (que necesitaba resolver el gabinete vía
   slot->rack), acá el dueño real ya está directo en la propia fila
   (caja_id/gabinete_id/modulo_id), así que la regla "todos los bloques de
   un mismo plano deben ser del mismo dueño" se valida sin ningún JOIN
   adicional.

   Regla de negocio (mismo criterio ya confirmado con el usuario para
   módulos): un plano de conexionado documenta físicamente UN solo dueño.
   Se enforcea dura, sin excepción (error 51038), en
   TR_bloque_terminal_validar_plano_dueno. Como consecuencia querida
   (mismo patrón que 024), el trigger auto-asocia (o reactiva) la fila
   correspondiente — caja_plano si el dueño es caja, gabinete_plano si es
   gabinete (materializando el mismo caso que ya cubría modulo.plano_id vía
   slot->rack->gabinete, ahora también para un bloque de gabinete directo)
   — nunca hace falta asociar a mano por separado. Un bloque_terminal de
   MODULO no auto-asocia nada nuevo por este camino (el módulo ya tiene su
   propio modulo.plano_id/TR_modulo_validar_plano_gabinete desde la 024;
   permitir plano_id también en su bloque_terminal es simple simetría de
   esquema, no un caso de uso pedido todavía — no se le agrega lógica de
   auto-asociación redundante).
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
    ADD plano_id BIGINT NULL;
GO

ALTER TABLE nucleo.bloque_terminal
    ADD CONSTRAINT FK_bloque_terminal_plano FOREIGN KEY (plano_id, proyecto_id)
        REFERENCES nucleo.plano (id, proyecto_id);
GO

COMMIT TRANSACTION;
GO


/* ============================================================================
   TR_bloque_terminal_validar_plano_dueno
   ----------------------------------------
   Se dispara solo cuando plano_id participa en el INSERT/UPDATE. Para cada
   bloque afectado con plano_id NO NULO, rechaza (51038) si ya existe otro
   bloque ACTIVO con el MISMO plano_id pero de un dueño distinto (distinta
   caja, distinto gabinete, o distinto módulo — comparación directa sobre
   las 3 columnas XOR, sin JOIN). Si pasa, auto-asocia (o reactiva)
   caja_plano/gabinete_plano según corresponda — set-based, sin cursor,
   mismo patrón que TR_modulo_validar_plano_gabinete (migración 024).
   ============================================================================ */

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
        modulo_id    BIGINT NULL
    );

    INSERT INTO @afectados (id, proyecto_id, plano_id, caja_id, gabinete_id, modulo_id)
    SELECT i.id, i.proyecto_id, i.plano_id, i.caja_id, i.gabinete_id, i.modulo_id
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
    )
    BEGIN
        THROW 51038, 'Todos los bloques de terminales asignados a un mismo plano deben pertenecer al mismo dueño (caja, gabinete o modulo).', 1;
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
