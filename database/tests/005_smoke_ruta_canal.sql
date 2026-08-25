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
DECLARE @modulo_correcto_id BIGINT;
DECLARE @rack_id BIGINT;
DECLARE @catalogo_modulo_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @ai_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1)
    @canal_id = c.id,
    @modulo_correcto_id = c.modulo_id
FROM nucleo.canal c
WHERE c.proyecto_id = @proyecto_id
  AND c.numero_canal = 0
  AND c.activo = 1
ORDER BY c.id;

SELECT
    @rack_id = s.rack_id,
    @catalogo_modulo_id = m.catalogo_modulo_id
FROM nucleo.modulo m
JOIN nucleo.slot s
    ON s.id = m.slot_id
WHERE m.id = @modulo_correcto_id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';


IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @canal_id IS NULL OR @modulo_correcto_id IS NULL
    THROW 52002, 'No existe CH00 del TEST 001.', 1;


PRINT '=========================================';
PRINT 'TEST 005 - CANAL VS DESTINO DE RUTA';
PRINT '=========================================';

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @slot_incorrecto_id BIGINT;
    DECLARE @modulo_incorrecto_id BIGINT;

    DECLARE @instrumento_id BIGINT;
    DECLARE @senal_id BIGINT;

    DECLARE @cable_id BIGINT;
    DECLARE @par_id BIGINT;

    DECLARE @punto_instrumento_id BIGINT;
    DECLARE @punto_modulo_incorrecto_id BIGINT;

    DECLARE @ruta_id BIGINT;


    /* --------------------------------------------------------
       Crear otro SLOT y otro MÓDULO.
       CH00 de la señal pertenece al módulo original,
       NO a este módulo.
       -------------------------------------------------------- */

    INSERT INTO nucleo.slot
    (
        proyecto_id,
        rack_id,
        numero_slot
    )
    VALUES
    (
        @proyecto_id,
        @rack_id,
        2
    );

    SET @slot_incorrecto_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.modulo
    (
        proyecto_id,
        slot_id,
        catalogo_modulo_id
    )
    VALUES
    (
        @proyecto_id,
        @slot_incorrecto_id,
        @catalogo_modulo_id
    );

    SET @modulo_incorrecto_id = SCOPE_IDENTITY();


    /* --------------------------------------------------------
       Instrumento y señal asignada a CH00 DEL MÓDULO ORIGINAL
       -------------------------------------------------------- */

    INSERT INTO nucleo.instrumento
    (
        proyecto_id,
        tag_instrumento,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        N'PIT-RUTA-005',
        N'Prueba coherencia canal ruta'
    );

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
        N'PIT-RUTA-005.PV',
        N'Senal asignada a CH00 del modulo original'
    );

    SET @senal_id = SCOPE_IDENTITY();


    /* --------------------------------------------------------
       Cable y par
       -------------------------------------------------------- */

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
        N'CBL-RUTA-005',
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


    /* --------------------------------------------------------
       Punto inicial correcto: instrumento dueño de la señal
       -------------------------------------------------------- */

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
        N'Origen correcto'
    );

    SET @punto_instrumento_id = SCOPE_IDENTITY();


    /* --------------------------------------------------------
       ERROR INTENCIONAL:
       La ruta termina en OTRO módulo.
       -------------------------------------------------------- */

    INSERT INTO nucleo.punto_conexion
    (
        proyecto_id,
        modulo_id,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @modulo_incorrecto_id,
        N'Destino incorrecto: otro modulo'
    );

    SET @punto_modulo_incorrecto_id = SCOPE_IDENTITY();


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


    /* --------------------------------------------------------
       ESTE INSERT DEBE FALLAR
       -------------------------------------------------------- */

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
        @punto_instrumento_id,
        @punto_modulo_incorrecto_id,
        1
    );


    PRINT 'FAIL: SQL Server permitio que CH00 termine fisicamente en otro modulo.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS: SQL Server rechazo el modulo incorrecto.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 005';
PRINT '=========================================';
