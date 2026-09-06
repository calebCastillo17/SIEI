SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 037 - nucleo.sitio, nucleo.tuberia, nucleo.equipo extendido,
 * cat.cat_orden_tipo_instrumento.familia (migracion 030)
 */

DECLARE @proyecto_id BIGINT;
DECLARE @cliente_id BIGINT;
SELECT @proyecto_id = id, @cliente_id = cliente_id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53701, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 037 - SITIO / TUBERIA / EQUIPO (migracion 030)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - nucleo.sitio: 1 fila por proyecto, UNIQUE(proyecto_id).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.sitio (proyecto_id, altitud_msnm, temp_min_c, temp_max_c, humedad_relativa_pct, medio_ambiente, ciclo_trabajo, clasificacion_area)
    VALUES (@proyecto_id, 4300, -1.0, 14.0, 70.0, N'Atmosfera polvorienta', N'Continua 24x7', N'No Clasificado');

    -- Un segundo sitio para el mismo proyecto debe rechazarse.
    BEGIN TRY
        INSERT INTO nucleo.sitio (proyecto_id, altitud_msnm) VALUES (@proyecto_id, 100);
        PRINT 'FAIL 1: se acepto un segundo sitio para el mismo proyecto (deberia rechazarse por UQ_sitio_proyecto).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 1: segundo sitio del mismo proyecto rechazado por UQ_sitio_proyecto.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo el INSERT valido inicial de sitio.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - nucleo.tuberia + nucleo.instrumento.tuberia_id
   (FK compuesta a un tuberia del MISMO proyecto).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tuberia_id BIGINT;
    INSERT INTO nucleo.tuberia (proyecto_id, tag_linea, tamano_diametro, material_tuberia)
    VALUES (@proyecto_id, N'620-TL-24"-L1E0U-26807', N'24"', N'Acero al carbono ASTM A53 Gr. B');
    SET @tuberia_id = SCOPE_IDENTITY();

    DECLARE @instrumento_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, tuberia_id)
    VALUES (@proyecto_id, N'TEST-037-DI-001', @tuberia_id);
    SET @instrumento_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.instrumento WHERE id = @instrumento_id AND tuberia_id = @tuberia_id)
        PRINT 'PASS 2: instrumento.tuberia_id persistio correctamente.';
    ELSE
        PRINT 'FAIL 2: tuberia_id no persistio como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo un INSERT valido de tuberia + instrumento.tuberia_id.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - nucleo.instrumento.sitio_id: la FK compuesta rechaza un sitio
   de OTRO proyecto (aislamiento multi-proyecto estructural).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto_otro_id BIGINT;
    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre) VALUES (@cliente_id, N'TEST-037-OTRO', N'Otro proyecto (test 037)');
    SET @proyecto_otro_id = SCOPE_IDENTITY();

    DECLARE @sitio_otro_id BIGINT;
    INSERT INTO nucleo.sitio (proyecto_id, altitud_msnm) VALUES (@proyecto_otro_id, 1000);
    SET @sitio_otro_id = SCOPE_IDENTITY();

    BEGIN TRY
        INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, sitio_id)
        VALUES (@proyecto_id, N'TEST-037-DI-002', @sitio_otro_id);
        PRINT 'FAIL 3: se acepto un sitio de otro proyecto (deberia rechazarse por FK compuesta).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 3: sitio de otro proyecto rechazado por FK_instrumento_sitio (aislamiento multi-proyecto).';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: error inesperado armando el fixture de otro proyecto.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - nucleo.equipo: campos fisicos nuevos + familia en
   cat.cat_orden_tipo_instrumento.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @equipo_id BIGINT;
    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, clase_equipo, dimensiones_wxd, altura, orientacion, conexion_instrumento, material)
    VALUES (@proyecto_id, N'TEST-037-TKS-001', N'Poza de Emergencia', N'30.0 x 60.0 m', N'13.0 m', N'Vertical', N'Mediante bracket para 1 1/2" NPT', N'Concreto armado');
    SET @equipo_id = SCOPE_IDENTITY();

    IF EXISTS (
        SELECT 1 FROM nucleo.equipo
        WHERE id = @equipo_id AND clase_equipo = N'Poza de Emergencia' AND dimensiones_wxd = N'30.0 x 60.0 m'
    )
        PRINT 'PASS 4a: campos fisicos nuevos de equipo persistieron correctamente.';
    ELSE
        PRINT 'FAIL 4a: los campos fisicos de equipo no persistieron como se esperaba.';

    UPDATE cat.cat_orden_tipo_instrumento SET familia = N'MEDICION' WHERE prefijo = N'LIT';

    IF EXISTS (SELECT 1 FROM cat.cat_orden_tipo_instrumento WHERE prefijo = N'LIT' AND familia = N'MEDICION')
        PRINT 'PASS 4b: cat_orden_tipo_instrumento.familia persistio correctamente.';
    ELSE
        PRINT 'FAIL 4b: familia no persistio como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: se rechazo un UPDATE/INSERT valido.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 037';
PRINT '=========================================';
