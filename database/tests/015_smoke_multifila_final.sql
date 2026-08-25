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
DECLARE @control_id BIGINT;
DECLARE @com_id BIGINT;
DECLARE @ai_id BIGINT;
DECLARE @direccion_in_id BIGINT;

DECLARE @modulo_base BIGINT;
DECLARE @canal0 BIGINT;
DECLARE @canal1 BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1) @rack_id = id
FROM nucleo.rack
WHERE proyecto_id = @proyecto_id
  AND activo = 1
ORDER BY id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @com_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'COM';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

SELECT @direccion_in_id = id
FROM cat.cat_direccion_com
WHERE codigo = N'IN';


SELECT TOP (1)
    @modulo_base = m.id
FROM nucleo.modulo m
WHERE m.proyecto_id = @proyecto_id
  AND m.activo = 1
  AND EXISTS (
      SELECT 1
      FROM nucleo.canal c
      WHERE c.modulo_id = m.id
        AND c.numero_canal = 0
        AND c.activo = 1
  )
  AND EXISTS (
      SELECT 1
      FROM nucleo.canal c
      WHERE c.modulo_id = m.id
        AND c.numero_canal = 1
        AND c.activo = 1
  )
ORDER BY m.id;


SELECT @canal0 = id
FROM nucleo.canal
WHERE modulo_id = @modulo_base
  AND numero_canal = 0
  AND activo = 1;


SELECT @canal1 = id
FROM nucleo.canal
WHERE modulo_id = @modulo_base
  AND numero_canal = 1
  AND activo = 1;


IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

IF @rack_id IS NULL
    THROW 52002, 'No existe rack activo.', 1;

IF @canal0 IS NULL OR @canal1 IS NULL
    THROW 52003, 'No se encontraron CH00 y CH01 activos.', 1;


PRINT '=========================================';
PRINT 'TEST 015 - PRUEBA FINAL MULTIFILA';
PRINT '=========================================';


/* ============================================================
   CASO 1
   INSERTAR DOS MODULOS EN UNA SOLA SENTENCIA

   Uno de 4 canales
   Uno de 6 canales

   Ambos deben generar correctamente sus canales.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cat4_15 BIGINT;
    DECLARE @cat6_15 BIGINT;

    DECLARE @slot4_15 BIGINT;
    DECLARE @slot6_15 BIGINT;

    DECLARE @mod4_15 BIGINT;
    DECLARE @mod6_15 BIGINT;

    DECLARE @mods15 TABLE
    (
        modulo_id BIGINT,
        slot_id BIGINT
    );


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
        N'AI-4CH-TEST-015',
        @ai_id,
        4
    );

    SET @cat4_15 = SCOPE_IDENTITY();


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
        N'AI-6CH-TEST-015',
        @ai_id,
        6
    );

    SET @cat6_15 = SCOPE_IDENTITY();


    INSERT INTO nucleo.slot
        (proyecto_id, rack_id, numero_slot)
    VALUES
        (@proyecto_id, @rack_id, 21);

    SET @slot4_15 = SCOPE_IDENTITY();


    INSERT INTO nucleo.slot
        (proyecto_id, rack_id, numero_slot)
    VALUES
        (@proyecto_id, @rack_id, 22);

    SET @slot6_15 = SCOPE_IDENTITY();


    /*
       LOS DOS MODULOS SE CREAN EN UN SOLO INSERT.
    */
    INSERT INTO nucleo.modulo
    (
        proyecto_id,
        slot_id,
        catalogo_modulo_id
    )
    OUTPUT
        inserted.id,
        inserted.slot_id
    INTO @mods15 (modulo_id, slot_id)
    VALUES
    (
        @proyecto_id,
        @slot4_15,
        @cat4_15
    ),
    (
        @proyecto_id,
        @slot6_15,
        @cat6_15
    );


    SELECT @mod4_15 = modulo_id
    FROM @mods15
    WHERE slot_id = @slot4_15;

    SELECT @mod6_15 = modulo_id
    FROM @mods15
    WHERE slot_id = @slot6_15;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @mod4_15
          AND activo = 1
    ) <> 4
        THROW 52150,
        'FAIL: modulo de 4 no genero exactamente 4 canales.',
        1;


    IF (
        SELECT COUNT(*)
        FROM nucleo.canal
        WHERE modulo_id = @mod6_15
          AND activo = 1
    ) <> 6
        THROW 52151,
        'FAIL: modulo de 6 no genero exactamente 6 canales.',
        1;


    IF NOT EXISTS (
        SELECT 1
        FROM nucleo.canal
        WHERE modulo_id = @mod4_15
          AND numero_canal = 3
          AND activo = 1
    )
        THROW 52152, 'FAIL: modulo 4CH no genero CH03.', 1;


    IF NOT EXISTS (
        SELECT 1
        FROM nucleo.canal
        WHERE modulo_id = @mod6_15
          AND numero_canal = 5
          AND activo = 1
    )
        THROW 52153, 'FAIL: modulo 6CH no genero CH05.', 1;


    PRINT 'PASS 1: dos modulos creados en un solo INSERT generaron correctamente sus canales.';

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
   DOS SEÑALES CONTROL VALIDAS EN UN SOLO INSERT

   CH00 y CH01
   DEBE SER PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2A BIGINT;
    DECLARE @inst2B BIGINT;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015A', N'Instrumento multifila A');

    SET @inst2A = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015B', N'Instrumento multifila B');

    SET @inst2B = SCOPE_IDENTITY();


    /*
       DOS SEÑALES EN UNA SOLA SENTENCIA.
    */
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
        @inst2A,
        @control_id,
        @ai_id,
        @canal0,
        N'PIT-MULTI-015A.PV',
        N'Senal A'
    ),
    (
        @proyecto_id,
        @inst2B,
        @control_id,
        @ai_id,
        @canal1,
        N'PIT-MULTI-015B.PV',
        N'Senal B'
    );


    IF (
        SELECT COUNT(*)
        FROM nucleo.senal
        WHERE tag_senal IN
        (
            N'PIT-MULTI-015A.PV',
            N'PIT-MULTI-015B.PV'
        )
          AND activo = 1
    ) <> 2
        THROW 52154,
        'FAIL: no se insertaron las dos señales multifila.',
        1;


    PRINT 'PASS 2: dos señales CONTROL válidas fueron aceptadas en un solo INSERT.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 2.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 3
   INSERT MULTIFILA MIXTO

   FILA A = CONTROL valida
   FILA B = COM invalida porque tiene tipo_io + canal

   TODO EL INSERT DEBE FALLAR.
   NO DEBE QUEDAR LA FILA A PARCIALMENTE INSERTADA.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst3A BIGINT;
    DECLARE @inst3B BIGINT;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015C', N'Instrumento valido');

    SET @inst3A = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015D', N'Instrumento fila invalida');

    SET @inst3B = SCOPE_IDENTITY();


    /*
       Primera fila válida.
       Segunda fila inválida.

       El trigger debe analizar TODO inserted.
    */
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
        @inst3A,
        @control_id,
        @ai_id,
        @canal0,
        N'PIT-MULTI-015C.PV',
        N'Fila valida'
    ),
    (
        @proyecto_id,
        @inst3B,
        @com_id,
        @ai_id,
        @canal1,
        N'PIT-MULTI-015D.COM',
        N'Fila COM invalida'
    );


    PRINT 'FAIL 3: SQL Server permitio el INSERT multifila con una fila COM invalida.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;


    IF EXISTS (
        SELECT 1
        FROM nucleo.senal
        WHERE tag_senal IN
        (
            N'PIT-MULTI-015C.PV',
            N'PIT-MULTI-015D.COM'
        )
    )
    BEGIN
        PRINT 'FAIL 4: quedo una insercion parcial despues del error.';
    END
    ELSE
    BEGIN
        PRINT 'PASS 3: SQL Server rechazo el INSERT multifila con una fila invalida.';
        PRINT 'Error esperado:';
        PRINT ERROR_MESSAGE();

        PRINT 'PASS 4: el INSERT fue atomico; no quedo ninguna señal parcialmente insertada.';
    END

END CATCH;


/* ============================================================
   CASO 4
   UPDATE MULTIFILA MIXTO

   Creamos dos CONTROL válidas sin IO.
   En una sola sentencia:

   fila A -> direccion_com sigue NULL
   fila B -> direccion_com = IN  (INVALIDO PARA CONTROL)

   El trigger debe detectar la fila inválida dentro del conjunto
   y rechazar toda la operación.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst4A BIGINT;
    DECLARE @inst4B BIGINT;
    DECLARE @senal4A BIGINT;
    DECLARE @senal4B BIGINT;


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015E', N'Instrumento update A');

    SET @inst4A = SCOPE_IDENTITY();


    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-MULTI-015F', N'Instrumento update B');

    SET @inst4B = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst4A,
        @control_id,
        N'PIT-MULTI-015E.TEST',
        N'CONTROL A'
    );

    SET @senal4A = SCOPE_IDENTITY();


    INSERT INTO nucleo.senal
    (
        proyecto_id,
        instrumento_id,
        clase_senal_id,
        tag_senal,
        descripcion
    )
    VALUES
    (
        @proyecto_id,
        @inst4B,
        @control_id,
        N'PIT-MULTI-015F.TEST',
        N'CONTROL B'
    );

    SET @senal4B = SCOPE_IDENTITY();


    /*
       UNA SOLA SENTENCIA UPDATE AFECTA DOS FILAS.

       A permanece valida.
       B intenta recibir DIRECCION_COM siendo CONTROL.
    */
    UPDATE nucleo.senal
    SET direccion_com_id =
        CASE
            WHEN id = @senal4A THEN NULL
            WHEN id = @senal4B THEN @direccion_in_id
        END
    WHERE id IN (@senal4A, @senal4B);


    PRINT 'FAIL 5: SQL Server permitio UPDATE multifila con una fila CONTROL invalida.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;


    IF EXISTS (
        SELECT 1
        FROM nucleo.senal
        WHERE tag_senal IN
        (
            N'PIT-MULTI-015E.TEST',
            N'PIT-MULTI-015F.TEST'
        )
    )
    BEGIN
        PRINT 'FAIL 6: quedaron datos parciales despues del UPDATE rechazado.';
    END
    ELSE
    BEGIN
        PRINT 'PASS 5: SQL Server rechazo correctamente el UPDATE multifila.';
        PRINT 'Error esperado:';
        PRINT ERROR_MESSAGE();

        PRINT 'PASS 6: la operación fue atomica; no quedaron cambios parciales.';
    END

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 015';
PRINT '=========================================';
