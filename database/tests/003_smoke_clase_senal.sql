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
DECLARE @control_id BIGINT;
DECLARE @com_id BIGINT;
DECLARE @ai_id BIGINT;
DECLARE @direccion_in_id BIGINT;
DECLARE @instrumento_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1) @canal_id = c.id
FROM nucleo.canal c
WHERE c.proyecto_id = @proyecto_id
  AND c.numero_canal = 0
  AND c.activo = 1
ORDER BY c.id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @com_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'COM';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

SELECT @direccion_in_id = id
FROM cat.cat_direccion_com
WHERE codigo = N'IN';

PRINT '=========================================';
PRINT 'TEST 003 - REGLAS CONTROL / COM';
PRINT '=========================================';


/* ============================================================
   CASO 1
   CONTROL + AI + CANAL
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-003', N'Prueba CONTROL válida');

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
        N'PIT-TEST-003.PV',
        N'CONTROL AI válida'
    );

    PRINT 'PASS 1: CONTROL + AI + canal fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: CONTROL + AI + canal fue rechazado.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   COM + AI + CANAL
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-004', N'Prueba COM inválida');

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
        @com_id,
        @ai_id,
        @canal_id,
        N'PIT-TEST-004.COM',
        N'COM intentando utilizar canal AI'
    );

    PRINT 'FAIL 2: COM + AI + canal fue permitido.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: COM + AI + canal fue rechazado.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   CONTROL + DIRECCION_COM
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-005', N'Prueba CONTROL con direccion COM');

    SET @instrumento_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        direccion_com_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @instrumento_id,
        @control_id,
        @ai_id,
        @direccion_in_id,
        N'PIT-TEST-005.PV',
        N'CONTROL intentando utilizar DIRECCION_COM'
    );

    PRINT 'FAIL 3: CONTROL + DIRECCION_COM fue permitido.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 3: CONTROL + DIRECCION_COM fue rechazado.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 003';
PRINT '=========================================';
