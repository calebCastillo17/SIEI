/* =============================================================================
   043_tuberia_tag_anterior.sql — SIEI
   Agrega nucleo.tuberia.tag_anterior (NVARCHAR(200) NULL, mismo tamaño que
   tag_linea) — mismo patrón ya usado en instrumento.tag_anterior (migración
   004), gabinete.tag_anterior (migración 012), caja.tag_anterior (migración
   023) y plano.codigo_anterior (migración 014): nullable, sin índice único,
   sin FK, no participa en identidad — un respaldo histórico, no un dato vivo.

   Motivo real: al comparar linea_pnid (P&ID, por tag) contra tag_linea (HD,
   por tubería) se encontraron 40 de 48 tags con línea distinta entre ambas
   fuentes. Antes de corregir tag_linea caso por caso, se preserva el valor
   actual en tag_anterior — backfill de TODAS las tuberías existentes (no
   solo el proyecto 620), igual que el backfill de tipo_gabinete_id en la
   migración 012.
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

ALTER TABLE nucleo.tuberia
    ADD tag_anterior NVARCHAR(200) NULL;
GO

UPDATE nucleo.tuberia
    SET tag_anterior = tag_linea;
GO

COMMIT TRANSACTION;
GO
