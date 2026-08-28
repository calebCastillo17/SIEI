SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto1_id BIGINT;

SELECT @proyecto1_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52101, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 021 - EQUIPOS / INSTRUMENTACION (migracion 007)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   EL CATALOGO cat.cat_tipo_equipo TRAE EXACTAMENTE ELECTRICO E
   INSTRUMENTACION (semilla de la migracion 007)
   ============================================================ */

IF (SELECT COUNT(*) FROM cat.cat_tipo_equipo WHERE codigo IN (N'ELECTRICO', N'INSTRUMENTACION')) = 2
    PRINT 'PASS 1: cat.cat_tipo_equipo tiene ELECTRICO e INSTRUMENTACION.';
ELSE
    PRINT 'FAIL 1: cat.cat_tipo_equipo no tiene exactamente esos 2 codigos.';


/* ============================================================
   CASO 2
   SE PUEDE CREAR UN EQUIPO CON plano_pnid Y tipo_equipo_id
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipoElectrico_id BIGINT;
    SELECT @tipoElectrico_id = id FROM cat.cat_tipo_equipo WHERE codigo = N'ELECTRICO';

    DECLARE @equipo2_id BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, plano_pnid, tipo_equipo_id)
    VALUES (@proyecto1_id, N'620-TEST-021-A', N'Equipo de prueba 021', N'620-F-99999', @tipoElectrico_id);
    SET @equipo2_id = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.equipo
        WHERE id = @equipo2_id
          AND plano_pnid = N'620-F-99999'
          AND tipo_equipo_id = @tipoElectrico_id
    )
        PRINT 'PASS 2: equipo creado con plano_pnid y tipo_equipo_id.';
    ELSE
        PRINT 'FAIL 2: no quedaron los valores esperados.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   plano_pnid Y tipo_equipo_id PUEDEN QUEDAR NULL (equipos reales
   sin tag formal ni P&ID, ej. "Medidor multifuncion")
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @equipo3_id BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion)
    VALUES (@proyecto1_id, N'Medidor multifuncion 021', N'Medidor multifuncion 021');
    SET @equipo3_id = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.equipo
        WHERE id = @equipo3_id AND plano_pnid IS NULL AND tipo_equipo_id IS NULL
    )
        PRINT 'PASS 3: plano_pnid y tipo_equipo_id quedan NULL sin problema.';
    ELSE
        PRINT 'FAIL 3: no quedaron NULL como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4
   UN tipo_equipo_id INEXISTENTE SE RECHAZA
   (FK_equipo_tipo_equipo)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, tipo_equipo_id)
    VALUES (@proyecto1_id, N'620-TEST-021-D', 999999);

    PRINT 'FAIL 4: SQL Server permitio un tipo_equipo_id inexistente.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error4 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error4 LIKE N'%FK_equipo_tipo_equipo%'
        PRINT 'PASS 4: SQL Server rechazo el tipo_equipo_id inexistente.';
    ELSE
    BEGIN
        PRINT 'FAIL 4: se produjo un error distinto al esperado.';
        PRINT @error4;
    END
END CATCH;
