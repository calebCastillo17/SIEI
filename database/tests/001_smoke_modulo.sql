SET NOCOUNT ON;

DECLARE @cliente_id BIGINT;
DECLARE @proyecto_id BIGINT;
DECLARE @tipo_gabinete_rio_id BIGINT;
DECLARE @gabinete_id BIGINT;
DECLARE @rack_id BIGINT;
DECLARE @slot_id BIGINT;
DECLARE @tipo_ai_id BIGINT;
DECLARE @catalogo_modulo_id BIGINT;
DECLARE @modulo_id BIGINT;

-- 1. CLIENTE TEST
INSERT INTO nucleo.cliente (nombre, codigo_interno)
VALUES (N'CLIENTE TEST SIEI', N'TEST-SIEI');

SET @cliente_id = SCOPE_IDENTITY();

-- 2. PROYECTO TEST
INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
VALUES (@cliente_id, N'TEST-001', N'Proyecto de prueba SIEI');

SET @proyecto_id = SCOPE_IDENTITY();

-- 3. GABINETE (ex RIO, migracion 012 — tipo_gabinete_id ahora obligatorio)
SELECT @tipo_gabinete_rio_id = id
FROM cat.cat_tipo_gabinete
WHERE codigo = N'RIO';

INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, descripcion, tipo_gabinete_id)
VALUES (@proyecto_id, N'RIO-TEST-001', N'RIO de prueba', @tipo_gabinete_rio_id);

SET @gabinete_id = SCOPE_IDENTITY();

-- 4. RACK
INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack)
VALUES (@proyecto_id, @gabinete_id, 1);

SET @rack_id = SCOPE_IDENTITY();

-- 5. SLOT
INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot)
VALUES (@proyecto_id, @rack_id, 1);

SET @slot_id = SCOPE_IDENTITY();

-- 6. Obtener AI
SELECT @tipo_ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

-- 7. Crear modelo de módulo AI de 8 canales
INSERT INTO cat.cat_modulo_io
    (fabricante, modelo, tipo_io_id, canales_max)
VALUES
    (N'SIEI TEST', N'AI-8CH-TEST', @tipo_ai_id, 8);

SET @catalogo_modulo_id = SCOPE_IDENTITY();

-- 8. Crear módulo
-- El trigger TR_modulo_generar_canales debe generar automáticamente CH00..CH07
INSERT INTO nucleo.modulo
    (proyecto_id, slot_id, catalogo_modulo_id)
VALUES
    (@proyecto_id, @slot_id, @catalogo_modulo_id);

SET @modulo_id = SCOPE_IDENTITY();

-- RESULTADOS
SELECT
    @cliente_id AS cliente_id,
    @proyecto_id AS proyecto_id,
    @gabinete_id AS gabinete_id,
    @rack_id AS rack_id,
    @slot_id AS slot_id,
    @modulo_id AS modulo_id;

SELECT
    id,
    modulo_id,
    numero_canal,
    activo
FROM nucleo.canal
WHERE modulo_id = @modulo_id
ORDER BY numero_canal;
