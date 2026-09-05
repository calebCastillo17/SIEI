/* =============================================================================
   020_modulo_io_canales_max_cero.sql — SIEI
   Relaja CK_cat_modulo_io_canales_max (001_initial_schema.sql) de
   `canales_max > 0` a `canales_max >= 0` — se encontró en vivo al intentar
   catalogar el "Módulo de comunicación" placeholder de la migración 019
   (0 canales de E/S es el valor REAL para ese caso, no uno inventado; la
   migración 019 ya había relajado la validación del backend pero no
   contempló este CHECK existente).

   TR_modulo_generar_canales (001) ya maneja canales_max = 0 sin generar
   ningún canal (confirmado leyendo el trigger, sin cambios necesarios ahí).
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

ALTER TABLE cat.cat_modulo_io DROP CONSTRAINT CK_cat_modulo_io_canales_max;
GO

ALTER TABLE cat.cat_modulo_io
    ADD CONSTRAINT CK_cat_modulo_io_canales_max CHECK (canales_max >= 0);
GO

COMMIT TRANSACTION;
GO
