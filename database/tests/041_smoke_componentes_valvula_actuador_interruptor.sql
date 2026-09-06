SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 041 - nucleo.c_cuerpo_valvula, nucleo.c_actuador,
 * nucleo.c_interruptor_posicion (migracion 034)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54101, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 041 - VALVULA / ACTUADOR / INTERRUPTOR (migracion 034)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo: una valvula neumatica on/off con cuerpo +
   actuador + 2 interruptores de posicion (abierto/cerrado) — el caso
   real 620-HV-5086 con sus ZSC/ZSO del propio _MODELO de la usuaria.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, modelo) VALUES (@proyecto_id, N'VTS');
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_cuerpo_valvula (
        proyecto_id, ficha_tecnica_id, tipo_cuerpo, tamano_nominal, presion_trabajo_cwp,
        tipo_conexion, material_cuerpo, posicion_normal, ruido_max_db, ruido_operador, ruido_distancia_m,
        posicion_montaje, material_obturador, clase_hermeticidad
    )
    VALUES (
        @proyecto_id, @ficha1, N'Cuchilla, autolimpiante, servicio pesado', N'12"', N'CWP 150',
        N'Lug, ASME B16.5 (oreja roscada)', N'Hierro dúctil ASTM A536', N'Abierto', 85.0, N'<', 1.0,
        N'Horizontal', N'Acero inoxidable 316', N'VTS'
    );

    INSERT INTO nucleo.c_actuador (proyecto_id, ficha_tecnica_id, tipo_actuador, accion_falla, alimentacion, conexion_actuador, modelo)
    VALUES (@proyecto_id, @ficha1, N'Pistón neumático', N'Fail close', N'80 - 100 psi', N'1/4" NPT', N'VTS');

    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, tecnologia, posicion_conmutacion, modelo)
    VALUES (@proyecto_id, @ficha1, N'Mecánico', N'Cerrado', N'VTS');
    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, tecnologia, posicion_conmutacion, modelo)
    VALUES (@proyecto_id, @ficha1, N'Mecánico', N'Abierto', N'VTS');

    IF (SELECT COUNT(*) FROM nucleo.c_interruptor_posicion WHERE ficha_tecnica_id = @ficha1) = 2
       AND EXISTS (SELECT 1 FROM nucleo.c_cuerpo_valvula WHERE ficha_tecnica_id = @ficha1)
       AND EXISTS (SELECT 1 FROM nucleo.c_actuador WHERE ficha_tecnica_id = @ficha1)
        PRINT 'PASS 1: cuerpo + actuador + 2 interruptores (abierto/cerrado) coexisten en la misma ficha (caso real 620-HV-5086).';
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
   CASO 2 - c_cuerpo_valvula: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_cuerpo_valvula (proyecto_id, ficha_tecnica_id, tipo_cuerpo) VALUES (@proyecto_id, @ficha2, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_cuerpo_valvula (proyecto_id, ficha_tecnica_id, tipo_cuerpo) VALUES (@proyecto_id, @ficha2, N'Segundo');
        PRINT 'FAIL 2: se acepto un segundo c_cuerpo_valvula activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: segundo c_cuerpo_valvula activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_cuerpo_valvula.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - c_actuador: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha3 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_actuador (proyecto_id, ficha_tecnica_id, tipo_actuador) VALUES (@proyecto_id, @ficha3, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_actuador (proyecto_id, ficha_tecnica_id, tipo_actuador) VALUES (@proyecto_id, @ficha3, N'Segundo');
        PRINT 'FAIL 3: se acepto un segundo c_actuador activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3: segundo c_actuador activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado en c_actuador.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - c_interruptor_posicion: confirma que es 1:N REAL — un
   tercer interruptor para la MISMA ficha se acepta sin problema
   (a diferencia de cuerpo/actuador, que son 1:0..1).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha4 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, posicion_conmutacion) VALUES (@proyecto_id, @ficha4, N'Abierto');
    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, posicion_conmutacion) VALUES (@proyecto_id, @ficha4, N'Cerrado');
    INSERT INTO nucleo.c_interruptor_posicion (proyecto_id, ficha_tecnica_id, posicion_conmutacion) VALUES (@proyecto_id, @ficha4, N'Intermedio');

    IF (SELECT COUNT(*) FROM nucleo.c_interruptor_posicion WHERE ficha_tecnica_id = @ficha4) = 3
        PRINT 'PASS 4: tres interruptores de posicion para la misma ficha aceptados sin rechazo (1:N real, sin unique por ficha).';
    ELSE
        PRINT 'FAIL 4: no se comporto como 1:N real.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: se rechazo un caso valido de interruptores multiples.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 041';
PRINT '=========================================';
