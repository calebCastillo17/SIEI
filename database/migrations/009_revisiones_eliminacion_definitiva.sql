/* =============================================================================
   009_revisiones_eliminacion_definitiva.sql — SIEI
   Permite un borrado FÍSICO deliberado de una revisión EMITIDA/DESCARTADA
   — decisión de negocio del usuario, revierte parcialmente la
   inmutabilidad total de la migración 006.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - Migración 006 dejó EMITIDA/DESCARTADA como estados finales sin
     ninguna salida — ni UPDATE ni DELETE — para proteger el historial de
     un documento controlado. El usuario generó varias revisiones de
     prueba reales (con descripciones como "ddd", "Nuevo") en un proyecto
     real y pidió poder eliminarlas.
   - En vez de quitar la protección para siempre, se agrega un bypass
     puntual con `SESSION_CONTEXT` — un mecanismo estándar de SQL Server
     para marcar "esta transacción está autorizada a saltarse esta
     regla", sin abrir la puerta a que cualquier UPDATE/DELETE accidental
     la salte. Dos operaciones internas y controladas por el backend usan
     esta marca, siempre dentro de su propia transacción y apagándola
     antes del COMMIT (nunca queda "prendida" para otra request que
     reutilice la misma conexión del pool):
       1. El endpoint de eliminación definitiva (`DELETE .../revisiones/:id`
          con `eliminarDefinitivamente: true`, requiere permiso
          'administer').
       2. El propio `POST .../revisiones/:id/emitir` (migración 010): al
          emitir, otras revisiones YA EMITIDAS pueden necesitar que se les
          actualice `fila_caratula` (subir una fila, o quedar expulsadas
          de la carátula) — sin este bypass, esa UPDATE también quedaría
          bloqueada por ser sobre una fila ya EMITIDA.
   - No se toca la protección de `TR_revision_entregable_archivo_inmutable`
     (UPDATE del binario) porque el borrado físico usa DELETE directo
     sobre esa tabla, que ese trigger no cubre (es AFTER UPDATE nomás) —
     confirmado revisando la migración 006, no hace falta modificarlo.

   ALCANCE
   -------
   Reemplaza (DROP + CREATE) 2 triggers ya existentes de la migración 006
   — `TR_revision_entregable_estado_final_inmutable` y
   `TR_revision_entregable_fila_estado_final_inmutable` — agregándoles el
   bypass. Ninguna tabla ni columna nueva. No se toca 001-008.
============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO


/* ============================================================================
   0. VERIFICACIÓN DE PRECONDICIÓN
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1 FROM sys.triggers WHERE name = N'TR_revision_entregable_estado_final_inmutable'
)
BEGIN
    THROW 55940, 'La migracion 009 requiere que 006_entregables_base.sql se haya aplicado antes (falta TR_revision_entregable_estado_final_inmutable).', 1;
END
GO


/* ============================================================================
   1. TR_revision_entregable_estado_final_inmutable — agrega el bypass
   ============================================================================ */

DROP TRIGGER nucleo.TR_revision_entregable_estado_final_inmutable;
GO

CREATE TRIGGER nucleo.TR_revision_entregable_estado_final_inmutable ON nucleo.revision_entregable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF (CONVERT(BIT, SESSION_CONTEXT(N'siei_bypass_inmutabilidad_revision')) = 1) RETURN;

    IF EXISTS (SELECT 1 FROM deleted WHERE estado IN (N'EMITIDA', N'DESCARTADA'))
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 56011, 'Una revision EMITIDA o DESCARTADA es un estado final: no admite ninguna modificacion.', 1;
    END
END
GO


/* ============================================================================
   2. TR_revision_entregable_fila_estado_final_inmutable — agrega el bypass
   ============================================================================ */

DROP TRIGGER nucleo.TR_revision_entregable_fila_estado_final_inmutable;
GO

CREATE TRIGGER nucleo.TR_revision_entregable_fila_estado_final_inmutable ON nucleo.revision_entregable_fila
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF (CONVERT(BIT, SESSION_CONTEXT(N'siei_bypass_inmutabilidad_revision')) = 1) RETURN;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT revision_id FROM inserted
            UNION
            SELECT revision_id FROM deleted
        ) x
        JOIN nucleo.revision_entregable r ON r.id = x.revision_id
        WHERE r.estado IN (N'EMITIDA', N'DESCARTADA')
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 56012, 'No se puede modificar el snapshot de una revision EMITIDA o DESCARTADA.', 1;
    END
END
GO
