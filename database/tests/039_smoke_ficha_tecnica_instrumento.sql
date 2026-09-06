SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 039 - nucleo.ficha_tecnica_instrumento, nucleo.tag_proceso,
 * cat.cat_requisito, nucleo.ficha_tecnica_requisito, nucleo.marca_aceptable
 * (migracion 032)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53901, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 039 - FICHA_TECNICA_INSTRUMENTO (migracion 032)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - ficha_tecnica_instrumento: VARIOS tags comparten la MISMA
   ficha tecnica (el motivo de que exista esta tabla aparte).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @fabricante_id BIGINT;
    INSERT INTO cat.cat_fabricante (codigo, descripcion) VALUES (N'ASHCROFT_039', N'Ashcroft');
    SET @fabricante_id = SCOPE_IDENTITY();

    DECLARE @ficha_id BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, fabricante_id, modelo, grado_proteccion, codigo_referencia)
    VALUES (@proyecto_id, @fabricante_id, N'VTS', N'IP66', N'INS-DOC-01-01');
    SET @ficha_id = SCOPE_IDENTITY();

    DECLARE @tag1 BIGINT, @tag2 BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, ficha_tecnica_id) VALUES (@proyecto_id, N'TEST-039-PI-001', @ficha_id);
    SET @tag1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, ficha_tecnica_id) VALUES (@proyecto_id, N'TEST-039-PI-002', @ficha_id);
    SET @tag2 = SCOPE_IDENTITY();

    IF (SELECT COUNT(*) FROM nucleo.instrumento WHERE ficha_tecnica_id = @ficha_id) = 2
        PRINT 'PASS 1: dos tags distintos comparten la misma ficha tecnica correctamente.';
    ELSE
        PRINT 'FAIL 1: no se pudo compartir la ficha tecnica entre dos tags.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un caso valido de ficha tecnica compartida.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - tag_proceso: dos tags con la MISMA ficha tecnica pueden tener
   condiciones de proceso DISTINTAS (cuelga del tag, no de la ficha).
   Duplicar la misma variable en el mismo tag se rechaza.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tagA BIGINT, @tagB BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'TEST-039-PI-003');
    SET @tagA = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'TEST-039-PI-004');
    SET @tagB = SCOPE_IDENTITY();

    INSERT INTO nucleo.tag_proceso (proyecto_id, instrumento_id, variable, valor_max, unidad) VALUES (@proyecto_id, @tagA, N'Flujo', N'14', N'm3/h');
    INSERT INTO nucleo.tag_proceso (proyecto_id, instrumento_id, variable, valor_max, unidad) VALUES (@proyecto_id, @tagB, N'Flujo', N'VTS', N'm3/h');

    PRINT 'PASS 2a: dos tags distintos con la misma variable de proceso (valores distintos) fueron aceptados.';

    BEGIN TRY
        INSERT INTO nucleo.tag_proceso (proyecto_id, instrumento_id, variable, valor_max) VALUES (@proyecto_id, @tagA, N'Flujo', N'999');
        PRINT 'FAIL 2b: se acepto una variable de proceso repetida en el MISMO tag (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2b: variable de proceso repetida en el mismo tag rechazada por UX_tag_proceso_instrumento_variable.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en tag_proceso.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - ficha_tecnica_requisito: el MISMO requisito puede repetirse
   2 veces en la misma ficha tecnica con detalle distinto (caso real
   REQ-BRACKET, confirmado por la usuaria) — NO debe rechazarse.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @req_id BIGINT;
    INSERT INTO cat.cat_requisito (codigo, descripcion, categoria) VALUES (N'REQ-BRACKET-039', N'Brackets de fijación', N'Suministro');
    SET @req_id = SCOPE_IDENTITY();

    DECLARE @ficha3 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ficha_tecnica_requisito (proyecto_id, ficha_tecnica_id, requisito_id, valor, detalle)
    VALUES (@proyecto_id, @ficha3, @req_id, N'REQUERIDO', N'Brackets fijación fuente radioactiva');
    INSERT INTO nucleo.ficha_tecnica_requisito (proyecto_id, ficha_tecnica_id, requisito_id, valor, detalle)
    VALUES (@proyecto_id, @ficha3, @req_id, N'REQUERIDO', N'Brackets fijación detector/transmisor');

    IF (SELECT COUNT(*) FROM nucleo.ficha_tecnica_requisito WHERE ficha_tecnica_id = @ficha3 AND requisito_id = @req_id) = 2
        PRINT 'PASS 3a: el mismo requisito se repitio 2 veces con detalle distinto (caso real REQ-BRACKET) sin rechazarse.';
    ELSE
        PRINT 'FAIL 3a: no se permitio el caso real REQ-BRACKET.';

    BEGIN TRY
        INSERT INTO nucleo.ficha_tecnica_requisito (proyecto_id, ficha_tecnica_id, requisito_id, valor)
        VALUES (@proyecto_id, @ficha3, @req_id, N'INVALIDO');
        PRINT 'FAIL 3b: se acepto un valor fuera del CHECK (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3b: valor invalido rechazado por CK_ficha_tecnica_requisito_valor.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado en ficha_tecnica_requisito.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - marca_aceptable: SI se rechaza un duplicado exacto
   (ficha_tecnica, componente, fabricante) mientras este activo.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @fabricante4 BIGINT;
    INSERT INTO cat.cat_fabricante (codigo, descripcion) VALUES (N'SIEMENS_039', N'Siemens');
    SET @fabricante4 = SCOPE_IDENTITY();

    DECLARE @ficha4 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.marca_aceptable (proyecto_id, ficha_tecnica_id, componente, fabricante_id, preferente)
    VALUES (@proyecto_id, @ficha4, N'transmisor', @fabricante4, 1);

    BEGIN TRY
        INSERT INTO nucleo.marca_aceptable (proyecto_id, ficha_tecnica_id, componente, fabricante_id)
        VALUES (@proyecto_id, @ficha4, N'transmisor', @fabricante4);
        PRINT 'FAIL 4: se acepto una marca aceptable duplicada (deberia rechazarse por UX_marca_aceptable_activo).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 4: marca aceptable duplicada rechazada correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: error inesperado en marca_aceptable.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 039';
PRINT '=========================================';
