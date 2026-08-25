SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @modulo_id BIGINT;
DECLARE @control_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1)
    @modulo_id = c.modulo_id
FROM nucleo.canal c
WHERE c.proyecto_id = @proyecto_id
  AND c.activo = 1
ORDER BY c.id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @modulo_id IS NULL
    THROW 52002, 'No existe un modulo activo para TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 014 - ESTADOS RUTA / TRAMO';
PRINT '=========================================';


/* ============================================================
   CASO 1
   RUTA ACTIVA PARA SEÑAL INACTIVA
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1 BIGINT;
    DECLARE @senal1 BIGINT;

    INSERT INTO nucleo.instrumento
    (
        proyecto_id,
        tag_instrumento,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        N'PIT-EST-014A',
        N'Instrumento prueba señal inactiva'
    );

    SET @inst1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tag_senal,
        descripcion,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @inst1,
        @control_id,
        N'PIT-EST-014A.TEST',
        N'Señal inactiva',
        0
    );

    SET @senal1 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    -- una ruta activa no debe depender
    -- de una señal inactiva.
    INSERT INTO nucleo.ruta_conexion
    (
        proyecto_id,
        senal_id,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @senal1,
        1
    );


    PRINT 'FAIL 1: SQL Server permitio RUTA activa para SEÑAL inactiva.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 1: SQL Server rechazo RUTA activa para SEÑAL inactiva.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   TRAMO ACTIVO PARA RUTA INACTIVA
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2 BIGINT;
    DECLARE @senal2 BIGINT;
    DECLARE @ruta2 BIGINT;

    DECLARE @cable2 BIGINT;
    DECLARE @par2 BIGINT;

    DECLARE @p_inst2 BIGINT;
    DECLARE @p_mod2 BIGINT;


    INSERT INTO nucleo.instrumento
    (
        proyecto_id,
        tag_instrumento,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        N'PIT-EST-014B',
        N'Instrumento prueba ruta inactiva'
    );

    SET @inst2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst2,
        @control_id,
        N'PIT-EST-014B.TEST',
        N'Señal CONTROL'
    );

    SET @senal2 = SCOPE_IDENTITY();


    -- La ruta nace INACTIVA.
    INSERT INTO nucleo.ruta_conexion
    (
        proyecto_id,
        senal_id,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @senal2,
        0
    );

    SET @ruta2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
    (
        proyecto_id,
        tag_cable,
        tipo_cable,
        capacidad_conductores
    )
    VALUES
    (
        @proyecto_id,
        N'CBL-EST-014B',
        N'Cable prueba',
        2
    );

    SET @cable2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
    (
        proyecto_id,
        cable_id,
        numero_par
    )
    VALUES
    (
        @proyecto_id,
        @cable2,
        1
    );

    SET @par2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        instrumento_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst2,
        N'Origen instrumento'
    );

    SET @p_inst2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        modulo_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @modulo_id,
        N'Destino modulo'
    );

    SET @p_mod2 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    -- TRAMO activo bajo una RUTA inactiva.
    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @ruta2,
        @par2,
        @p_inst2,
        @p_mod2,
        1,
        1
    );


    PRINT 'FAIL 2: SQL Server permitio TRAMO activo bajo RUTA inactiva.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo TRAMO activo bajo RUTA inactiva.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   DESACTIVAR UNA RUTA ACTIVA

   SU TRAMO ACTIVO DEBE DESACTIVARSE
   AUTOMATICAMENTE
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst3 BIGINT;
    DECLARE @senal3 BIGINT;
    DECLARE @ruta3 BIGINT;
    DECLARE @tramo3 BIGINT;

    DECLARE @cable3 BIGINT;
    DECLARE @par3 BIGINT;

    DECLARE @p_inst3 BIGINT;
    DECLARE @p_mod3 BIGINT;


    INSERT INTO nucleo.instrumento
    (
        proyecto_id,
        tag_instrumento,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        N'PIT-EST-014C',
        N'Instrumento prueba cascada ruta'
    );

    SET @inst3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst3,
        @control_id,
        N'PIT-EST-014C.TEST',
        N'Señal CONTROL'
    );

    SET @senal3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
    (
        proyecto_id,
        tag_cable,
        tipo_cable,
        capacidad_conductores
    )
    VALUES
    (
        @proyecto_id,
        N'CBL-EST-014C',
        N'Cable prueba',
        2
    );

    SET @cable3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
    (
        proyecto_id,
        cable_id,
        numero_par
    )
    VALUES
    (
        @proyecto_id,
        @cable3,
        1
    );

    SET @par3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        instrumento_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst3,
        N'Origen instrumento'
    );

    SET @p_inst3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        modulo_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @modulo_id,
        N'Destino modulo'
    );

    SET @p_mod3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
    (
        proyecto_id,
        senal_id,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @senal3,
        1
    );

    SET @ruta3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @ruta3,
        @par3,
        @p_inst3,
        @p_mod3,
        1,
        1
    );

    SET @tramo3 = SCOPE_IDENTITY();


    -- Desactivar solamente la ruta.
    UPDATE nucleo.ruta_conexion
    SET activo = 0
    WHERE id = @ruta3;


    IF EXISTS (
        SELECT 1
        FROM nucleo.ruta_conexion
        WHERE id = @ruta3
          AND activo <> 0
    )
        THROW 52140,
        'FAIL: la ruta no quedo inactiva.',
        1;


    IF EXISTS (
        SELECT 1
        FROM nucleo.tramo_conexion
        WHERE id = @tramo3
          AND activo <> 0
    )
        THROW 52141,
        'FAIL: el tramo no fue desactivado automaticamente.',
        1;


    PRINT 'PASS 3: la RUTA quedo inactiva.';
    PRINT 'PASS 4: el TRAMO se desactivo automaticamente con la RUTA.';


    SELECT
        r.id AS ruta_id,
        r.activo AS ruta_activa,
        t.id AS tramo_id,
        t.activo AS tramo_activo
    FROM nucleo.ruta_conexion r
    JOIN nucleo.tramo_conexion t
        ON t.ruta_conexion_id = r.id
    WHERE r.id = @ruta3;


    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 3.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 014';
PRINT '=========================================';
