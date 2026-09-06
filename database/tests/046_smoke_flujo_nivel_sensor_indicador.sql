SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 046 - nucleo.c_sensor, nucleo.c_indicador,
 * nucleo.c_transmisor.montaje/material_carcasa (migracion 039)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54601, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 046 - FLUJO / NIVEL: SENSOR / INDICADOR (migracion 039)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real Flujo (INS-DOC-03-01): sensor (flowtube) +
   transmisor con montaje, mas un indicador INTEGRADO (Pantalla=
   "LCD Digital Integral" -> es_integrado=1), sin indicador remoto.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_sensor (proyecto_id, ficha_tecnica_id, tipo, material_sensor, material_liner, montaje_configuracion, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'Sensor magnético embridado', N'Acero al carbono', N'PTFE liner', N'En línea de proceso, brida 2", CL150, FF, StdF', N'NEMA 4X');

    INSERT INTO nucleo.c_transmisor (proyecto_id, ficha_tecnica_id, alimentacion, rango_ajustado, senal_salida, exactitud, protocolo_comunicacion, conexion_electrica, grado_proteccion, montaje)
    VALUES (@proyecto_id, @ficha1, N'120 VAC ±10%, 60Hz', N'0 - 20 m3/h', N'4 - 20 mA, HART, carga 500 ohm', N'± 1.0% del span', N'HART', N'1/2" FNPT', N'NEMA 4X', N'Mediante soporte para montaje en tubería');

    INSERT INTO nucleo.c_indicador (proyecto_id, ficha_tecnica_id, es_integrado, pantalla)
    VALUES (@proyecto_id, @ficha1, 1, N'LCD Digital Integral');

    IF EXISTS (SELECT 1 FROM nucleo.c_sensor WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_transmisor WHERE ficha_tecnica_id = @ficha1 AND montaje IS NOT NULL)
       AND EXISTS (SELECT 1 FROM nucleo.c_indicador WHERE ficha_tecnica_id = @ficha1 AND es_integrado = 1)
        PRINT 'PASS 1: caso real de Flujo (sensor+transmisor con montaje+indicador integrado) armado correctamente.';
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
   CASO 2 - c_indicador es 1:N REAL: un indicador integrado Y un
   indicador remoto para la MISMA ficha (caso real de Nivel, hallazgo
   textual de la propia usuaria en _T_MEDICION).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_indicador (proyecto_id, ficha_tecnica_id, es_integrado, tipo) VALUES (@proyecto_id, @ficha2, 1, N'Integrado al transmisor');
    INSERT INTO nucleo.c_indicador (proyecto_id, ficha_tecnica_id, es_integrado, tipo, montaje) VALUES (@proyecto_id, @ficha2, 0, N'Remoto', N'Panel local');

    IF (SELECT COUNT(*) FROM nucleo.c_indicador WHERE ficha_tecnica_id = @ficha2) = 2
        PRINT 'PASS 2: indicador integrado + indicador remoto coexisten en la misma ficha (1:N real confirmado).';
    ELSE
        PRINT 'FAIL 2: no se comporto como 1:N real.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo un caso real valido de doble indicador.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - c_sensor: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha3 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_sensor (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha3, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_sensor (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha3, N'Segundo');
        PRINT 'FAIL 3: se acepto un segundo c_sensor activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3: segundo c_sensor activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado en c_sensor.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 046';
PRINT '=========================================';
