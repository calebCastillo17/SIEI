/* =============================================================================
   030_smoke_modulo_validar_cambio_tipo_io.sql — Smoke test de la migracion 018
   (TR_modulo_generar_canales extendido: rechaza cambio de tipo_io_id con
   canales en uso por senal activa).

   Requiere el proyecto fixture TEST-001 y al menos 2 tipos de modulo en el
   catalogo con tipo_io_id DISTINTO entre si (cualquiera sirve, no depende
   de modelos especificos). Autocontenido, ROLLBACK al final.
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
DECLARE @clase_control_id BIGINT = (SELECT id FROM cat.cat_clase_senal WHERE codigo = 'CONTROL');

DECLARE @tipo_a BIGINT, @tipo_b BIGINT;
SELECT TOP 1 @tipo_a = cmi.id
FROM cat.cat_modulo_io cmi;
SELECT TOP 1 @tipo_b = cmi.id
FROM cat.cat_modulo_io cmi
WHERE cmi.tipo_io_id <> (SELECT tipo_io_id FROM cat.cat_modulo_io WHERE id = @tipo_a);

DECLARE @rack_id BIGINT, @slot_id BIGINT, @modulo_id BIGINT, @canal_id BIGINT, @inst_id BIGINT;

PRINT '=== 030: TR_modulo_generar_canales rechaza cambio de tipo_io con canal en uso ===';

IF @tipo_a IS NULL OR @tipo_b IS NULL
BEGIN
    PRINT 'SKIP: no hay 2 tipos de modulo con tipo_io_id distinto en el catalogo para probar.';
END
ELSE
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gabinete_id, 9101, 1, SYSUTCDATETIME());
        SET @rack_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_id, 1, 1, SYSUTCDATETIME());
        SET @slot_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_id, @tipo_a, 1, SYSUTCDATETIME());
        SET @modulo_id = SCOPE_IDENTITY();

        SET @canal_id = (SELECT TOP 1 id FROM nucleo.canal WHERE modulo_id = @modulo_id AND numero_canal = 0);

        INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-030-INST-', @sufijo), 1, SYSUTCDATETIME());
        SET @inst_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.senal (proyecto_id, instrumento_id, canal_id, clase_senal_id, nombre_corto, activo, created_at)
        VALUES (@proyecto_id, @inst_id, @canal_id, @clase_control_id, CONCAT('T030-', @sufijo), 1, SYSUTCDATETIME());

        -- Intento: cambiar el modulo a un tipo con tipo_io_id distinto,
        -- teniendo un canal con senal activa -> debe rechazarse (51035).
        UPDATE nucleo.modulo SET catalogo_modulo_id = @tipo_b WHERE id = @modulo_id;

        PRINT 'FAIL 1: se permitio cambiar el tipo de E/S con canal en uso (51035 no protegio).';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        IF ERROR_NUMBER() = 51035
            PRINT 'PASS 1: cambio de tipo_io con canal en uso rechazado por 51035, como se espera.';
        ELSE
            PRINT 'FAIL 1: error inesperado -- ' + ERROR_MESSAGE();
    END CATCH;


    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gabinete_id, 9102, 1, SYSUTCDATETIME());
        SET @rack_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_id, 1, 1, SYSUTCDATETIME());
        SET @slot_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_id, @tipo_a, 1, SYSUTCDATETIME());
        SET @modulo_id = SCOPE_IDENTITY();

        -- Mismo cambio de tipo, pero SIN ninguna senal activa en sus
        -- canales -> debe permitirse sin problema (comportamiento previo
        -- a la 018 no cambia para el caso sin uso real).
        UPDATE nucleo.modulo SET catalogo_modulo_id = @tipo_b WHERE id = @modulo_id;

        PRINT 'PASS 2: cambio de tipo_io sin canales en uso se permite sin problema.';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        PRINT 'FAIL 2: ' + ERROR_MESSAGE();
    END CATCH;
END

PRINT '=== fin 030 ===';
GO
