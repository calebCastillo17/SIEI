SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto1_id BIGINT;
DECLARE @cliente_id BIGINT;

SELECT @proyecto1_id = id,
       @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 019 - INSTRUMENTO ASOCIADO (migracion 005)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   UN INSTRUMENTO PUEDE ASOCIARSE A OTRO DEL MISMO PROYECTO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1a_id BIGINT;
    DECLARE @inst1b_id BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-019-A');
    SET @inst1a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, instrumento_asociado_id, instrumento_asociado_tag)
    VALUES (@proyecto1_id, N'PIT-019-B', @inst1a_id, N'PIT-019-A');
    SET @inst1b_id = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.instrumento
        WHERE id = @inst1b_id AND instrumento_asociado_id = @inst1a_id
    )
        PRINT 'PASS 1: instrumento asociado a otro del mismo proyecto.';
    ELSE
        PRINT 'FAIL 1: no quedo la asociacion esperada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   UN INSTRUMENTO NO PUEDE ASOCIARSE A SI MISMO
   (CK_instrumento_asociado_no_self)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2_id BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-019-C');
    SET @inst2_id = SCOPE_IDENTITY();

    UPDATE nucleo.instrumento
    SET instrumento_asociado_id = @inst2_id
    WHERE id = @inst2_id;

    PRINT 'FAIL 2: SQL Server permitio que un instrumento se asocie a si mismo.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error2 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error2 LIKE N'%CK_instrumento_asociado_no_self%'
        PRINT 'PASS 2: SQL Server rechazo la auto-asociacion.';
    ELSE
    BEGIN
        PRINT 'FAIL 2: se produjo un error distinto al esperado.';
        PRINT @error2;
    END
END CATCH;


/* ============================================================
   CASO 3
   NO SE PUEDE ASOCIAR UN INSTRUMENTO A OTRO DE UN PROYECTO DISTINTO
   (FK_instrumento_instrumento_asociado, compuesta con proyecto_id)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto3_id BIGINT;
    DECLARE @inst3_p1_id BIGINT;
    DECLARE @inst3_p2_id BIGINT;

    -- Proyecto temporal propio (no depende de que 010_smoke_multiproyecto.sql
    -- se haya corrido antes) -- se descarta con el ROLLBACK de este caso.
    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-019-TMP', N'Proyecto temporal — smoke 019');
    SET @proyecto3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-019-D');
    SET @inst3_p1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto3_id, N'PIT-019-E');
    SET @inst3_p2_id = SCOPE_IDENTITY();

    UPDATE nucleo.instrumento
    SET instrumento_asociado_id = @inst3_p2_id
    WHERE id = @inst3_p1_id;

    PRINT 'FAIL 3: SQL Server permitio asociar instrumentos de proyectos distintos.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%FK_instrumento_instrumento_asociado%'
        PRINT 'PASS 3: SQL Server rechazo la asociacion cruzada entre proyectos.';
    ELSE
    BEGIN
        PRINT 'FAIL 3: se produjo un error distinto al esperado.';
        PRINT @error3;
    END
END CATCH;
