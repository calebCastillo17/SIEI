/* =============================================================================
   032_smoke_bloque_terminal_plano_conexionado.sql — Smoke test de la
   migracion 025 (nucleo.bloque_terminal.plano_id +
   TR_bloque_terminal_validar_plano_dueno).

   Casos:
     1. Asignar plano_id a un bloque de CAJA -> se permite y auto-crea la
        fila en nucleo.caja_plano activa.
     2. Asignar el MISMO plano a otro bloque de la MISMA caja -> se
        permite, no duplica la fila de caja_plano.
     3. Asignar ese mismo plano a un bloque de una caja DISTINTA ->
        rechazado (51038).
     4. Si la fila de caja_plano se desactiva a mano y se vuelve a tocar
        plano_id (mismo valor) sobre un bloque de esa caja, el trigger la
        reactiva.

   Requiere el proyecto fixture TEST-001 y al menos 1 tipo de plano en
   cat.cat_tipo_plano. Autocontenido, ROLLBACK al final de cada caso.
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
DECLARE @tipo_plano_id BIGINT = (SELECT TOP 1 id FROM cat.cat_tipo_plano);

DECLARE @caja_a BIGINT, @caja_b BIGINT, @plano_id BIGINT;
DECLARE @bloque_a1 BIGINT, @bloque_a2 BIGINT, @bloque_b BIGINT;

PRINT '=== 032: TR_bloque_terminal_validar_plano_dueno ===';

IF @proyecto_id IS NULL OR @tipo_plano_id IS NULL
BEGIN
    PRINT 'SKIP: falta TEST-001 o un tipo de plano para probar.';
END
ELSE
BEGIN
    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.caja (proyecto_id, tag_caja, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-CAJA-A-', @sufijo), 1, SYSUTCDATETIME());
        SET @caja_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.caja (proyecto_id, tag_caja, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-CAJA-B-', @sufijo), 1, SYSUTCDATETIME());
        SET @caja_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-PLANO-', @sufijo), 'Plano de prueba 032', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_a, 'TB-1', 1, SYSUTCDATETIME());
        SET @bloque_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_a, 'TB-2', 1, SYSUTCDATETIME());
        SET @bloque_a2 = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_b, 'TB-1', 1, SYSUTCDATETIME());
        SET @bloque_b = SCOPE_IDENTITY();

        -- Caso 1
        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_a1;

        IF EXISTS (
            SELECT 1 FROM nucleo.caja_plano
            WHERE caja_id = @caja_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id AND activo = 1
        )
            PRINT 'PASS 1: bloque asignado a plano y caja_plano auto-creado activo.';
        ELSE
            PRINT 'FAIL 1: no se creo la fila de caja_plano esperada.';

        -- Caso 2
        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_a2;

        IF (SELECT COUNT(*) FROM nucleo.caja_plano WHERE caja_id = @caja_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id) = 1
            PRINT 'PASS 2: segundo bloque de la misma caja asignado sin duplicar caja_plano.';
        ELSE
            PRINT 'FAIL 2: se esperaba exactamente 1 fila de caja_plano para el par (caja A, plano).';

        PRINT 'PASS 1-2 OK, revirtiendo para el caso 3.';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        PRINT 'FAIL 1-2: ' + ERROR_MESSAGE();
    END CATCH;


    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.caja (proyecto_id, tag_caja, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-CAJA-A2-', @sufijo), 1, SYSUTCDATETIME());
        SET @caja_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.caja (proyecto_id, tag_caja, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-CAJA-B2-', @sufijo), 1, SYSUTCDATETIME());
        SET @caja_b = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-PLANO2-', @sufijo), 'Plano de prueba 032 (caso 3)', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_a, 'TB-1', 1, SYSUTCDATETIME());
        SET @bloque_a1 = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_b, 'TB-1', 1, SYSUTCDATETIME());
        SET @bloque_b = SCOPE_IDENTITY();

        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_a1;

        -- Caso 3
        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_b;

        PRINT 'FAIL 3: se permitio mezclar bloques de dos cajas distintas en el mismo plano (51038 no protegio).';
        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        IF ERROR_NUMBER() = 51038
            PRINT 'PASS 3: bloque de otra caja en el mismo plano rechazado por 51038, como se espera.';
        ELSE
            PRINT 'FAIL 3: error inesperado -- ' + ERROR_MESSAGE();
    END CATCH;


    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO nucleo.caja (proyecto_id, tag_caja, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-CAJA-A3-', @sufijo), 1, SYSUTCDATETIME());
        SET @caja_a = SCOPE_IDENTITY();

        INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id, activo, created_at)
        VALUES (@proyecto_id, CONCAT('TEST-032-PLANO3-', @sufijo), 'Plano de prueba 032 (caso 4)', @tipo_plano_id, 1, SYSUTCDATETIME());
        SET @plano_id = SCOPE_IDENTITY();

        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @caja_a, 'TB-1', 1, SYSUTCDATETIME());
        SET @bloque_a1 = SCOPE_IDENTITY();

        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_a1;

        UPDATE nucleo.caja_plano SET activo = 0 WHERE caja_id = @caja_a AND plano_id = @plano_id;

        UPDATE nucleo.bloque_terminal SET plano_id = @plano_id WHERE id = @bloque_a1;

        IF EXISTS (
            SELECT 1 FROM nucleo.caja_plano
            WHERE caja_id = @caja_a AND plano_id = @plano_id AND proyecto_id = @proyecto_id AND activo = 1
        )
            PRINT 'PASS 4: caja_plano reactivado al volver a tocar plano_id.';
        ELSE
            PRINT 'FAIL 4: caja_plano no se reactivo.';

        ROLLBACK TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        PRINT 'FAIL 4: ' + ERROR_MESSAGE();
    END CATCH;
END

PRINT '=== fin 032 ===';
GO
