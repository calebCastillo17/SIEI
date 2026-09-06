SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 038 - nucleo.documento, nucleo.nota, nucleo.instrumento_nota,
 * nucleo.instrumento_documento, cat.cat_tipo_documento, cat.cat_fabricante
 * (migracion 031)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53801, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 038 - DOCUMENTO / NOTA / FABRICANTE (migracion 031)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - cat.cat_tipo_documento + nucleo.documento: alta basica,
   codigo_documento repetido SI se permite (sin unique, a proposito).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipo_hd_id BIGINT;
    INSERT INTO cat.cat_tipo_documento (codigo, descripcion) VALUES (N'HOJA_DE_DATOS', N'Hoja de datos de instrumento');
    SET @tipo_hd_id = SCOPE_IDENTITY();

    DECLARE @documento_id BIGINT;
    INSERT INTO nucleo.documento (proyecto_id, codigo_documento, descripcion, tipo_documento_id, revision)
    VALUES (@proyecto_id, N'104-22043-4620003347-DSH-620-J-0004', N'Manómetros', @tipo_hd_id, N'B');
    SET @documento_id = SCOPE_IDENTITY();

    -- Un segundo documento con el MISMO codigo_documento debe aceptarse
    -- (sin unique, a diferencia de un catalogo cerrado).
    INSERT INTO nucleo.documento (proyecto_id, codigo_documento, descripcion, tipo_documento_id)
    VALUES (@proyecto_id, N'104-22043-4620003347-DSH-620-J-0004', N'Duplicado deliberado', @tipo_hd_id);

    IF EXISTS (SELECT 1 FROM nucleo.documento WHERE proyecto_id = @proyecto_id AND codigo_documento = N'104-22043-4620003347-DSH-620-J-0004' HAVING COUNT(*) = 2)
        PRINT 'PASS 1: documento persistio y codigo_documento repetido fue aceptado (sin unique, a proposito).';
    ELSE
        PRINT 'FAIL 1: no se comporto como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un INSERT valido de documento.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - nucleo.instrumento_documento: N:M real, reasociar reactiva
   en vez de duplicar (mismo patron que gabinete_plano).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipo_id2 BIGINT;
    INSERT INTO cat.cat_tipo_documento (codigo, descripcion) VALUES (N'HOJA_DE_DATOS_038', N'Test');
    SET @tipo_id2 = SCOPE_IDENTITY();

    DECLARE @doc_id2 BIGINT;
    INSERT INTO nucleo.documento (proyecto_id, descripcion, tipo_documento_id) VALUES (@proyecto_id, N'Doc test 038', @tipo_id2);
    SET @doc_id2 = SCOPE_IDENTITY();

    DECLARE @instrumento_id2 BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'TEST-038-PI-001');
    SET @instrumento_id2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento_documento (proyecto_id, instrumento_id, documento_id)
    VALUES (@proyecto_id, @instrumento_id2, @doc_id2);

    -- Duplicado activo debe rechazarse.
    BEGIN TRY
        INSERT INTO nucleo.instrumento_documento (proyecto_id, instrumento_id, documento_id)
        VALUES (@proyecto_id, @instrumento_id2, @doc_id2);
        PRINT 'FAIL 2: se acepto una asociacion activa duplicada (deberia rechazarse por UX_instrumento_documento_activo).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: asociacion activa duplicada rechazada correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en instrumento_documento.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - nucleo.nota: numeracion propia POR documento (dos documentos
   pueden repetir el numero 1 sin chocar), duplicado dentro del MISMO
   documento se rechaza.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipo_id3 BIGINT;
    INSERT INTO cat.cat_tipo_documento (codigo, descripcion) VALUES (N'HOJA_DE_DATOS_038B', N'Test');
    SET @tipo_id3 = SCOPE_IDENTITY();

    DECLARE @doc_a BIGINT, @doc_b BIGINT;
    INSERT INTO nucleo.documento (proyecto_id, descripcion, tipo_documento_id) VALUES (@proyecto_id, N'Doc A', @tipo_id3);
    SET @doc_a = SCOPE_IDENTITY();
    INSERT INTO nucleo.documento (proyecto_id, descripcion, tipo_documento_id) VALUES (@proyecto_id, N'Doc B', @tipo_id3);
    SET @doc_b = SCOPE_IDENTITY();

    INSERT INTO nucleo.nota (proyecto_id, documento_id, numero, texto) VALUES (@proyecto_id, @doc_a, 1, N'Nota 1 del documento A');
    INSERT INTO nucleo.nota (proyecto_id, documento_id, numero, texto) VALUES (@proyecto_id, @doc_b, 1, N'Nota 1 del documento B');

    PRINT 'PASS 3a: el mismo numero de nota en DOS documentos distintos fue aceptado.';

    BEGIN TRY
        INSERT INTO nucleo.nota (proyecto_id, documento_id, numero, texto) VALUES (@proyecto_id, @doc_a, 1, N'Nota 1 duplicada del documento A');
        PRINT 'FAIL 3b: se acepto un numero de nota repetido dentro del MISMO documento (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3b: numero de nota repetido dentro del mismo documento rechazado por UX_nota_documento_numero.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado en nota.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - nucleo.instrumento_nota + cat.cat_fabricante: alta basica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipo_id4 BIGINT;
    INSERT INTO cat.cat_tipo_documento (codigo, descripcion) VALUES (N'HOJA_DE_DATOS_038C', N'Test');
    SET @tipo_id4 = SCOPE_IDENTITY();

    DECLARE @doc4 BIGINT;
    INSERT INTO nucleo.documento (proyecto_id, descripcion, tipo_documento_id) VALUES (@proyecto_id, N'Doc test 038c', @tipo_id4);
    SET @doc4 = SCOPE_IDENTITY();

    DECLARE @nota4 BIGINT;
    INSERT INTO nucleo.nota (proyecto_id, documento_id, numero, texto) VALUES (@proyecto_id, @doc4, 1, N'Nota de prueba');
    SET @nota4 = SCOPE_IDENTITY();

    DECLARE @instrumento4 BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'TEST-038-PI-002');
    SET @instrumento4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento_nota (proyecto_id, instrumento_id, nota_id) VALUES (@proyecto_id, @instrumento4, @nota4);

    IF EXISTS (SELECT 1 FROM nucleo.instrumento_nota WHERE instrumento_id = @instrumento4 AND nota_id = @nota4)
        PRINT 'PASS 4a: instrumento_nota persistio correctamente.';
    ELSE
        PRINT 'FAIL 4a: instrumento_nota no persistio.';

    INSERT INTO cat.cat_fabricante (codigo, descripcion) VALUES (N'ROSEMOUNT_038', N'Rosemount / Emerson');

    IF EXISTS (SELECT 1 FROM cat.cat_fabricante WHERE codigo = N'ROSEMOUNT_038')
        PRINT 'PASS 4b: cat_fabricante persistio correctamente.';
    ELSE
        PRINT 'FAIL 4b: cat_fabricante no persistio.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 038';
PRINT '=========================================';
