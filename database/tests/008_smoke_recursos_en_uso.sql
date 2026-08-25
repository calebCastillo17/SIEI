SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @canal_id BIGINT;
DECLARE @modulo_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @ai_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1)
    @canal_id = c.id,
    @modulo_id = c.modulo_id
FROM nucleo.canal c
WHERE c.proyecto_id = @proyecto_id
  AND c.numero_canal = 0
  AND c.activo = 1
ORDER BY c.id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @canal_id IS NULL OR @modulo_id IS NULL
    THROW 52002, 'No existe CH00/modulo activo del TEST 001.', 1;

PRINT '=========================================';
PRINT 'TEST 008 - RECURSOS FISICOS EN USO';
PRINT '=========================================';


/* ============================================================
   CASO 1
   DESACTIVAR CANAL USADO POR SEÑAL ACTIVA
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RES-008A', N'Prueba canal en uso');

    SET @inst1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst1,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RES-008A.PV',
        N'Senal usando CH00'
    );

    UPDATE nucleo.canal
    SET activo = 0
    WHERE id = @canal_id;

    PRINT 'FAIL 1: SQL Server permitio desactivar un canal en uso.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 1: SQL Server rechazo desactivar un canal en uso.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   DESACTIVAR MODULO CON CANAL USADO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RES-008B', N'Prueba modulo en uso');

    SET @inst2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst2,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RES-008B.PV',
        N'Senal usando modulo'
    );

    UPDATE nucleo.modulo
    SET activo = 0
    WHERE id = @modulo_id;

    PRINT 'FAIL 2: SQL Server permitio desactivar un modulo en uso.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo desactivar un modulo en uso.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   DESACTIVAR CABLE USADO POR TRAMO ACTIVO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst3 BIGINT;
    DECLARE @senal3 BIGINT;
    DECLARE @cable3 BIGINT;
    DECLARE @par3 BIGINT;
    DECLARE @punto_inst3 BIGINT;
    DECLARE @punto_mod3 BIGINT;
    DECLARE @ruta3 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RES-008C', N'Prueba cable en uso');

    SET @inst3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst3,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RES-008C.PV',
        N'Senal con cable'
    );

    SET @senal3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RES-008C', N'Cable prueba', 2);

    SET @cable3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable3, 1);

    SET @par3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst3, N'Origen instrumento');

    SET @punto_inst3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Destino modulo');

    SET @punto_mod3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal3);

    SET @ruta3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden
    )
    VALUES
    (
        @proyecto_id,
        @ruta3,
        @par3,
        @punto_inst3,
        @punto_mod3,
        1
    );

    UPDATE nucleo.cable
    SET activo = 0
    WHERE id = @cable3;

    PRINT 'FAIL 3: SQL Server permitio desactivar un cable en uso.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 3: SQL Server rechazo desactivar un cable en uso.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4
   DESACTIVAR PUNTO USADO POR TRAMO ACTIVO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst4 BIGINT;
    DECLARE @senal4 BIGINT;
    DECLARE @cable4 BIGINT;
    DECLARE @par4 BIGINT;
    DECLARE @punto_inst4 BIGINT;
    DECLARE @punto_mod4 BIGINT;
    DECLARE @ruta4 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RES-008D', N'Prueba punto en uso');

    SET @inst4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst4,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RES-008D.PV',
        N'Senal con punto fisico'
    );

    SET @senal4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RES-008D', N'Cable prueba', 2);

    SET @cable4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable4, 1);

    SET @par4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst4, N'Origen instrumento');

    SET @punto_inst4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Destino modulo');

    SET @punto_mod4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal4);

    SET @ruta4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden
    )
    VALUES
    (
        @proyecto_id,
        @ruta4,
        @par4,
        @punto_inst4,
        @punto_mod4,
        1
    );

    UPDATE nucleo.punto_conexion
    SET activo = 0
    WHERE id = @punto_inst4;

    PRINT 'FAIL 4: SQL Server permitio desactivar un punto en uso.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 4: SQL Server rechazo desactivar un punto en uso.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 008';
PRINT '=========================================';
