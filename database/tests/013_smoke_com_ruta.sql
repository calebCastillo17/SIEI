SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @com_id BIGINT;
DECLARE @direccion_in_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @com_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'COM';

SELECT @direccion_in_id = id
FROM cat.cat_direccion_com
WHERE codigo = N'IN';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 013 - COM VS RUTA CABLEADA';
PRINT '=========================================';


/* ============================================================
   CASO 1
   SEÑAL COM + RUTA ACTIVA
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @equipo1 BIGINT;
    DECLARE @senal1 BIGINT;

    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'EQ-COM-013A', N'Equipo COM prueba ruta');

    SET @equipo1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        equipo_id,
        clase_senal_id,
        direccion_com_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @equipo1,
        @com_id,
        @direccion_in_id,
        N'EQ-COM-013A.STATUS',
        N'Senal COM'
    );

    SET @senal1 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    -- una señal COM no puede tener ruta física activa.
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


    PRINT 'FAIL 1: SQL Server permitio una ruta activa para señal COM.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 1: SQL Server rechazo una ruta activa para señal COM.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   CONTROL CON RUTA ACTIVA -> CAMBIAR A COM
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento2 BIGINT;
    DECLARE @senal2 BIGINT;
    DECLARE @ruta2 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-COM-013B', N'Instrumento inicialmente CONTROL');

    SET @instrumento2 = SCOPE_IDENTITY();


    /*
       Dejamos tipo_io_id, canal_id y direccion_com_id en NULL.
       Así aislamos específicamente la regla:
       CONTROL con ruta activa no puede pasar a COM.
    */
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
        @instrumento2,
        @control_id,
        N'PIT-COM-013B.TEST',
        N'CONTROL con ruta activa'
    );

    SET @senal2 = SCOPE_IDENTITY();


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
        1
    );

    SET @ruta2 = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL:
    UPDATE nucleo.senal
    SET clase_senal_id = @com_id
    WHERE id = @senal2;


    PRINT 'FAIL 2: SQL Server permitio CONTROL -> COM con ruta activa.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazo CONTROL -> COM con ruta activa.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   SEÑAL COM + RUTA INACTIVA
   DEBE SER PERMITIDO

   Esto representa historial, no una conexión cableada vigente.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @equipo3 BIGINT;
    DECLARE @senal3 BIGINT;
    DECLARE @ruta3 BIGINT;

    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo, descripcion)
    VALUES
        (@proyecto_id, N'EQ-COM-013C', N'Equipo COM con historial');

    SET @equipo3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        equipo_id,
        clase_senal_id,
        direccion_com_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @equipo3,
        @com_id,
        @direccion_in_id,
        N'EQ-COM-013C.STATUS',
        N'Senal COM con ruta histórica'
    );

    SET @senal3 = SCOPE_IDENTITY();


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
        0
    );

    SET @ruta3 = SCOPE_IDENTITY();


    IF NOT EXISTS (
        SELECT 1
        FROM nucleo.ruta_conexion
        WHERE id = @ruta3
          AND activo = 0
    )
        THROW 52130,
        'FAIL: no se pudo conservar una ruta historica inactiva.',
        1;


    PRINT 'PASS 3: una señal COM puede conservar una ruta historica inactiva.';


    /* --------------------------------------------------------
       Ahora intentamos REACTIVAR esa ruta.
       Debe fallar.
       -------------------------------------------------------- */

    BEGIN TRY

        UPDATE nucleo.ruta_conexion
        SET activo = 1
        WHERE id = @ruta3;

        PRINT 'FAIL 4: SQL Server permitio reactivar una ruta de señal COM.';

    END TRY
    BEGIN CATCH

        PRINT 'PASS 4: SQL Server rechazo reactivar la ruta de señal COM.';
        PRINT 'Error esperado:';
        PRINT ERROR_MESSAGE();

    END CATCH;


    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL GENERAL CASO 3.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 013';
PRINT '=========================================';
