/* =============================================================================
   047_senal_sin_match_pnid.sql — SIEI
   nucleo.senal.sin_match_pnid — aviso persistente y visible para el usuario
   de que una señal vinculada por codigo_senal (PnPID) ya no aparece en el
   reporte P&ID más reciente.

   CONTEXTO / DECISIÓN DE NEGOCIO
   -------------------------------------------------------------------------
   El motor de reimportación de señales (migración 046) ya detecta este
   caso en cada PREVIEW/APPLY (resultado SENAL_SIN_MATCH_EN_REPORTE) y,
   por decisión explícita del usuario, nunca borra ni desvincula la señal.
   Pero esa detección solo vivía dentro del historial de un import puntual
   — no había ninguna forma de verla al mirar la señal en el resto de la
   plataforma. El usuario pidió explícitamente un aviso persistente, "al
   costado del tag", mismo estilo visual que ya existe para
   `dueno_ausente` (migración 016, "⚠ sin dueño"):

     "si se elimina la señal lo que si quiero es que no se elimine pero si
     tengo un mensaje asi como le pusiste a sin dueño, aqui tienes que
     ponerle tipo en rojito al costado del tag que ya no existe"

   `sin_match_pnid` es un campo de BOOKKEEPING puro, mucho más simple que
   `dueno_ausente`: no cambia el dueño ni ninguna otra columna de la señal,
   no interactúa con CK_senal_origen_xor ni con ningún trigger — es
   exclusivamente informativo, se prende y se apaga desde el backend
   (pnidImports.ts, dentro de la misma transacción de APPLY, igual
   criterio que dueno_ausente/pnpid/fuente_pnpid: administrado por un
   único flujo, nunca por el CRUD genérico de señales):
     - se pone en 1 cuando un APPLY produce SENAL_SIN_MATCH_EN_REPORTE
       para esa señal (su codigo_senal desapareció del reporte).
     - se vuelve a poner en 0 automáticamente cuando un APPLY posterior
       SÍ encuentra esa misma señal de nuevo (ES_SENAL con match) — el
       usuario no tiene que "resolverlo" a mano, si el reporte se corrige
       y el PnPID reaparece, el aviso desaparece solo.

   ALCANCE SQL
   -------------------------------------------------------------------------
   1 columna nueva en nucleo.senal, DEFAULT 0 permanente (toda señal nueva
   arranca sin el aviso, igual criterio que dueno_ausente). Sin CHECK, sin
   trigger, sin FK — no se toca 001-046.
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

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'integracion' AND t.name = N'importacion_pnid_resultado'
      AND EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id AND c.name = N'senal_id')
)
BEGIN
    THROW 58001, 'La migracion 047 requiere que 046_pnid_senal_reimport.sql se haya aplicado antes.', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'senal' AND c.name = N'sin_match_pnid'
)
BEGIN
    THROW 58002, 'La migracion 047 ya fue aplicada (nucleo.senal.sin_match_pnid ya existe).', 1;
END
GO


/* ============================================================================
   1. nucleo.senal.sin_match_pnid
   ============================================================================ */

ALTER TABLE nucleo.senal
    ADD sin_match_pnid BIT NOT NULL CONSTRAINT DF_senal_sin_match_pnid DEFAULT 0;
GO
