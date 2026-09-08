SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 049 - nucleo.tuberia.tag_anterior (migracion 043)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54901, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 049 - TUBERIA.TAG_ANTERIOR (migracion 043)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - tag_anterior es NULL por defecto en una tuberia nueva
   (no se fuerza copia automatica al crear, solo existe el backfill
   historico aplicado una vez en la migracion).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tuberia_id BIGINT;
    INSERT INTO nucleo.tuberia (proyecto_id, tag_linea) VALUES (@proyecto_id, N'620-TL-049-TEST');
    SET @tuberia_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.tuberia WHERE id = @tuberia_id AND tag_anterior IS NULL)
        PRINT 'PASS 1: tuberia nueva se crea con tag_anterior NULL.';
    ELSE
        PRINT 'FAIL 1: tag_anterior deberia ser NULL en una tuberia recien creada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1 (excepcion): ' + ERROR_MESSAGE();
END CATCH


/* ============================================================
   CASO 2 - tag_anterior admite un valor distinto al tag_linea
   actual (el uso real: guardar el TAG viejo antes de editar).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tuberia_id2 BIGINT;
    INSERT INTO nucleo.tuberia (proyecto_id, tag_linea, tag_anterior) VALUES (@proyecto_id, N'620-TL-049-NUEVO', N'620-TL-049-VIEJO');
    SET @tuberia_id2 = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.tuberia
        WHERE id = @tuberia_id2 AND tag_linea = N'620-TL-049-NUEVO' AND tag_anterior = N'620-TL-049-VIEJO'
    )
        PRINT 'PASS 2: tag_linea y tag_anterior conviven con valores distintos.';
    ELSE
        PRINT 'FAIL 2: tag_linea/tag_anterior no quedaron como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2 (excepcion): ' + ERROR_MESSAGE();
END CATCH


-- Nota: el backfill de la migracion 043 (tag_anterior = tag_linea para toda
-- tuberia preexistente al aplicarla) es un evento de una sola vez, verificado
-- manualmente al aplicar la migracion -- no se comprueba aqui como invariante
-- permanente porque el uso real de este campo es justamente que tag_linea se
-- edite y quede distinto de tag_anterior; una vez que eso pase, esa
-- comprobacion "fallaria" por diseno, no por un bug.

PRINT '=========================================';
PRINT 'TEST 049 - FIN';
PRINT '=========================================';
