/* =============================================================================
   048_senal_tag_pnid.sql — SIEI
   nucleo.senal.tag_pnid — rastrea el texto crudo de la columna "Tag" de la
   fila de señal en el reporte P&ID (ej. "S620-PI-5053"), puramente
   informativo, para que un cambio de ese texto entre reportes se vea en
   el PREVIEW — mismo criterio visual que TAG_MODIFICADO para instrumentos.

   CONTEXTO / DECISIÓN DE NEGOCIO
   -------------------------------------------------------------------------
   El motor de reimportación de señales (migración 046) ya sincroniza
   tagSenal/servicio/tipoIoId, pero ninguno de esos tres se deriva del
   texto "Tag" que trae la propia fila de señal en el reporte (tagSenal se
   calcula de Instrumento Asociado + Type, nunca de ese texto) — así que
   un cambio de ESE texto puntual pasaba completamente desapercibido. El
   usuario pidió explícitamente que también se muestre, aunque sea
   informativo:

     "no ps, el tag también debe aunque sea mostrar que se cambio asi como
     si fuera un instrumento mas"

   `tag_pnid` guarda el ÚLTIMO texto "Tag" visto en un reporte para esa
   señal (vinculada por codigo_senal, igual alcance que el resto del motor
   — ver comentario en pnidImports.ts sobre el filtro de codigo_senal
   puramente numérico). Es un campo puramente de bookkeeping/histórico —
   NUNCA participa en la identidad de la señal (eso lo sigue haciendo
   codigo_senal/PnPID) ni en el cálculo de tagSenal.

   ALCANCE SQL
   -------------------------------------------------------------------------
   1 columna nueva en nucleo.senal, NVARCHAR(50) NULL (mismo largo que
   nucleo.instrumento.tag_instrumento) — sin CHECK, sin trigger, sin FK.
   No se toca 001-047. El backfill inicial (a partir del último reporte ya
   aplicado) se hace aparte, no en esta migración.
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
   0. VERIFICACIÓN DE PRECONDICIÓN E IDEMPOTENCIA
   ============================================================================ */

IF EXISTS (
    SELECT 1 FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'senal' AND c.name = N'tag_pnid'
)
BEGIN
    THROW 59001, 'La migracion 048 ya fue aplicada (nucleo.senal.tag_pnid ya existe).', 1;
END
GO


/* ============================================================================
   1. nucleo.senal.tag_pnid
   ============================================================================ */

ALTER TABLE nucleo.senal
    ADD tag_pnid NVARCHAR(50) NULL;
GO
