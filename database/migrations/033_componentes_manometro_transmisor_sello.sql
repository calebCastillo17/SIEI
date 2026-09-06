-- =============================================================================
-- Migracion 033: nucleo.c_manometro, nucleo.c_transmisor,
--                nucleo.c_sello_diafragma + correccion de
--                ficha_tecnica_instrumento.grado_proteccion
-- =============================================================================
-- Cuarta migracion del modulo Hojas de Datos (HD) de instrumentos.
-- Primera tanda de componentes reales, alcance acordado con la usuaria:
-- Manometros + Transmisores de Presion (comparten C_SELLO_DIAFRAGMA,
-- buena primera prueba del patron "un componente, varias familias").
--
-- CORRECCION (antes de crear nada nuevo): migracion 032 agrego
-- ficha_tecnica_instrumento.grado_proteccion como campo de cabecera,
-- basado en la lectura inicial del _MODELO de la usuaria ("cabecera:
-- familia, tipo, fabricante y modelo principal, grado de proteccion").
-- Al construir esta migracion con los VALORES REALES de las hojas
-- Instrumentos_Manometros/Instrumentos_Transmisores se confirmo que el
-- grado de proteccion NUNCA aparece como columna suelta — vive siempre
-- DENTRO del grupo de cada componente ("MANÓMETRO — Grado de proteccion",
-- "TRANSMISOR — Grado de proteccion"), y pueden ser valores DISTINTOS
-- entre componentes de una misma ficha tecnica (ej. el sensor y el
-- transmisor de un mismo compuesto podrian tener IP distinto). A
-- diferencia de modelo/fabricante_id (que SI tienen un componente
-- "principal" razonable por familia — el transmisor en Transmisores, el
-- manometro en Manometros), grado_proteccion no tiene ese mismo respaldo
-- en la evidencia real. Se elimina la columna (nunca tuvo datos reales
-- todavia — confirmado, 0 filas en la tabla) y se agrega a cada C_*
-- donde corresponde. Migracion 032 queda intacta como archivo.
--
-- Las 3 tablas son 1:0..1 con ficha_tecnica_instrumento (nunca mas de
-- una fila activa por ficha) — unique FILTRADO por activo=1, mismo
-- criterio que el resto del esquema (nunca un UNIQUE plano). Todos los
-- campos quedan como texto libre, mismo criterio ya usado en 030/031/032:
-- la propia usuaria decidio no normalizar numero+unidad todavia.
--
-- Campos EXCLUIDOS deliberadamente porque ya viven en otro lado
-- (evidencia real, no un supuesto):
--   - Fabricante -> nucleo.marca_aceptable (componente='manometro'/
--     'transmisor'/'sello_diafragma') — los valores reales YA vienen
--     multi-marca ("Ashcroft / Wika (Nota 6)"), exactamente el caso que
--     marca_aceptable resuelve.
--   - Modelo de MANÓMETRO/TRANSMISOR -> ya es
--     ficha_tecnica_instrumento.modelo (son el componente PRINCIPAL de su
--     propia familia). C_SELLO_DIAFRAGMA SI tiene su propio `modelo`
--     porque es un componente SECUNDARIO (nunca el principal de ninguna
--     familia) — su modelo es un dato distinto del de la cabecera.
--   - Conexion a proceso: SI se conserva por componente (no se asume
--     igual a instrumento.conexion_proceso) — evidencia real: PI-5072 en
--     P&ID trae conexion_proceso="1/2\" NPT" (resumen), pero su propia
--     Hoja de Datos trae "MANÓMETRO — Conexión a proceso" = "Inferior -
--     1/2\" MNPT" (mas especifico: orientacion + genero de rosca). No son
--     el mismo nivel de detalle, se conservan ambos.
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


-- 0) Correccion: baja grado_proteccion de la cabecera -------------------------

ALTER TABLE nucleo.ficha_tecnica_instrumento
    DROP COLUMN grado_proteccion;
GO


-- 1) nucleo.c_manometro ---------------------------------------------------

CREATE TABLE nucleo.c_manometro (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    ficha_tecnica_id            BIGINT               NOT NULL,

    tipo                        NVARCHAR(200)        NULL,
    rango_medicion              NVARCHAR(50)         NULL,
    exactitud                   NVARCHAR(50)         NULL,
    proteccion_sobrepresion     NVARCHAR(50)         NULL,
    material_elemento_presion   NVARCHAR(100)        NULL,
    material_caja               NVARCHAR(100)        NULL,
    disco_seguridad             NVARCHAR(50)         NULL,
    tamano_color_dial           NVARCHAR(50)         NULL,
    escala                      NVARCHAR(50)         NULL,
    material_aguja              NVARCHAR(100)        NULL,
    cero_ajustable              NVARCHAR(50)         NULL,
    fluido_relleno              NVARCHAR(50)         NULL,
    conexion_proceso            NVARCHAR(100)        NULL,
    grado_proteccion            NVARCHAR(20)         NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_manometro_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_manometro_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_manometro PRIMARY KEY (id),
    CONSTRAINT FK_c_manometro_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_manometro_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_manometro_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_manometro_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_manometro_ficha_tecnica_activo
    ON nucleo.c_manometro (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_transmisor ---------------------------------------------------

CREATE TABLE nucleo.c_transmisor (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo_sensor             NVARCHAR(200)        NULL,
    tipo_medicion           NVARCHAR(100)        NULL,
    rango_ajustado          NVARCHAR(50)         NULL,
    exactitud               NVARCHAR(50)         NULL,
    sobrepresion            NVARCHAR(50)         NULL,
    alimentacion            NVARCHAR(100)        NULL,
    senal_salida            NVARCHAR(100)        NULL,
    protocolo_comunicacion  NVARCHAR(50)         NULL,
    conexion_electrica      NVARCHAR(50)         NULL,
    conexion_proceso        NVARCHAR(100)        NULL,
    ajuste_zero_span        NVARCHAR(50)         NULL,
    grado_proteccion        NVARCHAR(20)         NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_transmisor_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_transmisor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_transmisor PRIMARY KEY (id),
    CONSTRAINT FK_c_transmisor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_transmisor_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_transmisor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_transmisor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_transmisor_ficha_tecnica_activo
    ON nucleo.c_transmisor (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 3) nucleo.c_sello_diafragma (compartida por Manometros y Transmisores) ----

CREATE TABLE nucleo.c_sello_diafragma (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo                    NVARCHAR(100)        NULL,
    material_diafragma      NVARCHAR(100)        NULL,
    -- Solo se llena del lado Manometros (Transmisores no lo trae, ver
    -- _MAPEO de la usuaria: "Idénticos salvo que Manómetros trae 'Fluido
    -- de llenado' y Transmisores no. Usar la union.").
    fluido_llenado          NVARCHAR(50)         NULL,
    conexion_instrumento    NVARCHAR(50)         NULL,
    conexion_proceso        NVARCHAR(100)        NULL,
    -- Componente SECUNDARIO (nunca el principal de una familia) -> tiene
    -- su propio modelo, distinto de ficha_tecnica_instrumento.modelo.
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_sello_diafragma_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_sello_diafragma_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_sello_diafragma PRIMARY KEY (id),
    CONSTRAINT FK_c_sello_diafragma_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_sello_diafragma_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_sello_diafragma_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_sello_diafragma_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_sello_diafragma_ficha_tecnica_activo
    ON nucleo.c_sello_diafragma (ficha_tecnica_id)
    WHERE activo = 1;
GO
