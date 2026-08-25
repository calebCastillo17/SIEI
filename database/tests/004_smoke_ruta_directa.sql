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
    THROW 52001, 'No existe el proyecto TEST-001. Ejecuta primero TEST 001.', 1;

IF @canal_id IS NULL OR @modulo_id IS NULL
    THROW 52002, 'No se encontro CH00/modulo del TEST 001.', 1;


PRINT '=========================================';
PRINT 'TEST 004 - RUTA FISICA DIRECTA';
PRINT '=========================================';


/* ============================================================
   CASO 1
   INSTRUMENTO -> MODULO CORRECTO
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_id BIGINT;
    DECLARE @senal_id BIGINT;
    DECLARE @cable_id BIGINT;
    DECLARE @par_id BIGINT;
    DECLARE @punto_origen_id BIGINT;
    DECLARE @punto_destino_id BIGINT;
    DECLARE @ruta_id BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-001', N'Instrumento prueba ruta directa');

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
        N'PIT-RUTA-001.PV',
        N'Senal AI prueba ruta directa'
    );

    SET @senal_id = SCOPE_IDENTITY();


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
        N'CBL-RUTA-001',
        N'Cable prueba',
        2
    );

    SET @cable_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
    (
        proyecto_id,
        cable_id,
        numero_par
    )
    VALUES
    (
        @proyecto_id,
        @cable_id,
        1
    );

    SET @par_id = SCOPE_IDENTITY();


    -- Punto físico en el instrumento
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
        N'Borneras del instrumento'
    );

    SET @punto_origen_id = SCOPE_IDENTITY();


    -- Punto físico en el mismo módulo donde está CH00
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
        N'Entrada módulo AI'
    );

    SET @punto_destino_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
    (
        proyecto_id,
        senal_id
    )
    VALUES
    (
        @proyecto_id,
        @senal_id
    );

    SET @ruta_id = SCOPE_IDENTITY();


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
        @par_id,
        @punto_origen_id,
        @punto_destino_id,
        1
    );

    PRINT 'PASS 1: INSTRUMENTO -> MODULO correcto fue aceptado.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: una ruta fisica valida fue rechazada.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   LA SEÑAL PERTENECE A INSTRUMENTO A
   PERO LA RUTA COMIENZA EN INSTRUMENTO B
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_A BIGINT;
    DECLARE @instrumento_B BIGINT;
    DECLARE @senal_2 BIGINT;
    DECLARE @cable_2 BIGINT;
    DECLARE @par_2 BIGINT;
    DECLARE @punto_equivocado BIGINT;
    DECLARE @punto_modulo_2 BIGINT;
    DECLARE @ruta_2 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-A', N'Dueno real de la senal');

    SET @instrumento_A = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-B', N'Instrumento incorrecto para la ruta');

    SET @instrumento_B = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @instrumento_A,
        @control_id,
        @ai_id,
        N'PIT-RUTA-A.PV',
        N'Senal cuyo dueno real es PIT-RUTA-A'
    );

    SET @senal_2 = SCOPE_IDENTITY();


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
        N'CBL-RUTA-002',
        N'Cable prueba',
        2
    );

    SET @cable_2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
    (
        proyecto_id,
        cable_id,
        numero_par
    )
    VALUES
    (
        @proyecto_id,
        @cable_2,
        1
    );

    SET @par_2 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    -- el punto inicial pertenece a PIT-RUTA-B,
    -- aunque la señal pertenece a PIT-RUTA-A.
    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        instrumento_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @instrumento_B,
        N'Origen incorrecto intencional'
    );

    SET @punto_equivocado = SCOPE_IDENTITY();


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

    SET @punto_modulo_2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
    (
        proyecto_id,
        senal_id
    )
    VALUES
    (
        @proyecto_id,
        @senal_2
    );

    SET @ruta_2 = SCOPE_IDENTITY();


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
        @ruta_2,
        @par_2,
        @punto_equivocado,
        @punto_modulo_2,
        1
    );


    PRINT 'FAIL 2: SQL Server permitio una ruta cuyo origen no es el dueno de la senal.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo el origen incorrecto.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 004';
PRINT '=========================================';
