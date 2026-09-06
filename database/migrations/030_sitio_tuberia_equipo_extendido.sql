-- =============================================================================
-- Migracion 030: nucleo.sitio, nucleo.tuberia, nucleo.equipo extendido,
--                cat.cat_orden_tipo_instrumento.familia
-- =============================================================================
-- Primera migracion del modulo Hojas de Datos (HD) de instrumentos —
-- contexto compartido (sitio/tuberia), nunca componentes ni catalogo
-- todavia. Ver conversacion: la usuaria trae un Excel "DB HD.xlsx" con un
-- modelo relacional propio (hojas _MODELO/_MAPEO/_MATRIZ/_T_*) ya bastante
-- maduro; esta migracion es el resultado de contrastarlo campo por campo
-- contra el esquema real de SIEI (via API, proyecto 50050) antes de crear
-- nada nuevo — varias de sus tablas propuestas (TAG, EQUIPO, tag_padre)
-- resultaron ser YA nucleo.instrumento/equipo/instrumento_asociado_id, y
-- no se duplican aqui.
--
-- 1) nucleo.sitio — condiciones ambientales del proyecto. La usuaria
--    confirmo que un proyecto real nunca tiene mas de un sitio -> 1:1 con
--    proyecto, mismo patron que nucleo.proyecto_documentacion (migracion
--    006): PK propio + UNIQUE(proyecto_id), sin `activo` (una fila
--    singleton no se "desactiva", se reemplaza su contenido).
--
-- 2) nucleo.tuberia — 1 fila por linea de tuberia unica. Confirmado con
--    datos reales del proyecto 50050 que nucleo.instrumento.linea_pnid
--    (ya poblado por el importador P&ID, migracion 004) trae EXACTAMENTE
--    el mismo texto que la usuaria usa como tag de linea (ej.
--    "620-TL-24\"-L1E0U-26807" en ambos lados) — tuberia.tag_linea se
--    resuelve contra ese texto ya existente, igual que equipo_asociado_tag
--    o instrumento_asociado_tag; no se agrega un campo de texto nuevo en
--    instrumento para esto. tag_linea queda SIN unique (sin evidencia de
--    que sea siempre unico, mismo criterio ya usado en plano.codigo_plano
--    y senal.codigo_senal) — solo un indice no-unico para busqueda.
--    nucleo.instrumento gana tuberia_id (FK compuesta nullable).
--
-- 3) nucleo.instrumento gana sitio_id (FK compuesta nullable a
--    nucleo.sitio) — nucleo.sitio gana UNIQUE(id, proyecto_id) ademas de
--    UNIQUE(proyecto_id) para soportar esa FK compuesta (mismo patron de
--    aislamiento multi-proyecto que el resto del esquema).
--
-- 4) nucleo.equipo — le faltaban campos fisicos que la usuaria SI necesita
--    (verificado con datos reales de su Excel, grupo "TANQUE O
--    RECIPIENTE": tipo="Poza de Emergencia", dimensiones="30.0 x 60.0 m",
--    altura="13.0 m", orientacion="Vertical", conexion="Mediante bracket
--    para 1 1/2\" NPT"). Se agregan directo a nucleo.equipo (no como
--    tabla satelite aparte) por el mismo criterio ya usado para extender
--    instrumento en las migraciones 004/005/007: si el dato es identidad
--    propia del equipo, se agrega ahi. Todos texto libre por decision
--    explicita de la usuaria (no normalizar numero+unidad todavia, mismo
--    criterio que ya se uso para el tamano nominal de valvula en su
--    propio analisis _T_VALVULA).
--    clase_equipo es DISTINTO de tipo_equipo_id (migracion 007,
--    ELECTRICO/INSTRUMENTACION = disciplina) — clase_equipo es la clase
--    de activo (tanque/bomba/poza), un concepto que no existia.
--
-- 5) cat.cat_orden_tipo_instrumento (migracion 006, prefijo -> orden LDI)
--    gana `familia` (NVARCHAR NULL, sin CHECK ni backfill: la usuaria
--    identifico 3 familias reales en su _MATRIZ -- MEDICION / ELEMENTO
--    FINAL / SEÑALIZACION -- pero asignarlas fila por fila es una regla
--    de ingenieria que no corresponde inventar aqui, queda NULL hasta que
--    se confirme). Se extiende la tabla existente en vez de crear un
--    CAT_TIPO_INSTRUMENTO nuevo con la misma clave (prefijo) para no
--    tener dos catalogos que puedan desincronizarse.
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


-- 1) nucleo.sitio ------------------------------------------------------------

CREATE TABLE nucleo.sitio (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,

    altitud_msnm            INT                  NULL,
    temp_min_c              DECIMAL(5,1)         NULL,
    temp_max_c              DECIMAL(5,1)         NULL,
    humedad_relativa_pct    DECIMAL(5,1)         NULL,
    medio_ambiente          NVARCHAR(300)        NULL,
    ciclo_trabajo           NVARCHAR(200)        NULL,
    clasificacion_area      NVARCHAR(100)        NULL,

    created_at  DATETIME2 NOT NULL CONSTRAINT DF_sitio_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_sitio PRIMARY KEY (id),
    CONSTRAINT UQ_sitio_proyecto UNIQUE (proyecto_id),
    CONSTRAINT UQ_sitio_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_sitio_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_sitio_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_sitio_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


-- 2) nucleo.tuberia ------------------------------------------------------------

CREATE TABLE nucleo.tuberia (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,

    tag_linea               NVARCHAR(100)        NULL,
    tamano_diametro         NVARCHAR(20)         NULL,
    material_tuberia        NVARCHAR(200)        NULL,
    material_revestimiento  NVARCHAR(200)        NULL,
    espesor_revestimiento   NVARCHAR(50)         NULL,
    schedule                NVARCHAR(20)         NULL,
    norma_bridas            NVARCHAR(50)         NULL,
    cara_bridas             NVARCHAR(200)        NULL,
    conexion_instrumento    NVARCHAR(200)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_tuberia_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_tuberia_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_tuberia PRIMARY KEY (id),
    CONSTRAINT UQ_tuberia_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_tuberia_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tuberia_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tuberia_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- No unique: sin evidencia de que tag_linea sea siempre distinto (mismo
-- criterio que plano.codigo_plano/senal.codigo_senal) — solo apoya busqueda.
CREATE INDEX IX_tuberia_proyecto_tag_linea
    ON nucleo.tuberia (proyecto_id, tag_linea)
    WHERE tag_linea IS NOT NULL AND activo = 1;
GO


-- 3) nucleo.instrumento gana sitio_id / tuberia_id ----------------------------

ALTER TABLE nucleo.instrumento
    ADD sitio_id   BIGINT NULL,
        tuberia_id BIGINT NULL;
GO

ALTER TABLE nucleo.instrumento
    ADD CONSTRAINT FK_instrumento_sitio
        FOREIGN KEY (sitio_id, proyecto_id) REFERENCES nucleo.sitio (id, proyecto_id);
GO

ALTER TABLE nucleo.instrumento
    ADD CONSTRAINT FK_instrumento_tuberia
        FOREIGN KEY (tuberia_id, proyecto_id) REFERENCES nucleo.tuberia (id, proyecto_id);
GO


-- 4) nucleo.equipo — campos fisicos nuevos, todos texto libre ----------------

ALTER TABLE nucleo.equipo
    ADD clase_equipo         NVARCHAR(50)  NULL,
        dimensiones_wxd      NVARCHAR(50)  NULL,
        altura               NVARCHAR(20)  NULL,
        orientacion          NVARCHAR(20)  NULL,
        conexion_instrumento NVARCHAR(100) NULL,
        material             NVARCHAR(100) NULL;
GO


-- 5) cat.cat_orden_tipo_instrumento.familia ----------------------------------

ALTER TABLE cat.cat_orden_tipo_instrumento
    ADD familia NVARCHAR(50) NULL;
GO
