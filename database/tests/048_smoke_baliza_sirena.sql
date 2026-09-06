SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 048 - nucleo.c_baliza, nucleo.c_sirena (migracion 041)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54801, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 048 - BALIZA / SIRENA (migracion 041)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo (INS-DOC-09-01): baliza + sirena en la
   misma ficha tecnica, cada una con su propio modelo/fabricante (ningun
   componente "principal" para esta familia).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_baliza (proyecto_id, ficha_tecnica_id, tipo, tipo_iluminacion, color_lente, energia_destello, voltaje_alimentacion, tipo_montaje, grado_proteccion, vida_util, modelo)
    VALUES (@proyecto_id, @ficha1, N'Baliza, tecnología tipo xenón', N'Estroboscópica', N'Rojo', N'≥ 5 Joules', N'120 VAC, 60 Hz', N'Ensamblado con sirena', N'NEMA 4X', N'≥ 1x10^6 flashes', N'XB13 o similar');

    INSERT INTO nucleo.c_sirena (proyecto_id, ficha_tecnica_id, tipo, intensidad_sonora, material, tonos, volumen, voltaje_alimentacion, tipo_montaje, grado_proteccion, modelo)
    VALUES (@proyecto_id, @ficha1, N'Sonda acústica y bocina', N'Hasta 117 dB(A) @ 1 m', N'Poliéster reforzado con fibra de vidrio', N'27 tonos seleccionables', N'Ajustable', N'120 VAC, 60 Hz', N'En pared', N'NEMA 4X', N'DB15');

    IF EXISTS (SELECT 1 FROM nucleo.c_baliza WHERE ficha_tecnica_id = @ficha1 AND modelo = N'XB13 o similar')
       AND EXISTS (SELECT 1 FROM nucleo.c_sirena WHERE ficha_tecnica_id = @ficha1 AND modelo = N'DB15')
        PRINT 'PASS 1: baliza + sirena, cada una con su propio modelo, conviven en la misma ficha tecnica (caso real INS-DOC-09-01).';
    ELSE
        PRINT 'FAIL 1: no se comporto como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un caso real valido.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - c_baliza y c_sirena: ambas 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_baliza (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Primera');
    INSERT INTO nucleo.c_sirena (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Primera');

    BEGIN TRY
        INSERT INTO nucleo.c_baliza (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Segunda');
        PRINT 'FAIL 2a: se acepto una segunda baliza activa para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2a: segunda baliza activa para la misma ficha rechazada correctamente.';
    END CATCH;

    BEGIN TRY
        INSERT INTO nucleo.c_sirena (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Segunda');
        PRINT 'FAIL 2b: se acepto una segunda sirena activa para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2b: segunda sirena activa para la misma ficha rechazada correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_baliza/c_sirena.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 048';
PRINT '=========================================';
