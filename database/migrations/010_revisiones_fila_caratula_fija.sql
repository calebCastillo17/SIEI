/* =============================================================================
   010_revisiones_fila_caratula_fija.sql — SIEI
   Fila de carátula ASIGNADA UNA VEZ Y PARA SIEMPRE por revisión, en vez de
   recalculada dinámicamente en cada emisión.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - Diseño anterior (migración 006): al emitir, `revisionesMostradasEnCaratula`
     se recalculaba de cero como "las últimas 5 EMITIDA, más reciente
     primero", y `generateExcel.ts` las escribía por POSICIÓN (índice 0 ->
     fila 36, índice 1 -> fila 35, ...). Consecuencia: la fila de una
     revisión YA EMITIDA cambiaba en el archivo de una revisión POSTERIOR
     (ej. Rev A aparecía en la fila 36 en su propio archivo, pero en el
     archivo de Rev D — emitida después — aparecía en la fila 33).
   - El usuario probó esto con datos reales y pidió lo contrario: la fila
     de cada revisión se asigna la PRIMERA VEZ que se emite y nunca se
     recalcula después. La primera revisión de un entregable va a la fila
     36; cada revisión nueva sube una fila (35, 34, 33, 32); al llegar a
     una 6ª (ya no hay fila libre entre 32 y 36), la más antigua de las 5
     visibles se retira de la carátula (fila_caratula pasa a NULL) y las
     demás suben un lugar para hacerle espacio a la nueva en la fila 32.
   - Esto es estrictamente sobre EMITIDA — BORRADOR/DESCARTADA nunca
     tuvieron ni tienen fila de carátula (nunca llegaron a emitirse, o
     fueron descartadas antes de emitirse).

   ALCANCE
   -------
   1 columna nueva en nucleo.revision_entregable (fila_caratula). No se
   toca 001-009.
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
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'revision_entregable' AND c.name = N'estado'
)
BEGIN
    THROW 55950, 'La migracion 010 requiere que 006_entregables_base.sql se haya aplicado antes (falta nucleo.revision_entregable).', 1;
END
GO


/* ============================================================================
   1. NUEVA COLUMNA
   ============================================================================ */

ALTER TABLE nucleo.revision_entregable ADD
    fila_caratula   INT NULL
        CONSTRAINT CK_revision_entregable_fila_caratula_rango
            CHECK (fila_caratula IS NULL OR fila_caratula BETWEEN 32 AND 36);
GO
