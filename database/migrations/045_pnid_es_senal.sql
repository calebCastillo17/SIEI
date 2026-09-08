/* =============================================================================
   045_pnid_es_senal.sql — SIEI
   Nuevo código en cat.cat_estado_pnid: ES_SENAL.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - Con datos reales del proyecto (reporte "Instrument List - 2") se
     encontraron 286 filas cuya columna inglesa "Description" (reconocida
     pero deliberadamente NO sincronizada, ver KNOWN_UNSYNCED_HEADERS en
     backend/src/lib/pnidImport/headers.ts) vale "PRIMARY ACCESSIBLE DCS" o
     "PRIMARY INACCESSIBLE DCS" — estas filas no son instrumentos nuevos:
     son la representación, en el propio Instrument List, de una SEÑAL de
     un instrumento que YA existe (Tag tipo "S620-PI-5053", "Instrumento
     Asociado" apuntando siempre al instrumento real, ej. "620-PIT-5053").
   - Antes de esta migración, el comparador (compare.ts) no distinguía
     esto — cualquier fila así, sin match previo, caía en NUEVO_EN_PNID y
     terminaba creando un instrumento nuevo (oculto, listado=0 desde la
     migración 044) solo para sostener lo que en realidad es una señal.
     Decisión explícita del usuario: esas filas NUNCA deben crear ni
     actualizar un nucleo.instrumento.
   - ES_SENAL es puramente informativo — el instrumento real asociado, si
     existe, viaja en el propio resultado (instrumento_id), pero APPLY
     nunca lo toca (ver pnidImports.ts). Cuando "Instrumento Asociado" no
     resuelve a ningún instrumento activo, la fila cae en REQUIERE_REVISION
     en su lugar (no ES_SENAL) — no se inventa a qué instrumento pertenece.
   - Un motor de señales que sí procese estas filas (actualizar tag/
     servicio/vínculo de la señal real correspondiente en cada
     reimportación) es un desarrollo aparte, no implementado todavía.

   ALCANCE
   -------
   1 INSERT en cat.cat_estado_pnid (lista cerrada, ver 001/004/008) + 1
   columna nueva en integracion.importacion_pnid (conteo_es_senal, mismo
   patrón que los demás conteo_*). No se toca 001-044.
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
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'cat' AND t.name = N'cat_estado_pnid'
)
BEGIN
    THROW 56001, 'La migracion 045 requiere que 001_initial_schema.sql se haya aplicado antes (falta cat.cat_estado_pnid).', 1;
END
GO

IF EXISTS (SELECT 1 FROM cat.cat_estado_pnid WHERE codigo = N'ES_SENAL')
BEGIN
    THROW 56002, 'cat.cat_estado_pnid ya tiene el codigo ES_SENAL — la migracion 045 ya se aplico antes.', 1;
END
GO


/* ============================================================================
   1. NUEVO CÓDIGO EN cat.cat_estado_pnid
   ============================================================================ */

INSERT INTO cat.cat_estado_pnid (codigo, descripcion) VALUES
    (N'ES_SENAL', N'La fila representa una senal de un instrumento existente, no un instrumento nuevo -- nunca crea ni actualiza nucleo.instrumento');
GO


/* ============================================================================
   2. NUEVA COLUMNA EN integracion.importacion_pnid
   ============================================================================ */

ALTER TABLE integracion.importacion_pnid ADD
    conteo_es_senal INT NOT NULL CONSTRAINT DF_importacion_pnid_conteo_es_senal DEFAULT (0);
GO
