SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @canal_id BIGINT;
DECLARE @modulo_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @ai_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1)
    @canal_id = c.id,
    @modulo_id = c.modulo_id
FROM nucleo.canal c
WHERE c.proyecto_id = @proyecto_id
  AND c.numero_canal = 0
  AND c.activo = 1
ORDER BY c.id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @canal_id IS NULL OR @modulo_id IS NULL
    THROW 52002, 'No existe CH00/modulo del TEST 001.', 1;


PRINT '=========================================';
PRINT 'TEST 009 - DESACTIVACION Y LIBERACION';
PRINT '=========================================';

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1 BIGINT;
    DECLARE @senal1 BIGINT;

    DECLARE @cable1 BIGINT;
    DECLARE @par1 BIGINT;

    DECLARE @p_inst1 BIGINT;
    DECLARE @p_mod1 BIGINT;

    DECLARE @ruta1 BIGINT;
    DECLARE @tramo1 BIGINT;

    DECLARE @inst2 BIGINT;
    DECLARE @senal2 BIGINT;
    DECLARE @p_inst2 BIGINT;
    DECLARE @ruta2 BIGINT;
    DECLARE @tramo2 BIGINT;


    /* ========================================================
       CREAR PRIMERA SEÑAL COMPLETA
       ======================================================== */

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-BAJA-009A', N'Instrumento que sera desactivado');

    SET @inst1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst1,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-BAJA-009A.PV',
        N'Senal original'
    );

    SET @senal1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-BAJA-009', N'Cable prueba', 2);

    SET @cable1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cable1, 1);

    SET @par1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst1, N'Origen señal original');

    SET @p_inst1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Destino modulo');

    SET @p_mod1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal1);

    SET @ruta1 = SCOPE_IDENTITY();


    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden
    )
    VALUES
    (
        @proyecto_id,
        @ruta1,
        @par1,
        @p_inst1,
        @p_mod1,
        1
    );

    SET @tramo1 = SCOPE_IDENTITY();


    /* ========================================================
       DESACTIVAR LA SEÑAL
       ======================================================== */

    UPDATE nucleo.senal
    SET activo = 0
    WHERE id = @senal1;


    /* ========================================================
       COMPROBAR CASCADA
       ======================================================== */

    IF EXISTS (
        SELECT 1
        FROM nucleo.ruta_conexion
        WHERE id = @ruta1
          AND activo = 1
    )
        THROW 52010,
        'FAIL: la ruta siguio activa despues de desactivar la senal.',
        1;


    IF EXISTS (
        SELECT 1
        FROM nucleo.tramo_conexion
        WHERE id = @tramo1
          AND activo = 1
    )
        THROW 52011,
        'FAIL: el tramo siguio activo despues de desactivar la senal.',
        1;


    PRINT 'PASS 1: desactivar la senal desactivo automaticamente su ruta.';
    PRINT 'PASS 2: desactivar la ruta desactivo automaticamente su tramo.';


    /* ========================================================
       CREAR SEGUNDA SEÑAL USANDO EL MISMO CANAL
       ======================================================== */

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-BAJA-009B', N'Instrumento nuevo');

    SET @inst2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tipo_io_id,
        canal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst2,
        @control_id,
        @ai_id,
        @canal_id,
        N'PIT-BAJA-009B.PV',
        N'Nueva señal reutilizando CH00'
    );

    SET @senal2 = SCOPE_IDENTITY();


    PRINT 'PASS 3: CH00 quedo libre y pudo reutilizarse.';


    /* ========================================================
       REUTILIZAR TAMBIÉN EL MISMO PAR/CONDUCTOR
       ======================================================== */

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst2, N'Nuevo origen');

    SET @p_inst2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal2);

    SET @ruta2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id,
        ruta_conexion_id,
        par_conductor_id,
        punto_origen_id,
        punto_destino_id,
        numero_orden
    )
    VALUES
    (
        @proyecto_id,
        @ruta2,
        @par1,
        @p_inst2,
        @p_mod1,
        1
    );

    SET @tramo2 = SCOPE_IDENTITY();


    PRINT 'PASS 4: el mismo PAR_CONDUCTOR pudo reutilizarse.';


    /* ========================================================
       MOSTRAR ESTADOS PARA VERIFICACION
       ======================================================== */

    SELECT
        s.id AS senal_id,
        s.tag_senal,
        s.canal_id,
        s.activo AS senal_activa,
        r.id AS ruta_id,
        r.activo AS ruta_activa,
        t.id AS tramo_id,
        t.par_conductor_id,
        t.activo AS tramo_activo
    FROM nucleo.senal s
    LEFT JOIN nucleo.ruta_conexion r
        ON r.senal_id = s.id
    LEFT JOIN nucleo.tramo_conexion t
        ON t.ruta_conexion_id = r.id
    WHERE s.id IN (@senal1, @senal2)
    ORDER BY s.id;


    PRINT 'PASS 5: cascada y reutilizacion completadas correctamente.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL TEST 009.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 009';
PRINT '=========================================';
