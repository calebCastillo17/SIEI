SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 044 - Valvulas Hidraulicas reutilizando c_cuerpo_valvula/
 * c_actuador/c_interruptor_posicion/c_envolvente (migracion 037)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54401, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 044 - VALVULAS HIDRAULICAS (migracion 037)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo de Instrumentos_ValvHidraulicas: cuerpo +
   actuador + interruptor + caja de conexiones con tipo_montaje, sin
   necesitar ninguna tabla nueva mas alla de la columna agregada.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_cuerpo_valvula (proyecto_id, ficha_tecnica_id, tipo_cuerpo, tamano_nominal, tipo_conexion, material_cuerpo, posicion_normal, clase_hermeticidad)
    VALUES (@proyecto_id, @ficha1, N'Cuchilla, autolimpiante, servicio pesado', N'2"', N'Lug, ASME B16.5 (oreja roscada)', N'Hierro dúctil ASTM A536', N'Abierto', N'VTS');

    INSERT INTO nucleo.c_actuador (proyecto_id, ficha_tecnica_id, tipo_actuador, accion_falla, conexion_actuador)
    VALUES (@proyecto_id, @ficha1, N'Pistón hidráulico', N'Fail close', N'1/4" NPT');

    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, posicion_conmutacion)
    VALUES (@proyecto_id, @ficha1, N'Cerrado');

    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion, tipo_montaje, voltaje, material, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'conexiones', N'Remoto', N'120 VAC', N'Acero inoxidable AISI 316', N'NEMA 4X');

    IF EXISTS (SELECT 1 FROM nucleo.c_cuerpo_valvula WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_actuador WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_interruptor_posicion WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_envolvente WHERE ficha_tecnica_id = @ficha1 AND tipo_montaje = N'Remoto')
        PRINT 'PASS 1: valvula hidraulica completa (cuerpo+actuador+interruptor+caja con tipo_montaje) sin necesitar tablas nuevas.';
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

PRINT '=========================================';
PRINT 'FIN TEST 044';
PRINT '=========================================';
