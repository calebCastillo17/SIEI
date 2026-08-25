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
    THROW 52002, 'No existe CH00/modulo del TEST 001.', 1;


PRINT '=========================================';
PRINT 'TEST 006 - RUTA CON CAJA INTERMEDIA';
PRINT '=========================================';


/* ============================================================
   CASO 1
   INSTRUMENTO -> CAJA -> MODULO
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_id BIGINT;
    DECLARE @senal_id BIGINT;
    DECLARE @caja_id BIGINT;

    DECLARE @cable_1_id BIGINT;
    DECLARE @cable_2_id BIGINT;
    DECLARE @par_1_id BIGINT;
    DECLARE @par_2_id BIGINT;

    DECLARE @punto_instrumento_id BIGINT;
    DECLARE @punto_caja_id BIGINT;
    DECLARE @punto_modulo_id BIGINT;

    DECLARE @ruta_id BIGINT;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-006', N'Instrumento ruta con caja');

    SET @instrumento_id = SCOPE_IDENTITY();


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
        @instrumento_id,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RUTA-006.PV',
        N'Senal AI con caja intermedia'
    );

    SET @senal_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.caja
        (proyecto_id, tag_caja, descripcion)
    VALUES
        (@proyecto_id, N'JB-RUTA-006', N'Caja intermedia prueba');

    SET @caja_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-006A', N'Cable campo-caja', 2);

    SET @cable_1_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable_1_id, 1);

    SET @par_1_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-006B', N'Cable caja-panel', 2);

    SET @cable_2_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable_2_id, 1);

    SET @par_2_id = SCOPE_IDENTITY();


    -- Punto origen: instrumento
    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        instrumento_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @instrumento_id,
        N'Salida instrumento'
    );

    SET @punto_instrumento_id = SCOPE_IDENTITY();


    -- Punto intermedio: caja
    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        caja_id,
        regleta,
        bornera,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @caja_id,
        N'TB1',
        N'1',
        N'Bornera caja'
    );

    SET @punto_caja_id = SCOPE_IDENTITY();


    -- Punto final: módulo correspondiente a CH00
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
        N'Entrada modulo AI'
    );

    SET @punto_modulo_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal_id);

    SET @ruta_id = SCOPE_IDENTITY();


    /*
       IMPORTANTE:
       Los DOS tramos se insertan en una sola sentencia.
    */
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
        @ruta_id,
        @par_1_id,
        @punto_instrumento_id,
        @punto_caja_id,
        1
    ),
    (
        @proyecto_id,
        @ruta_id,
        @par_2_id,
        @punto_caja_id,
        @punto_modulo_id,
        2
    );


    PRINT 'PASS 1: INSTRUMENTO -> CAJA -> MODULO fue aceptado.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: una ruta valida con caja fue rechazada.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   RUTA DISCONTINUA EN LA CAJA
   TRAMO 1 TERMINA EN PUNTO A
   TRAMO 2 COMIENZA EN PUNTO B
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_2_id BIGINT;
    DECLARE @senal_2_id BIGINT;
    DECLARE @caja_2_id BIGINT;

    DECLARE @cable_3_id BIGINT;
    DECLARE @cable_4_id BIGINT;
    DECLARE @par_3_id BIGINT;
    DECLARE @par_4_id BIGINT;

    DECLARE @punto_instrumento_2 BIGINT;
    DECLARE @punto_caja_A BIGINT;
    DECLARE @punto_caja_B BIGINT;
    DECLARE @punto_modulo_2 BIGINT;

    DECLARE @ruta_2_id BIGINT;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-006B', N'Prueba discontinuidad');

    SET @instrumento_2_id = SCOPE_IDENTITY();


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
        @instrumento_2_id,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-RUTA-006B.PV',
        N'Senal prueba discontinuidad'
    );

    SET @senal_2_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.caja
        (proyecto_id, tag_caja, descripcion)
    VALUES
        (@proyecto_id, N'JB-RUTA-006B', N'Caja prueba discontinuidad');

    SET @caja_2_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-006C', N'Cable 1', 2);

    SET @cable_3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable_3_id, 1);

    SET @par_3_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-006D', N'Cable 2', 2);

    SET @cable_4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable_4_id, 1);

    SET @par_4_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @instrumento_2_id, N'Origen');

    SET @punto_instrumento_2 = SCOPE_IDENTITY();


    -- Punto A de la caja
    INSERT INTO nucleo.punto_conexion
        (proyecto_id, caja_id, regleta, bornera, descripcion)
    VALUES
        (@proyecto_id, @caja_2_id, N'TB1', N'1', N'Punto A');

    SET @punto_caja_A = SCOPE_IDENTITY();


    -- Punto B diferente de la misma caja
    INSERT INTO nucleo.punto_conexion
        (proyecto_id, caja_id, regleta, bornera, descripcion)
    VALUES
        (@proyecto_id, @caja_2_id, N'TB1', N'2', N'Punto B');

    SET @punto_caja_B = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Destino modulo');

    SET @punto_modulo_2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal_2_id);

    SET @ruta_2_id = SCOPE_IDENTITY();


    /*
       ERROR INTENCIONAL:

       Tramo 1 termina en @punto_caja_A
       Tramo 2 comienza en @punto_caja_B
    */
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
        @ruta_2_id,
        @par_3_id,
        @punto_instrumento_2,
        @punto_caja_A,
        1
    ),
    (
        @proyecto_id,
        @ruta_2_id,
        @par_4_id,
        @punto_caja_B,
        @punto_modulo_2,
        2
    );


    PRINT 'FAIL 2: SQL Server permitio una ruta discontinua.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo la ruta discontinua.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 006';
PRINT '=========================================';
