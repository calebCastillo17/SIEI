SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @rack_id BIGINT;
DECLARE @ai_id BIGINT;
DECLARE @control_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1) @rack_id = r.id
FROM nucleo.rack r
WHERE r.proyecto_id = @proyecto_id
  AND r.activo = 1
ORDER BY r.id;

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @rack_id IS NULL
    THROW 52002, 'No existe un rack activo del TEST-001.', 1;

IF @ai_id IS NULL OR @control_id IS NULL
    THROW 52003, 'No se encontraron catalogos AI/CONTROL.', 1;


PRINT '=========================================';
PRINT 'TEST 011 - CAPACIDAD DE MODULOS';
PRINT '=========================================';


/* ============================================================
   CASO 1
   16 -> 8 -> 16

   Debe:
   - generar inicialmente CH00..CH15
   - desactivar CH08..CH15 al pasar a 8
   - conservar esas filas historicas
   - crear NUEVAS filas CH08..CH15 al volver a 16
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cat16 BIGINT;
    DECLARE @cat8 BIGINT;
    DECLARE @slot1 BIGINT;
    DECLARE @modulo1 BIGINT;

    INSERT INTO cat.cat_modulo_io
    (
        fabricante,
        modelo,
        tipo_io_id,
        canales_max
    )
    VALUES
    (
        N'SIEI TEST',
        N'AI-16CH-TEST-011',
        @ai_id,
        16
    );

    SET @cat16 = SCOPE_IDENTITY();


    INSERT INTO cat.cat_modulo_io
    (
        fabricante,
        modelo,
        tipo_io_id,
        canales_max
    )
    VALUES
    (
        N'SIEI TEST',
        N'AI-8CH-TEST-011',
        @ai_id,
        8
    );

    SET @cat8 = SCOPE_IDENTITY();


    INSERT INTO nucleo.slot
    (
        proyecto_id,
        rack_id,
        numero_slot
    )
    VALUES
    (
        @proyecto_id,
        @rack_id,
        11
    );

    SET @slot1 = SCOPE_IDENTITY();


    /* --------------------------------------------------------
       Crear modulo de 16 canales
       -------------------------------------------------------- */

    INSERT INTO nucleo.modulo
    (
        proyecto_id,
        slot_id,
        catalogo_modulo_id
    )
    VALUES
    (
        @proyecto_id,
        @slot1,
        @cat16
    );

    SET @modulo1 = SCOPE_IDENTITY();


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND activo = 1
    ) <> 16
        THROW 52101,
        'FAIL: el modulo de 16 no genero exactamente 16 canales activos.',
        1;


    IF NOT EXISTS (
        SELECT 1
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND numero_canal = 15
          AND activo = 1
    )
        THROW 52102,
        'FAIL: no se genero CH15.',
        1;


    PRINT 'PASS 1: modulo de 16 genero CH00-CH15.';


    /* --------------------------------------------------------
       Reducir 16 -> 8
       -------------------------------------------------------- */

    UPDATE nucleo.modulo
    SET catalogo_modulo_id = @cat8
    WHERE id = @modulo1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND activo = 1
    ) <> 8
        THROW 52103,
        'FAIL: despues de reducir a 8 no quedaron exactamente 8 canales activos.',
        1;


    IF EXISTS (
        SELECT 1
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND numero_canal >= 8
          AND activo = 1
    )
        THROW 52104,
        'FAIL: quedaron canales >= 8 activos.',
        1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND numero_canal BETWEEN 8 AND 15
          AND activo = 0
    ) <> 8
        THROW 52105,
        'FAIL: no se conservaron los 8 canales historicos inactivos.',
        1;


    PRINT 'PASS 2: 16 -> 8 desactivo CH08-CH15 sin borrarlos.';


    /* --------------------------------------------------------
       Expandir nuevamente 8 -> 16
       -------------------------------------------------------- */

    UPDATE nucleo.modulo
    SET catalogo_modulo_id = @cat16
    WHERE id = @modulo1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND activo = 1
    ) <> 16
        THROW 52106,
        'FAIL: al volver a 16 no quedaron 16 canales activos.',
        1;


    /*
       Deben existir:

       CH00..CH07 = 8 filas originales activas

       CH08..CH15 =
           8 historicas inactivas
         + 8 nuevas activas

       TOTAL = 24 filas
    */

    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
    ) <> 24
        THROW 52107,
        'FAIL: se esperaban 24 filas historicas+activas despues de 16->8->16.',
        1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND numero_canal BETWEEN 8 AND 15
          AND activo = 0
    ) <> 8
        THROW 52108,
        'FAIL: los CH08-CH15 historicos fueron modificados o reactivados.',
        1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @modulo1
          AND numero_canal BETWEEN 8 AND 15
          AND activo = 1
    ) <> 8
        THROW 52109,
        'FAIL: no se crearon nuevos CH08-CH15 activos.',
        1;


    PRINT 'PASS 3: 8 -> 16 creo nuevos CH08-CH15 activos.';
    PRINT 'PASS 4: los CH08-CH15 historicos permanecieron inactivos.';


    SELECT
        numero_canal,
        id AS canal_id,
        activo
    FROM nucleo.canal
    WHERE modulo_id = @modulo1
    ORDER BY numero_canal, activo DESC, id;


    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 1.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 2
   REDUCIR 16 -> 8 CON CH15 EN USO

   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cat16_b BIGINT;
    DECLARE @cat8_b BIGINT;
    DECLARE @slot2 BIGINT;
    DECLARE @modulo2 BIGINT;
    DECLARE @canal15 BIGINT;
    DECLARE @instrumento2 BIGINT;


    INSERT INTO cat.cat_modulo_io
        (fabricante, modelo, tipo_io_id, canales_max)
    VALUES
        (N'SIEI TEST', N'AI-16CH-TEST-011B', @ai_id, 16);

    SET @cat16_b = SCOPE_IDENTITY();


    INSERT INTO cat.cat_modulo_io
        (fabricante, modelo, tipo_io_id, canales_max)
    VALUES
        (N'SIEI TEST', N'AI-8CH-TEST-011B', @ai_id, 8);

    SET @cat8_b = SCOPE_IDENTITY();


    INSERT INTO nucleo.slot
        (proyecto_id, rack_id, numero_slot)
    VALUES
        (@proyecto_id, @rack_id, 12);

    SET @slot2 = SCOPE_IDENTITY();


    INSERT INTO nucleo.modulo
        (proyecto_id, slot_id, catalogo_modulo_id)
    VALUES
        (@proyecto_id, @slot2, @cat16_b);

    SET @modulo2 = SCOPE_IDENTITY();


    SELECT @canal15 = id
    FROM nucleo.canal
    WHERE modulo_id = @modulo2
      AND numero_canal = 15
      AND activo = 1;


    IF @canal15 IS NULL
        THROW 52120, 'FAIL: no se encontro CH15.', 1;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-CAP-011', N'Instrumento usando CH15');

    SET @instrumento2 = SCOPE_IDENTITY();


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
        @instrumento2,
        @control_id,
        @ai_id,
        @canal15,
        N'PIT-CAP-011.PV',
        N'Senal activa en CH15'
    );


    /*
       ERROR INTENCIONAL:
       CH15 quedaria fuera del rango 0..7,
       pero tiene una señal activa.
    */

    UPDATE nucleo.modulo
    SET catalogo_modulo_id = @cat8_b
    WHERE id = @modulo2;


    PRINT 'FAIL 5: SQL Server permitio reducir a 8 con CH15 en uso.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 5: SQL Server rechazo reducir capacidad con CH15 en uso.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   INSERTAR MANUALMENTE CH08 EN MODULO DE 8

   RANGO VALIDO = 0..7
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cat8_c BIGINT;
    DECLARE @slot3 BIGINT;
    DECLARE @modulo3 BIGINT;


    INSERT INTO cat.cat_modulo_io
        (fabricante, modelo, tipo_io_id, canales_max)
    VALUES
        (N'SIEI TEST', N'AI-8CH-TEST-011C', @ai_id, 8);

    SET @cat8_c = SCOPE_IDENTITY();


    INSERT INTO nucleo.slot
        (proyecto_id, rack_id, numero_slot)
    VALUES
        (@proyecto_id, @rack_id, 13);

    SET @slot3 = SCOPE_IDENTITY();


    INSERT INTO nucleo.modulo
        (proyecto_id, slot_id, catalogo_modulo_id)
    VALUES
        (@proyecto_id, @slot3, @cat8_c);

    SET @modulo3 = SCOPE_IDENTITY();


    /*
       El trigger ya genero 0..7.
       Intentamos crear manualmente numero_canal = 8.
       ERROR INTENCIONAL.
    */

    INSERT INTO nucleo.canal
    (
        proyecto_id,
        modulo_id,
        numero_canal,
        activo
    )
    VALUES
    (
        @proyecto_id,
        @modulo3,
        8,
        1
    );


    PRINT 'FAIL 6: SQL Server permitio CH08 en un modulo de 8 canales.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 6: SQL Server rechazo un canal fuera de capacidad.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 011';
PRINT '=========================================';
