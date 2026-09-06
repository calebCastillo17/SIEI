SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 045 - Valvulas Moduladas: c_actuador.recorrido_actuador/torque +
 * nucleo.c_posicionador (migracion 038)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54501, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 045 - VALVULAS MODULADAS (migracion 038)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo de Instrumentos_ValvModuladas: cuerpo +
   actuador (con recorrido/torque) + posicionador + set de aire +
   envolvente + unidad de control, todo en la misma ficha tecnica, SIN
   interruptor_posicion (las moduladas no lo usan).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_cuerpo_valvula (proyecto_id, ficha_tecnica_id, tipo_cuerpo, caracteristica_flujo, cv_valvula, clase_hermeticidad)
    VALUES (@proyecto_id, @ficha1, N'Bola, para servicio de modulación', N'Isoporcentual', 45.5, N'ANSI / FCI Class IV');

    INSERT INTO nucleo.c_actuador (proyecto_id, ficha_tecnica_id, tipo_actuador, recorrido_actuador, accion_falla, torque)
    VALUES (@proyecto_id, @ficha1, N'Resorte y diafragma rotativo', N'0 - 90° (rotativo, 1/4 de vuelta)', N'Fail to open', N'VTS');

    INSERT INTO nucleo.c_posicionador (proyecto_id, ficha_tecnica_id, tipo, accion, senal_control, protocolo_comunicacion, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'Electroneumático inteligente digital', N'Directa', N'4 - 20 mA, 24Vdc', N'HART', N'NEMA 4X');

    INSERT INTO nucleo.c_unidad_control (proyecto_id, ficha_tecnica_id, tipo_montaje, voltaje_operacion, presion_operacion)
    VALUES (@proyecto_id, @ficha1, N'Mural, remoto a la válvula', N'N.A.', N'85 psi');

    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion, material, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'set_aire', N'Acero inoxidable 316', N'NEMA 4X');

    INSERT INTO nucleo.c_set_aire (proyecto_id, ficha_tecnica_id, tipo, manometro)
    VALUES (@proyecto_id, @ficha1, N'Filtro-regulador', N'Ø2", Ashcroft Serie 1000 / similar');

    IF EXISTS (SELECT 1 FROM nucleo.c_actuador WHERE ficha_tecnica_id = @ficha1 AND recorrido_actuador = N'0 - 90° (rotativo, 1/4 de vuelta)' AND torque = N'VTS')
       AND EXISTS (SELECT 1 FROM nucleo.c_posicionador WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_unidad_control WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_envolvente WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_set_aire WHERE ficha_tecnica_id = @ficha1)
       AND NOT EXISTS (SELECT 1 FROM nucleo.c_interruptor_posicion WHERE ficha_tecnica_id = @ficha1)
        PRINT 'PASS 1: valvula modulada completa (cuerpo+actuador con recorrido/torque+posicionador+set aire+envolvente+unidad control, sin interruptor) armada correctamente.';
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
   CASO 2 - c_posicionador: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_posicionador (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_posicionador (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Segundo');
        PRINT 'FAIL 2: se acepto un segundo posicionador activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: segundo posicionador activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_posicionador.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 045';
PRINT '=========================================';
