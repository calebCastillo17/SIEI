/* =============================================================================
   029_smoke_rack_limite_modulo_tags.sql — Smoke test de la migracion 017
   (nucleo.rack.limite_slots, nucleo.modulo.tag, nucleo.modulo.surge_protector_tag).

   El conteo "salta los que no tienen tag puesto" y la validacion del
   limite de slots contra el conteo de slots activos viven en el backend
   (modules.ts / slots.ts / racks.ts), no en la base — este smoke test solo
   cubre lo que SI es responsabilidad de la base: que las 3 columnas
   existan, acepten NULL, y que el CHECK de limite_slots > 0 funcione.

   Requiere el proyecto fixture TEST-001. Autocontenido, ROLLBACK al final.
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @proyecto_id BIGINT = (SELECT id FROM nucleo.proyecto WHERE codigo_proyecto = 'TEST-001');
DECLARE @sufijo NVARCHAR(20) = CONVERT(NVARCHAR(20), DATEDIFF(SECOND, '2020-01-01', SYSUTCDATETIME()));
DECLARE @gabinete_id BIGINT = (SELECT TOP 1 id FROM nucleo.gabinete WHERE proyecto_id = @proyecto_id AND activo = 1);
DECLARE @rack_id BIGINT, @modulo_catalogo_id BIGINT, @slot_id BIGINT, @modulo_id BIGINT;

PRINT '=== 029: rack.limite_slots / modulo.tag / modulo.surge_protector_tag ===';

-- Reusa cualquier tipo de modulo ya existente en el catalogo (no depende
-- de cuales queden tras la limpieza del 2026-09-02 — solo necesita 1 fila).
SET @modulo_catalogo_id = (SELECT TOP 1 id FROM cat.cat_modulo_io);


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, limite_slots, activo, created_at)
    VALUES (@proyecto_id, @gabinete_id, 9001, 2, 1, SYSUTCDATETIME());
    SET @rack_id = SCOPE_IDENTITY();

    IF (SELECT limite_slots FROM nucleo.rack WHERE id = @rack_id) = 2
        PRINT 'PASS 1: rack con limite_slots=2 se crea y persiste correctamente.';
    ELSE
        PRINT 'FAIL 1: limite_slots no persistio el valor esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1: ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, limite_slots, activo, created_at)
    VALUES (@proyecto_id, @gabinete_id, 9002, NULL, 1, SYSUTCDATETIME());

    PRINT 'PASS 2: rack con limite_slots=NULL (sin límite) se crea sin problema.';
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2: ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, limite_slots, activo, created_at)
    VALUES (@proyecto_id, @gabinete_id, 9003, 0, 1, SYSUTCDATETIME());

    PRINT 'FAIL 3: se permitio limite_slots=0 (CK_rack_limite_slots_positivo no protegio).';
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 547
        PRINT 'PASS 3: limite_slots=0 rechazado por CK_rack_limite_slots_positivo (547).';
    ELSE
        PRINT 'FAIL 3: error inesperado -- ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
    VALUES (@proyecto_id, @gabinete_id, 9004, 1, SYSUTCDATETIME());
    SET @rack_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
    VALUES (@proyecto_id, @rack_id, 1, 1, SYSUTCDATETIME());
    SET @slot_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, tag, surge_protector_tag, activo, created_at)
    VALUES (@proyecto_id, @slot_id, @modulo_catalogo_id, CONCAT('DI-TEST-', @sufijo), CONCAT('DISPR-TEST-', @sufijo), 1, SYSUTCDATETIME());
    SET @modulo_id = SCOPE_IDENTITY();

    IF (SELECT tag FROM nucleo.modulo WHERE id = @modulo_id) = CONCAT('DI-TEST-', @sufijo)
       AND (SELECT surge_protector_tag FROM nucleo.modulo WHERE id = @modulo_id) = CONCAT('DISPR-TEST-', @sufijo)
        PRINT 'PASS 4: modulo.tag y modulo.surge_protector_tag persisten valores explícitos.';
    ELSE
        PRINT 'FAIL 4: tag/surge_protector_tag no persistieron el valor esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 4: ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
    VALUES (@proyecto_id, @gabinete_id, 9005, 1, SYSUTCDATETIME());
    SET @rack_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
    VALUES (@proyecto_id, @rack_id, 1, 1, SYSUTCDATETIME());
    SET @slot_id = SCOPE_IDENTITY();

    -- Un módulo sin tag/surge_protector_tag (ambos NULL) — el estado
    -- "todavía sin tag" debe seguir siendo válido (nada obliga a
    -- rellenarlos, el default lo calcula el backend, no un CHECK).
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
    VALUES (@proyecto_id, @slot_id, @modulo_catalogo_id, 1, SYSUTCDATETIME());
    SET @modulo_id = SCOPE_IDENTITY();

    IF (SELECT tag FROM nucleo.modulo WHERE id = @modulo_id) IS NULL
       AND (SELECT surge_protector_tag FROM nucleo.modulo WHERE id = @modulo_id) IS NULL
        PRINT 'PASS 5: modulo sin tag/surge_protector_tag (ambos NULL) es un estado válido.';
    ELSE
        PRINT 'FAIL 5: tag/surge_protector_tag no quedaron NULL como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 5: ' + ERROR_MESSAGE();
END CATCH;

PRINT '=== fin 029 ===';
GO
