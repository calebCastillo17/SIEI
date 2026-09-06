SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 042 - nucleo.c_unidad_control, nucleo.c_set_aire (migracion 035)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54201, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 042 - UNIDAD_CONTROL / SET_AIRE (migracion 035)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real: unidad de control + set de aire coexistiendo en
   la misma ficha tecnica (fila 2 real de Instrumentos_ValvNeumaticas).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_unidad_control (proyecto_id, ficha_tecnica_id, tipo_montaje, voltaje_operacion, consumo_w, presion_operacion, accion_falla)
    VALUES (@proyecto_id, @ficha1, N'Remoto', N'120 VAC', N'VTS', N'85 psi', N'Fail last');

    INSERT INTO nucleo.c_set_aire (proyecto_id, ficha_tecnica_id, tipo, rango_presion, conexion_neumatica, cantidad, manometro, regulador_velocidad, kit_puesta_tierra, modelo)
    VALUES (@proyecto_id, @ficha1, N'Filtro-regulador', N'VTS', N'VTS', N'01 (uno)', N'Ø2", Ashcroft Serie 1000 / similar', N'Requerido', N'Requerido', N'VTS');

    IF EXISTS (SELECT 1 FROM nucleo.c_unidad_control WHERE ficha_tecnica_id = @ficha1 AND tipo_montaje = N'Remoto')
       AND EXISTS (SELECT 1 FROM nucleo.c_set_aire WHERE ficha_tecnica_id = @ficha1 AND tipo = N'Filtro-regulador')
        PRINT 'PASS 1: unidad de control + set de aire coexisten en la misma ficha (caso real).';
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
   CASO 2 - c_unidad_control: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_unidad_control (proyecto_id, ficha_tecnica_id, tipo_montaje) VALUES (@proyecto_id, @ficha2, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_unidad_control (proyecto_id, ficha_tecnica_id, tipo_montaje) VALUES (@proyecto_id, @ficha2, N'Segundo');
        PRINT 'FAIL 2: se acepto una segunda unidad de control activa para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: segunda unidad de control activa para la misma ficha rechazada correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_unidad_control.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - c_set_aire: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha3 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_set_aire (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha3, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_set_aire (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha3, N'Segundo');
        PRINT 'FAIL 3: se acepto un segundo set de aire activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3: segundo set de aire activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado en c_set_aire.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 042';
PRINT '=========================================';
