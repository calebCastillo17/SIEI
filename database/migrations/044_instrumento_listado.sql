/* =============================================================================
   044_instrumento_listado.sql — SIEI
   Agrega nucleo.instrumento.listado (BIT NOT NULL, DEFAULT 1) — un dato de
   CONTENIDO, no de estado: refleja la columna "Listado" del reporte P&ID,
   independiente de `activo` (que sigue significando exclusivamente borrado
   lógico). Todos los instrumentos existentes quedan en 1 (ya están todos
   "listados" de hecho, ninguno se creó nunca con Listado=False porque el
   importador simplemente no los creaba — ver más abajo).

   Motivo real: hasta ahora, una fila de P&ID con Listado=False NUNCA creaba
   un instrumento (backend/src/lib/pnidImport/compare.ts cortaba temprano,
   sin comparar nada) — decisión explícita del usuario de revertir eso:
   "la idea es que se guarde todo pero los no listados no se muestran".
   A partir de esta migración, esas filas SÍ crean/actualizan el
   instrumento igual que cualquier otra, con listado=0 — el Master
   (InstrumentsListPage) y el generador del LDI (revisionesEntregable.ts,
   fetchInstrumentosOrdenables) filtran por listado=1 para no mostrarlos
   por defecto ni imprimirlos en el documento oficial.
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

ALTER TABLE nucleo.instrumento
    ADD listado BIT NOT NULL CONSTRAINT DF_instrumento_listado DEFAULT (1);
GO

COMMIT TRANSACTION;
GO
