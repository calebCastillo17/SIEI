/* =============================================================================
   031_smoke_modulo_plano_conexionado.sql — Smoke test de la migracion 024
   (nucleo.modulo.plano_id + TR_modulo_validar_plano_gabinete).

   Casos:
     1. Asignar plano_id a un modulo -> se permite y auto-crea la fila en
        nucleo.gabinete_plano (gabinete, plano) activa.
     2. Asignar el MISMO plano a otro modulo del MISMO gabinete -> se
        permite, no duplica la fila de gabinete_plano.
     3. Asignar ese mismo plano a un modulo de un gabinete DISTINTO ->
        rechazado (51036).
     4. Si la fila de gabinete_plano se desactiva a mano y se vuelve a
        tocar plano_id (mismo valor) sobre un modulo de ese gabinete, el
        trigger la reactiva.

   Requiere el proyecto fixture TEST-001, al menos 1 tipo de modulo en el
   catalogo y al menos 1 tipo de plano en cat.cat_tipo_plano. Autocontenido,
   ROLLBACK al final de cada caso.
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
DECLARE @tipo_modulo BIGINT = (SELECT TOP 1 id FROM cat.cat_modulo_io);
DECLARE @tipo_plano_id BIGINT = (SELECT TOP 1 id FROM cat.cat_tipo_plano);

DECLARE @gab_a BIGINT, @gab_b BIGINT, @plano_id BIGINT;
DECLARE @rack_a BIGINT, @slot_a1 BIGINT, @slot_a2 BIGINT, @modulo_a1 BIGINT, @modulo_a2 BIGINT;
DECLARE @rack_b BIGINT, @slot_b BIGINT, @modulo_b BIGINT;

PRINT '=== 031: TR_modulo_validar_plano_gabinete ===';

IF @proyecto_id IS NULL OR @tipo_modulo IS NULL OR @tipo_plano_id IS NULL
BEGIN
    PRINT 'SKIP: falta TEST-001, un tipo de modulo o un tipo de plano para probar.';
END
ELSE
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-GAB-A-', @sufijo), (SELECT TOP 1 id FROM cat.cat_tipo_gabinete), 1, SYSUTCDATETIME());
        SET @gab_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-GAB-B-', @sufijo), (SELECT TOP 1 id FROM cat.cat_tipo_gabinete), 1, SYSUTCDATETIME());
        SET @gab_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-PLANO-', @sufijo), 'Plano de prueba 031', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gab_a, 9201, 1, SYSUTCDATETIME());
        SET @rack_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_a, 1, 1, SYSUTCDATETIME());
        SET @slot_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_a, 2, 1, SYSUTCDATETIME());
        SET @slot_a2 = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_a1, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_a2, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_a2 = SCOPE_IDENTITY();

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gab_b, 9201, 1, SYSUTCDATETIME());
        SET @rack_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_b, 1, 1, SYSUTCDATETIME());
        SET @slot_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_b, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_b = SCOPE_IDENTITY();

        -- Caso 1: primer modulo del gabinete A -> plano. Debe permitirse
        -- y auto-crear la fila de gabinete_plano.
        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_a1;

        IF EXISTS (
            SELECT 1 FROM nucleo.gabinete_plano
            WHERE gabinete_id = @gab_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id AND activo = 1
        )
            PRINT 'PASS 1: modulo asignado a plano y gabinete_plano auto-creado activo.';
        ELSE
            PRINT 'FAIL 1: no se creo la fila de gabinete_plano esperada.';

        -- Caso 2: segundo modulo del MISMO gabinete A -> mismo plano.
        -- Debe permitirse y NO duplicar la fila de gabinete_plano.
        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_a2;

        IF (SELECT COUNT(*) FROM nucleo.gabinete_plano WHERE gabinete_id = @gab_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id) = 1
            PRINT 'PASS 2: segundo modulo del mismo gabinete asignado sin duplicar gabinete_plano.';
        ELSE
            PRINT 'FAIL 2: se esperaba exactamente 1 fila de gabinete_plano para el par (gabinete A, plano).';

        PRINT 'PASS 1-2 OK, revirtiendo para el caso 3.';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        PRINT 'FAIL 1-2: ' + ERROR_MESSAGE();
    END CATCH;


    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-GAB-A2-', @sufijo), (SELECT TOP 1 id FROM cat.cat_tipo_gabinete), 1, SYSUTCDATETIME());
        SET @gab_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-GAB-B2-', @sufijo), (SELECT TOP 1 id FROM cat.cat_tipo_gabinete), 1, SYSUTCDATETIME());
        SET @gab_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-PLANO2-', @sufijo), 'Plano de prueba 031 (caso 3)', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gab_a, 9202, 1, SYSUTCDATETIME());
        SET @rack_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_a, 1, 1, SYSUTCDATETIME());
        SET @slot_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_a1, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gab_b, 9202, 1, SYSUTCDATETIME());
        SET @rack_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_b, 1, 1, SYSUTCDATETIME());
        SET @slot_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_b, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_b = SCOPE_IDENTITY();

        -- Primer modulo (gabinete A) toma el plano sin problema.
        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_a1;

        -- Caso 3: modulo de un gabinete DISTINTO (B) al mismo plano ->
        -- debe rechazarse con 51036.
        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_b;

        PRINT 'FAIL 3: se permitio mezclar modulos de dos gabinetes distintos en el mismo plano (51036 no protegio).';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        IF ERROR_NUMBER() = 51036
            PRINT 'PASS 3: modulo de otro gabinete en el mismo plano rechazado por 51036, como se espera.';
        ELSE
            PRINT 'FAIL 3: error inesperado -- ' + ERROR_MESSAGE();
    END CATCH;


    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-GAB-A3-', @sufijo), (SELECT TOP 1 id FROM cat.cat_tipo_gabinete), 1, SYSUTCDATETIME());
        SET @gab_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-031-PLANO3-', @sufijo), 'Plano de prueba 031 (caso 4)', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack, activo, created_at)
        VALUES (@proyecto_id, @gab_a, 9203, 1, SYSUTCDATETIME());
        SET @rack_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot, activo, created_at)
        VALUES (@proyecto_id, @rack_a, 1, 1, SYSUTCDATETIME());
        SET @slot_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id, activo, created_at)
        VALUES (@proyecto_id, @slot_a1, @tipo_modulo, 1, SYSUTCDATETIME());
        SET @modulo_a1 = SCOPE_IDENTITY();

        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_a1;

        -- Se desactiva la asociacion a mano (como si el usuario la
        -- hubiera quitado desde el plano) y se vuelve a tocar plano_id
        -- (mismo valor) -> el trigger debe reactivarla.
        UPDATE nucleo.gabinete_plano SET activo = 0 WHERE gabinete_id = @gab_a AND plano_id = @plano_id;

        UPDATE nucleo.modulo SET plano_id = @plano_id WHERE id = @modulo_a1;

        IF EXISTS (
            SELECT 1 FROM nucleo.gabinete_plano
            WHERE gabinete_id = @gab_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id AND activo = 1
        )
            PRINT 'PASS 4: gabinete_plano reactivado al volver a tocar plano_id.';
        ELSE
            PRINT 'FAIL 4: gabinete_plano no se reactivo.';

        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        PRINT 'FAIL 4: ' + ERROR_MESSAGE();
    END CATCH;
END

PRINT '=== fin 031 ===';
GO
