SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 012 - COMUNICACIONES';
PRINT '=========================================';


/* ============================================================
   CASO 1
   EQUIPO -> ENLACE_COM -> PUERTO -> SWITCH
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @switch1 BIGINT;
    DECLARE @puerto1 BIGINT;
    DECLARE @equipo1 BIGINT;
    DECLARE @enlace1 BIGINT;

    INSERT INTO nucleo.switch
        (proyecto_id, tag_switch, descripcion)
    VALUES
        (@proyecto_id, N'SW-COM-012A', N'Switch de prueba');

    SET @switch1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.puerto
        (proyecto_id, switch_id, numero_puerto)
    VALUES
        (@proyecto_id, @switch1, 1);

    SET @puerto1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'ZMZ-COM-012A', N'Equipo comunicado');

    SET @equipo1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.enlace_com
    (
        proyecto_id,
        equipo_id,
        puerto_id,
        tag_medio
    )
    VALUES
    (
        @proyecto_id,
        @equipo1,
        @puerto1,
        N'ETH-COM-012A'
    );

    SET @enlace1 = SCOPE_IDENTITY();


    PRINT 'PASS 1: EQUIPO -> ENLACE_COM -> PUERTO -> SWITCH fue aceptado.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: un enlace COM valido fue rechazado.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   DOS EQUIPOS INTENTAN USAR EL MISMO PUERTO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @switch2 BIGINT;
    DECLARE @puerto2 BIGINT;
    DECLARE @equipo2A BIGINT;
    DECLARE @equipo2B BIGINT;

    INSERT INTO nucleo.switch
        (proyecto_id, tag_switch, descripcion)
    VALUES
        (@proyecto_id, N'SW-COM-012B', N'Switch prueba puerto unico');

    SET @switch2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.puerto
        (proyecto_id, switch_id, numero_puerto)
    VALUES
        (@proyecto_id, @switch2, 1);

    SET @puerto2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'ZMZ-COM-012B1', N'Equipo 1');

    SET @equipo2A = SCOPE_IDENTITY();


    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'ZMZ-COM-012B2', N'Equipo 2');

    SET @equipo2B = SCOPE_IDENTITY();


    INSERT INTO nucleo.enlace_com
        (proyecto_id, equipo_id, puerto_id)
    VALUES
        (@proyecto_id, @equipo2A, @puerto2);


    -- ERROR INTENCIONAL:
    -- segundo equipo usando el mismo puerto activo.
    INSERT INTO nucleo.enlace_com
        (proyecto_id, equipo_id, puerto_id)
    VALUES
        (@proyecto_id, @equipo2B, @puerto2);


    PRINT 'FAIL 2: SQL Server permitio dos enlaces activos en el mismo puerto.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo dos enlaces activos en el mismo puerto.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   EL MISMO EQUIPO INTENTA TENER DOS ENLACES ACTIVOS
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @switch3 BIGINT;
    DECLARE @puerto3A BIGINT;
    DECLARE @puerto3B BIGINT;
    DECLARE @equipo3 BIGINT;

    INSERT INTO nucleo.switch
        (proyecto_id, tag_switch, descripcion)
    VALUES
        (@proyecto_id, N'SW-COM-012C', N'Switch prueba equipo unico');

    SET @switch3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.puerto
        (proyecto_id, switch_id, numero_puerto)
    VALUES
        (@proyecto_id, @switch3, 1);

    SET @puerto3A = SCOPE_IDENTITY();


    INSERT INTO nucleo.puerto
        (proyecto_id, switch_id, numero_puerto)
    VALUES
        (@proyecto_id, @switch3, 2);

    SET @puerto3B = SCOPE_IDENTITY();


    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'ZMZ-COM-012C', N'Equipo unico');

    SET @equipo3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.enlace_com
        (proyecto_id, equipo_id, puerto_id)
    VALUES
        (@proyecto_id, @equipo3, @puerto3A);


    -- ERROR INTENCIONAL:
    -- mismo equipo con segundo enlace activo.
    INSERT INTO nucleo.enlace_com
        (proyecto_id, equipo_id, puerto_id)
    VALUES
        (@proyecto_id, @equipo3, @puerto3B);


    PRINT 'FAIL 3: SQL Server permitio dos enlaces activos para el mismo equipo.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 3: SQL Server rechazo dos enlaces activos para el mismo equipo.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 4
   ENLACE CON EQUIPO + INSTRUMENTO A LA VEZ
   DEBE SER RECHAZADO POR XOR
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @switch4 BIGINT;
    DECLARE @puerto4 BIGINT;
    DECLARE @equipo4 BIGINT;
    DECLARE @instrumento4 BIGINT;

    INSERT INTO nucleo.switch
        (proyecto_id, tag_switch, descripcion)
    VALUES
        (@proyecto_id, N'SW-COM-012D', N'Switch prueba XOR');

    SET @switch4 = SCOPE_IDENTITY();


    INSERT INTO nucleo.puerto
        (proyecto_id, switch_id, numero_puerto)
    VALUES
        (@proyecto_id, @switch4, 1);

    SET @puerto4 = SCOPE_IDENTITY();


    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'ZMZ-COM-012D', N'Equipo prueba XOR');

    SET @equipo4 = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-COM-012D', N'Instrumento prueba XOR');

    SET @instrumento4 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    -- un enlace no puede pertenecer simultaneamente
    -- a equipo e instrumento.
    INSERT INTO nucleo.enlace_com
    (
        proyecto_id,
        equipo_id,
        instrumento_id,
        puerto_id
    )
    VALUES
    (
        @proyecto_id,
        @equipo4,
        @instrumento4,
        @puerto4
    );


    PRINT 'FAIL 4: SQL Server permitio EQUIPO + INSTRUMENTO en el mismo enlace.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 4: SQL Server rechazo EQUIPO + INSTRUMENTO simultaneos.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 012';
PRINT '=========================================';
