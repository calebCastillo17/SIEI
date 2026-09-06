SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 047 - nucleo.c_fuente_radioactiva + campos nuevos de
 * c_sensor/c_transmisor/c_indicador (migracion 040)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54701, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 047 - DENSIDAD: FUENTE_RADIOACTIVA (migracion 040)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo (INS-DOC-05-01, densimetro nuclear
   620-DX/DT/DI-5001): fuente radioactiva + sensor (detector) + transmisor
   + indicador remoto, todo en la misma ficha tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, modelo) VALUES (@proyecto_id, N'Minitrac 31');
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_fuente_radioactiva (proyecto_id, ficha_tecnica_id, tipo, elemento_radioactivo, intensidad_radiacion, actividad_maxima, material_blindaje, modelo)
    VALUES (@proyecto_id, @ficha1, N'Nuclear, con mecanismo de cierre manual (shutter de doble encapsulado)', N'Cesio 137', N'≤ 5 mR/h, alrededor de 30 cm', N'185 GBq (5000 mCi)', N'Plomo', N'Vegasource 83');

    INSERT INTO nucleo.c_sensor (proyecto_id, ficha_tecnica_id, tipo, conexion_proceso, posicion_montaje, requerimiento_tuberia_recta)
    VALUES (@proyecto_id, @ficha1, N'Centelleo', N'Sobre la tubería de proceso', N'Tubería horizontal', N'N.A.');

    INSERT INTO nucleo.c_transmisor (proyecto_id, ficha_tecnica_id, tipo, alimentacion, consumo, rango_transmisor, rango_ajustado, repetibilidad, compensacion_deterioro_fuente, inmunidad_saturacion)
    VALUES (@proyecto_id, @ficha1, N'Electrónico Smart', N'120 VAC ±10%, 60Hz', N'4 W', N'VTS', N'0 - 2400 kg/m3', N'± 0.1 %', N'Requerido', N'Requerido');

    INSERT INTO nucleo.c_indicador (proyecto_id, ficha_tecnica_id, tipo, conexion_electrica, configuracion_local, longitud_max_cable)
    VALUES (@proyecto_id, @ficha1, N'Unidad de ajuste e indicación externa', N'1/2" FNPT', N'Requerido', N'25 m');

    IF EXISTS (SELECT 1 FROM nucleo.c_fuente_radioactiva WHERE ficha_tecnica_id = @ficha1 AND elemento_radioactivo = N'Cesio 137')
       AND EXISTS (SELECT 1 FROM nucleo.c_sensor WHERE ficha_tecnica_id = @ficha1 AND requerimiento_tuberia_recta IS NOT NULL)
       AND EXISTS (SELECT 1 FROM nucleo.c_transmisor WHERE ficha_tecnica_id = @ficha1 AND compensacion_deterioro_fuente = N'Requerido')
       AND EXISTS (SELECT 1 FROM nucleo.c_indicador WHERE ficha_tecnica_id = @ficha1 AND longitud_max_cable = N'25 m')
        PRINT 'PASS 1: densimetro nuclear completo (fuente+sensor+transmisor+indicador) armado correctamente con el caso real INS-DOC-05-01.';
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
   CASO 2 - c_fuente_radioactiva: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_fuente_radioactiva (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Primera');

    BEGIN TRY
        INSERT INTO nucleo.c_fuente_radioactiva (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Segunda');
        PRINT 'FAIL 2: se acepto una segunda fuente radioactiva activa para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: segunda fuente radioactiva activa para la misma ficha rechazada correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_fuente_radioactiva.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 047';
PRINT '=========================================';
