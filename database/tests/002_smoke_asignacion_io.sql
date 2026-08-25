SET NOCOUNT ON;

DECLARE @proyecto_id BIGINT;
DECLARE @canal_id BIGINT;
DECLARE @clase_control_id BIGINT;
DECLARE @tipo_ai_id BIGINT;
DECLARE @instrumento1_id BIGINT;
DECLARE @instrumento2_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1) @canal_id = ch.id
FROM nucleo.canal ch
JOIN nucleo.modulo m
    ON m.id = ch.modulo_id
JOIN cat.cat_modulo_io cm
    ON cm.id = m.catalogo_modulo_id
WHERE ch.proyecto_id = @proyecto_id
  AND ch.numero_canal = 0
  AND ch.activo = 1
  AND cm.modelo = N'AI-8CH-TEST';

SELECT @clase_control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @tipo_ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

PRINT '=========================================';
PRINT 'TEST 002 - OCUPACION UNICA DE CANAL';
PRINT '=========================================';

BEGIN TRY
    BEGIN TRANSACTION;

    -- Instrumento 1
    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-001', N'Instrumento prueba 1');

    SET @instrumento1_id = SCOPE_IDENTITY();

    -- Primera señal: debe funcionar
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
            @instrumento1_id,
            @clase_control_id,
            @tipo_ai_id,
            @canal_id,
            N'PIT-TEST-001.PV',
            N'Primera señal del canal'
        );

    PRINT 'PASS 1: primera señal asignada correctamente a CH00.';

    -- Instrumento 2
    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-TEST-002', N'Instrumento prueba 2');

    SET @instrumento2_id = SCOPE_IDENTITY();

    -- Segunda señal al MISMO canal:
    -- DEBE SER RECHAZADA.
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
            @instrumento2_id,
            @clase_control_id,
            @tipo_ai_id,
            @canal_id,
            N'PIT-TEST-002.PV',
            N'Segunda señal intentando ocupar CH00'
        );

    PRINT 'FAIL: SQL Server permitió dos señales activas en el mismo canal.';

    ROLLBACK TRANSACTION;
END TRY

BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 2: SQL Server rechazó la segunda señal en CH00.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;
