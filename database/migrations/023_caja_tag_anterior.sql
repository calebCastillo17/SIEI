/* =============================================================================
   023_caja_tag_anterior.sql — SIEI
   Agrega nucleo.caja.tag_anterior (NVARCHAR(50) NULL) — mismo patrón ya usado
   en instrumento.tag_anterior (migración 004), gabinete.tag_anterior
   (migración 012) y plano.codigo_anterior (migración 014): nullable, sin
   índice único, sin FK, no participa en identidad. La identidad funcional
   sigue siendo (proyecto_id, tag_caja).

   Motivo real: el reporte SENALES_CONTROL/SENALES traía, en una carga
   anterior, 6 cajas con TAG provisional tipo "XX" (620-TBC-50X3, 620-TBC-
   50X4, 620-TBC-XXX1, 620-TBJ-XXX1, 620-TBJ-XXX2, 620-TBJ-XXX3) — creadas
   así en SIEI porque era el único valor disponible en ese momento. El Excel
   actualizado por el usuario ya trae el TAG definitivo para esas 6 cajas
   (620-TBC-5019/5020/5021, 620-TBJ-5022/5023/5024), confirmado 1:1 por
   coincidencia exacta del conteo de filas de señal por caja entre el TAG
   viejo y el nuevo (26/6/6 para TBC, 2/12/3 para TBJ — sin ambigüedad). El
   backend renombra esas 6 filas (mismo id) y guarda el TAG provisional en
   tag_anterior, igual que ya se hace con instrumento/gabinete/plano cuando
   el P&ID o el propio usuario corrige un TAG.
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

ALTER TABLE nucleo.caja
    ADD tag_anterior NVARCHAR(50) NULL;
GO

COMMIT TRANSACTION;
GO
