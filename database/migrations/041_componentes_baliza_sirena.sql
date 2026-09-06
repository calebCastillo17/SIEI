-- =============================================================================
-- Migracion 041: nucleo.c_baliza, nucleo.c_sirena
-- =============================================================================
-- Duodecima migracion del modulo Hojas de Datos (HD). Ultima familia:
-- Sirenas y Balizas — la mas simple de las 9 (confirmado por la propia
-- _MATRIZ de la usuaria: solo 4 tablas a llenar, "n/a" en TAG_PROCESO
-- porque una sirena/baliza no mide ni actua sobre el fluido de proceso).
-- Con esta migracion se completan las 9 familias de Hojas de Datos.
--
-- C_BALIZA y C_SIRENA son 1:0..1 (asi las definio la propia usuaria en su
-- _MODELO). A diferencia de las familias de medicion (donde TRANSMISOR
-- es claramente el componente principal), aca NO hay un componente
-- obviamente "principal": el tag 620-YA/YL-500x se separa en DOS
-- instrumentos fisicos reales (620-YA sirena, 620-YL baliza — decision
-- ya adoptada por la usuaria, ver _MAPEO), y en el Excel de origen ambos
-- conviven en una sola fila de configuracion. Por eso NINGUNO de los dos
-- se trata como "principal": ambos llevan su propio `modelo`, y el
-- fabricante de cada uno va a marca_aceptable por separado
-- (componente='baliza' / componente='sirena') — ficha_tecnica_instrumento.
-- modelo/fabricante_id quedan sin usar para esta familia especifica, sin
-- perder ningun dato real.
-- =============================================================================

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO


-- 1) nucleo.c_baliza (1:0..1) --------------------------------------------------

CREATE TABLE nucleo.c_baliza (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo                    NVARCHAR(200)        NULL,
    tipo_iluminacion        NVARCHAR(50)         NULL,
    color_lente             NVARCHAR(30)         NULL,
    energia_destello        NVARCHAR(30)         NULL,
    material_carcasa        NVARCHAR(100)        NULL,
    material_lente          NVARCHAR(100)        NULL,
    voltaje_alimentacion    NVARCHAR(30)         NULL,
    consumo_electrico       NVARCHAR(30)         NULL,
    tipo_montaje            NVARCHAR(50)         NULL,
    conexion_electrica      NVARCHAR(50)         NULL,
    grado_proteccion        NVARCHAR(20)         NULL,
    vida_util               NVARCHAR(30)         NULL,
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_baliza_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_baliza_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_baliza PRIMARY KEY (id),
    CONSTRAINT FK_c_baliza_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_baliza_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_baliza_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_baliza_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_baliza_ficha_tecnica_activo
    ON nucleo.c_baliza (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_sirena (1:0..1) --------------------------------------------------

CREATE TABLE nucleo.c_sirena (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo                    NVARCHAR(200)        NULL,
    intensidad_sonora       NVARCHAR(50)         NULL,
    material                NVARCHAR(100)        NULL,
    tonos                   NVARCHAR(100)        NULL,
    volumen                 NVARCHAR(30)         NULL,
    voltaje_alimentacion    NVARCHAR(30)         NULL,
    consumo_electrico       NVARCHAR(30)         NULL,
    tipo_montaje            NVARCHAR(50)         NULL,
    conexion_electrica      NVARCHAR(50)         NULL,
    grado_proteccion        NVARCHAR(20)         NULL,
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_sirena_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_sirena_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_sirena PRIMARY KEY (id),
    CONSTRAINT FK_c_sirena_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_sirena_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_sirena_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_sirena_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_sirena_ficha_tecnica_activo
    ON nucleo.c_sirena (ficha_tecnica_id)
    WHERE activo = 1;
GO
