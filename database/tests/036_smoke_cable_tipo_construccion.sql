SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 036 - nucleo.cable.tipo_construccion_id / cantidad_unidades /
 * calibre / apantallado + cat.cat_tipo_construccion_cable (migracion 029)
 *
 * Campos simples, sin trigger de validacion cruzada — el test confirma
 * que persisten, que aceptan NULL (default, cable sin clasificar
 * todavia), y el CHECK de cantidad_unidades positiva.
 */

DECLARE @proyecto_id BIGINT;
DECLARE @tipo_pares_id BIGINT;

SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53601, 'No existe TEST-001.', 1;

SELECT @tipo_pares_id = id FROM cat.cat_tipo_construccion_cable WHERE codigo = N'PARES';
IF @tipo_pares_id IS NULL
    THROW 53602, 'No existe cat.cat_tipo_construccion_cable PARES (deberia venir sembrado por la migracion 029).', 1;

PRINT '=========================================';
PRINT 'TEST 036 - CABLE.TIPO_CONSTRUCCION (migracion 029)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Cable nuevo SIN clasificar (todas NULL) — comportamiento
   por defecto, no se exige nada.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable1 BIGINT;

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES (@proyecto_id, N'CBL-036-1', N'1-19c#14 AWG', 19);
    SET @cable1 = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.cable
        WHERE id = @cable1 AND tipo_construccion_id IS NULL AND cantidad_unidades IS NULL AND calibre IS NULL AND apantallado IS NULL
    )
        PRINT 'PASS 1: cable nuevo queda sin clasificar por defecto (todo NULL).';
    ELSE
        PRINT 'FAIL 1: no quedo todo NULL como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un INSERT valido sin clasificar.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - Cable clasificado como PARES: "1-12p#18 AWG+SH" ->
   cantidad_unidades=12, calibre="18 AWG", apantallado=1 — mismo
   ejemplo real verificado contra el proyecto 620 (capacidad_conductores
   sigue siendo 24, YA correcta desde antes, esta migracion no la toca).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable2 BIGINT;

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores, tipo_construccion_id, cantidad_unidades, calibre, apantallado)
    VALUES (@proyecto_id, N'CBL-036-2', N'1-12p#18 AWG+SH', 24, @tipo_pares_id, 12, N'18 AWG', 1);
    SET @cable2 = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.cable
        WHERE id = @cable2 AND tipo_construccion_id = @tipo_pares_id AND cantidad_unidades = 12
          AND calibre = N'18 AWG' AND apantallado = 1 AND capacidad_conductores = 24
    )
        PRINT 'PASS 2: cable clasificado como PARES persistio correctamente.';
    ELSE
        PRINT 'FAIL 2: la clasificacion no persistio como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo un INSERT valido clasificado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - CK_cable_cantidad_unidades_positiva rechaza 0 o negativo.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores, tipo_construccion_id, cantidad_unidades)
    VALUES (@proyecto_id, N'CBL-036-3', 10, @tipo_pares_id, 0);

    PRINT 'FAIL 3: se acepto cantidad_unidades = 0 (deberia rechazarse).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 3: cantidad_unidades = 0 rechazada por CK_cable_cantidad_unidades_positiva.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - tipo_construccion_id debe existir en el catalogo (FK).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores, tipo_construccion_id, cantidad_unidades)
    VALUES (@proyecto_id, N'CBL-036-4', 10, 999999, 5);

    PRINT 'FAIL 4: se acepto un tipo_construccion_id inexistente (deberia rechazarse por FK).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 4: tipo_construccion_id inexistente rechazado por FK_cable_tipo_construccion.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 036';
PRINT '=========================================';
