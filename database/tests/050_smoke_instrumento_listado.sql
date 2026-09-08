SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 050 - nucleo.instrumento.listado (migracion 044)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 55001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 050 - INSTRUMENTO.LISTADO (migracion 044)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - un instrumento nuevo, sin especificar listado, cae
   en el DEFAULT (1) -- el alta manual normal sigue "listado".
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'TEST-050-DEFAULT');
    SET @instrumento_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.instrumento WHERE id = @instrumento_id AND listado = 1)
        PRINT 'PASS 1: instrumento nuevo sin listado explicito queda con listado=1 (DEFAULT).';
    ELSE
        PRINT 'FAIL 1: listado deberia ser 1 por defecto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1 (excepcion): ' + ERROR_MESSAGE();
END CATCH


/* ============================================================
   CASO 2 - listado=0 es un dato de CONTENIDO, independiente de
   activo (que sigue siendo borrado logico) -- ambos conviven
   sin relacion entre si.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @instrumento_id2 BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, listado) VALUES (@proyecto_id, N'TEST-050-NOLISTADO', 0);
    SET @instrumento_id2 = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.instrumento WHERE id = @instrumento_id2 AND listado = 0 AND activo = 1)
        PRINT 'PASS 2: instrumento con listado=0 queda activo=1 igual -- son conceptos independientes.';
    ELSE
        PRINT 'FAIL 2: listado=0 no deberia afectar activo.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2 (excepcion): ' + ERROR_MESSAGE();
END CATCH

PRINT '=========================================';
PRINT 'TEST 050 - FIN';
PRINT '=========================================';
