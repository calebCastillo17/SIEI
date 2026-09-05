-- =============================================================================
-- Migracion 029: nucleo.cable.tipo_construccion_id / cantidad_unidades /
--                calibre / apantallado + cat.cat_tipo_construccion_cable
-- =============================================================================
-- Contexto: nucleo.cable.tipo_cable es texto libre desde 001 (ej.
-- "1-19c#14 AWG", "1-1p#16 AWG+SH", "1-12Tr#18 AWG+SH") — codifica en un
-- solo string la construccion fisica del cable (c=conductores sueltos,
-- p=pares, Tr=triadas), la cantidad de esas unidades, el calibre (AWG) y
-- si tiene apantallado ("+SH"). El usuario pidio, al pulir el export de
-- SENALES_CONTROL, poder establecer esto de forma estructurada en vez de
-- depender de parsear ese texto — mismo criterio ya usado en el resto del
-- proyecto (cat_tipo_gabinete, cat_tipo_plano, cat_tipo_dato_com, etc.).
--
-- IMPORTANTE, verificado con datos reales antes de escribir esto:
-- nucleo.cable.capacidad_conductores YA esta bien calculada HOY — ya
-- guarda el total de CONDUCTORES INDIVIDUALES sin importar si el cable es
-- "c" o "p" (ej. "1-1p#16 AWG+SH" -> capacidad_conductores = 2, no 1;
-- "1-12p#18 AWG+SH" -> 24, no 12) — quien cargo estos datos ya hizo esa
-- conversion antes de guardarlos. Esta migracion NO toca ni recalcula
-- capacidad_conductores — agrega columnas nuevas para saber
-- ESTRUCTURADAMENTE cómo se llego a ese numero, nada mas.
--
-- cat.cat_tipo_construccion_cable (global, lista cerrada, mismo patron
-- que el resto de cat.*): CONDUCTORES / PARES / TRIADAS — las 3 unicas
-- variantes confirmadas en los tipo_cable reales de este proyecto (620:
-- "c", "p" y "Tr" respectivamente).
--
-- nucleo.cable gana 4 columnas, todas NULL (no se fuerza NOT NULL: no
-- hay evidencia todavia de que TODOS los tipo_cable de TODOS los
-- proyectos existentes parseen limpio con este esquema, un cable con
-- datos ambiguos/legados queda simplemente sin clasificar hasta que
-- alguien lo revise):
--   - tipo_construccion_id BIGINT NULL (FK a cat.cat_tipo_construccion_cable)
--   - cantidad_unidades    SMALLINT NULL (el "12" de "1-12p" — la cantidad
--     de conductores/pares/triadas, ANTES de multiplicar por 2 o 3)
--   - calibre              NVARCHAR(20) NULL (ej. "14 AWG", "18 AWG")
--   - apantallado          BIT NULL (el "+SH")
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

CREATE TABLE cat.cat_tipo_construccion_cable (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_construccion_cable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_construccion_cable PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_construccion_cable_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_construccion_cable (codigo, descripcion) VALUES
    (N'CONDUCTORES', N'Conductores sueltos (ej. "19c" en 1-19c#14 AWG) — 1 conductor fisico = 1 unidad'),
    (N'PARES',       N'Pares trenzados (ej. "1p"/"12p") — 1 unidad = 2 conductores fisicos'),
    (N'TRIADAS',     N'Triadas (ej. "12Tr", tipico de RTD de 3 hilos) — 1 unidad = 3 conductores fisicos');
GO

ALTER TABLE nucleo.cable
    ADD tipo_construccion_id BIGINT       NULL,
        cantidad_unidades    SMALLINT     NULL,
        calibre              NVARCHAR(20) NULL,
        apantallado          BIT          NULL;
GO

ALTER TABLE nucleo.cable
    ADD CONSTRAINT FK_cable_tipo_construccion FOREIGN KEY (tipo_construccion_id) REFERENCES cat.cat_tipo_construccion_cable (id);
GO

ALTER TABLE nucleo.cable
    ADD CONSTRAINT CK_cable_cantidad_unidades_positiva CHECK (cantidad_unidades IS NULL OR cantidad_unidades > 0);
GO
