SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @cliente_id BIGINT;
DECLARE @proyecto1_id BIGINT;
DECLARE @proyecto2_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @instrumento_p1 BIGINT;

SELECT @proyecto1_id = id,
       @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

IF @proyecto1_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 010 - AISLAMIENTO MULTIPROYECTO';
PRINT '=========================================';


/* ============================================================
   CASO 1
   MISMO TAG EN EL MISMO PROYECTO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto1_id, N'PIT-MULTI-010', N'Primer instrumento');

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto1_id, N'PIT-MULTI-010', N'Duplicado intencional');

    PRINT 'FAIL 1: SQL Server permitio TAG duplicado en el mismo proyecto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 1: SQL Server rechazo TAG duplicado dentro del proyecto.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   MISMO TAG EN DOS PROYECTOS DIFERENTES
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.proyecto
        (cliente_id, codigo_proyecto, nombre)
    VALUES
        (@cliente_id, N'TEST-002', N'Segundo proyecto de prueba');

    SET @proyecto2_id = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto1_id, N'PIT-MULTI-010', N'Instrumento Proyecto 1');

    SET @instrumento_p1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto2_id, N'PIT-MULTI-010', N'Instrumento Proyecto 2');

    PRINT 'PASS 2: el mismo TAG fue permitido en proyectos diferentes.';


    /* ========================================================
       CASO 3
       UNA SEÑAL DE PROYECTO 2 INTENTA USAR
       UN INSTRUMENTO DEL PROYECTO 1
       DEBE SER RECHAZADO
       ======================================================== */

    BEGIN TRY

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
            @proyecto2_id,
            @instrumento_p1,
            @control_id,
            N'SENAL-CROSS-010',
            N'Cruce de proyecto intencional'
        );

        PRINT 'FAIL 3: SQL Server permitio referencia entre proyectos.';

    END TRY
    BEGIN CATCH

        PRINT 'PASS 3: SQL Server rechazo la referencia entre proyectos.';
        PRINT 'Error esperado:';
        PRINT ERROR_MESSAGE();

    END CATCH;


    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL GENERAL TEST 010.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 010';
PRINT '=========================================';
