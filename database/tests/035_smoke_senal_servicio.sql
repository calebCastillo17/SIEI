SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 035 - nucleo.senal.servicio (migracion 028)
 *
 * Campo simple, sin CHECK ni trigger de exclusividad (mismo criterio que
 * causa_alarma en 013) — el test solo confirma que persiste, que acepta
 * NULL (default), que se puede actualizar, y que funciona igual para una
 * señal dueña de INSTRUMENTO y una dueña de EQUIPO (el caso real que
 * motivo la migracion) y para clase CONTROL y COM por igual.
 */

DECLARE @proyecto_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @com_id BIGINT;
DECLARE @tipo_equipo_electrico_id BIGINT;

SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53501, 'No existe TEST-001.', 1;

SELECT @control_id = id FROM cat.cat_clase_senal WHERE codigo = N'CONTROL';
SELECT @com_id = id FROM cat.cat_clase_senal WHERE codigo = N'COM';
SELECT @tipo_equipo_electrico_id = id FROM cat.cat_tipo_equipo WHERE codigo = N'ELECTRICO';

PRINT '=========================================';
PRINT 'TEST 035 - SENAL.SERVICIO (migracion 028)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Señal de INSTRUMENTO, clase CONTROL, con servicio.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1 BIGINT, @senal1 BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, descripcion)
    VALUES (@proyecto_id, N'ZSO-035-1', N'Prueba 035 instrumento');
    SET @inst1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, servicio)
    VALUES (@proyecto_id, @inst1, @control_id, N'HV-035_ZIO', N'DETECCION DE POSICION ABIERTO DE VALVULA DE PRUEBA 035');
    SET @senal1 = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.senal
        WHERE id = @senal1 AND servicio = N'DETECCION DE POSICION ABIERTO DE VALVULA DE PRUEBA 035'
    )
        PRINT 'PASS 1: servicio persistido en señal de instrumento (CONTROL).';
    ELSE
        PRINT 'FAIL 1: servicio no persistio como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un INSERT valido con servicio.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - Señal de EQUIPO, clase CONTROL, con servicio — el caso real
   que motivo la migracion (ej. 620-PPS-5005_RDY: "MOTOR LISTO PARA
   FUNCIONAR").
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @eq2 BIGINT, @senal2 BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'PPS-035-2', N'Prueba 035 equipo', @tipo_equipo_electrico_id);
    SET @eq2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, equipo_id, clase_senal_id, tag_senal, servicio)
    VALUES (@proyecto_id, @eq2, @control_id, N'PPS-035-2_RDY', N'MOTOR LISTO PARA FUNCIONAR (PRUEBA 035)');
    SET @senal2 = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.senal
        WHERE id = @senal2 AND servicio = N'MOTOR LISTO PARA FUNCIONAR (PRUEBA 035)'
    )
        PRINT 'PASS 2: servicio persistido en señal de equipo (CONTROL) — caso real que motivo la migracion.';
    ELSE
        PRINT 'FAIL 2: servicio no persistio como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo un INSERT valido con servicio en señal de equipo.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - servicio es NULL por defecto (no se exige, sin CHECK) y una
   señal COM tambien lo acepta sin restriccion de clase.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @eq3 BIGINT, @senal3a BIGINT, @senal3b BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'PLC-035-3', N'Prueba 035 equipo COM', @tipo_equipo_electrico_id);
    SET @eq3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, equipo_id, clase_senal_id, tag_senal)
    VALUES (@proyecto_id, @eq3, @control_id, N'PPS-035-3_SIN-SERVICIO');
    SET @senal3a = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, equipo_id, clase_senal_id, codigo_senal, servicio)
    VALUES (@proyecto_id, @eq3, @com_id, N'035-SIG-000001', N'PALABRA DE ALARMAS DE PRUEBA 035');
    SET @senal3b = SCOPE_IDENTITY();

    IF (SELECT servicio FROM nucleo.senal WHERE id = @senal3a) IS NULL
       AND (SELECT servicio FROM nucleo.senal WHERE id = @senal3b) = N'PALABRA DE ALARMAS DE PRUEBA 035'
        PRINT 'PASS 3: servicio NULL por defecto (CONTROL sin servicio) y aceptado tambien en una señal COM.';
    ELSE
        PRINT 'FAIL 3: servicio no se comporto como se esperaba (NULL por defecto / sin exclusividad de clase).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: se rechazo un caso valido (servicio NULL o servicio en señal COM).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - servicio se puede actualizar despues de creada la señal
   (dato manual, editable, igual que descripcion/observacion).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst4 BIGINT, @senal4 BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, descripcion)
    VALUES (@proyecto_id, N'HS-035-4', N'Prueba 035 update');
    SET @inst4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto_id, @inst4, @control_id, N'HV-035-4_REM');
    SET @senal4 = SCOPE_IDENTITY();

    UPDATE nucleo.senal SET servicio = N'ACCIONAMIENTO MANUAL DE VALVULA DE PRUEBA 035' WHERE id = @senal4;

    IF EXISTS (
        SELECT 1 FROM nucleo.senal
        WHERE id = @senal4 AND servicio = N'ACCIONAMIENTO MANUAL DE VALVULA DE PRUEBA 035'
    )
        PRINT 'PASS 4: servicio actualizable despues de creada la señal.';
    ELSE
        PRINT 'FAIL 4: la actualizacion de servicio no se reflejo.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: se rechazo un UPDATE valido de servicio.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 035';
PRINT '=========================================';
