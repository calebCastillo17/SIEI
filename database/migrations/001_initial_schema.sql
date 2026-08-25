/* =============================================================================
   001_initial_schema.sql — SIEI (Sistema Integrado de Entregables de Ingeniería)
   Esquema físico inicial del núcleo, para Microsoft SQL Server / T-SQL.

   Generado exclusivamente a partir de:
     - docs/MODELO_CONCEPTUAL_SIEI.md
     - docs/MODELO_LOGICO_SIEI.md
     - docs/MODELO_FISICO_SIEI.md   (referencia principal de implementación)
     - docs/MATRIZ_COBERTURA_DATOS_SIEI.md

   Alcance: esquemas cat/nucleo, catálogos universales aprobados, tablas del
   núcleo, PK BIGINT IDENTITY, FK simples y compuestas (proyecto_id) para
   aislamiento multiproyecto, UNIQUE e índices únicos filtrados, CHECK,
   índices adicionales, DEFAULT de auditoría/activo, y los 12 triggers
   aprobados. Row-Level Security, usuarios, created_by/updated_by,
   RUTA_ALIMENTACION/TRAMO_ALIMENTACION, trazabilidad, matriz causa-efecto y
   documentos/entregables quedan explícitamente FUERA de alcance (diferidos).

   AUDITORÍA — updated_at: SQL Server genera created_at automáticamente
   (DEFAULT SYSUTCDATETIME()). updated_at NO tiene trigger ni DEFAULT que lo
   mantenga — queda explícitamente como responsabilidad del futuro backend/
   aplicación (no se agrega un trigger genérico de auditoría en esta etapa).

   No se insertan datos de ningún proyecto real — únicamente seeds de
   catálogos universales confirmados como listas cerradas en los documentos.
============================================================================= */

-- =============================================================================
-- 0. OPCIONES DE SESIÓN — OBLIGATORIAS PARA ÍNDICES FILTRADOS
-- =============================================================================
-- SQL Server exige estas 7 opciones con estos valores exactos para poder
-- CREAR (y luego para poder modificar datos de tablas con) índices filtrados,
-- índices sobre vistas indexadas y columnas calculadas persistidas.
-- Si alguna difiere, cada CREATE UNIQUE INDEX ... WHERE ... falla con el
-- error 1934 ("CREATE INDEX failed because the following SET options have
-- incorrect settings"). Como cada índice vive en su propio batch GO, ese
-- error NO detiene el resto del script: las tablas y los triggers se crean
-- igual y los índices filtrados quedan silenciosamente sin crear — que es
-- exactamente el síntoma observado (sys.indexes WHERE has_filter = 1 => 0 filas).
-- Estas opciones son de SESIÓN y persisten a través de los GO siguientes.
-- =============================================================================
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- =============================================================================
-- 1. ESQUEMAS
-- =============================================================================
CREATE SCHEMA cat;
GO
CREATE SCHEMA nucleo;
GO

-- =============================================================================
-- 2. CATÁLOGOS UNIVERSALES (schema cat) — sin proyecto_id, sin activo
-- =============================================================================

CREATE TABLE cat.cat_tipo_io (                                    -- MODELO_FISICO_SIEI.md 8, cat.cat_tipo_io (2.12)
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_io_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_io PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_io_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_direccion_com (                               -- cat.cat_direccion_com (2.12)
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_direccion_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_direccion_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_direccion_com_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_clase_senal (                                 -- cat.cat_clase_senal (2.14 / 6.9)
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_clase_senal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_clase_senal PRIMARY KEY (id),
    CONSTRAINT UQ_cat_clase_senal_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_tipo_interfaz (                               -- cat.cat_tipo_interfaz — sin seed, dominio abierto ("etc.") en los documentos
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_interfaz_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_interfaz PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_interfaz_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_estado_revision (                             -- cat.cat_estado_revision — 🟢 lista cerrada confirmada en Excel
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_estado_revision_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_estado_revision PRIMARY KEY (id),
    CONSTRAINT UQ_cat_estado_revision_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_prioridad_alarma (                            -- cat.cat_prioridad_alarma — 🟢 lista cerrada confirmada en Excel
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_prioridad_alarma_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_prioridad_alarma PRIMARY KEY (id),
    CONSTRAINT UQ_cat_prioridad_alarma_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_estado_pnid (                                 -- cat.cat_estado_pnid — 🟢 lista cerrada confirmada en Excel
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_estado_pnid_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_estado_pnid PRIMARY KEY (id),
    CONSTRAINT UQ_cat_estado_pnid_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_tipo_com (                                    -- cat.cat_tipo_com (5.8/5.9) — sin seed, solo "ejemplos de evidencia", no lista cerrada confirmada
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_com_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_tipo_medio_com (                              -- cat.cat_tipo_medio_com (5.8/5.9) — sin seed, mismo motivo
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_medio_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_medio_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_medio_com_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_modulo_io (                                   -- cat.cat_modulo_io — catálogo de hardware, sin seed (abierto por fabricante/modelo real)
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    fabricante          NVARCHAR(100)        NOT NULL,
    modelo              NVARCHAR(100)        NOT NULL,
    tipo_io_id          BIGINT               NOT NULL,
    canales_max         SMALLINT             NOT NULL,
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_cat_modulo_io_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    CONSTRAINT PK_cat_modulo_io PRIMARY KEY (id),
    CONSTRAINT UQ_cat_modulo_io_fabricante_modelo UNIQUE (fabricante, modelo),
    CONSTRAINT CK_cat_modulo_io_canales_max CHECK (canales_max > 0),
    CONSTRAINT FK_cat_modulo_io_tipo_io FOREIGN KEY (tipo_io_id) REFERENCES cat.cat_tipo_io (id)
);
GO

-- =============================================================================
-- 3. SEEDS DE CATÁLOGOS CONFIRMADOS (solo listas cerradas explícitamente
--    confirmadas en los documentos — NO se inventan valores nuevos)
-- =============================================================================

INSERT INTO cat.cat_clase_senal (codigo, descripcion) VALUES
    (N'CONTROL', N'Señal cableada/hardwired de instrumentación y control'),
    (N'COM',     N'Señal comunicada a través de infraestructura de red');
GO

INSERT INTO cat.cat_direccion_com (codigo, descripcion) VALUES
    (N'IN',  N'Dato entrante desde la red de comunicaciones'),
    (N'OUT', N'Dato saliente hacia la red de comunicaciones');
GO

INSERT INTO cat.cat_tipo_io (codigo, descripcion) VALUES
    (N'AI',  N'Entrada analógica'),
    (N'AO',  N'Salida analógica'),
    (N'DI',  N'Entrada digital'),
    (N'DO',  N'Salida digital'),
    (N'RTD', N'Entrada de temperatura (RTD)');
GO

INSERT INTO cat.cat_estado_pnid (codigo, descripcion) VALUES
    (N'OK',                 N'Instrumento validado contra el P&ID'),
    (N'NUEVO_EN_PNID',      N'Instrumento nuevo detectado en el P&ID'),
    (N'NO_EXISTE_EN_PNID',  N'Instrumento del master que ya no existe en el P&ID'),
    (N'TAG_DUPLICADO',      N'TAG duplicado detectado en el P&ID'),
    (N'TAG_VACIO',          N'TAG vacío en el P&ID'),
    (N'TAG_MODIFICADO',     N'TAG modificado respecto al P&ID'),
    (N'NO_LISTADO',         N'Instrumento no listado en el P&ID');
GO

INSERT INTO cat.cat_estado_revision (codigo, descripcion) VALUES
    (N'PENDIENTE',    N'Revisión pendiente'),
    (N'EN REVISION',  N'En proceso de revisión'),
    (N'APROBADA',     N'Revisión aprobada'),
    (N'OBSERVADA',    N'Revisión observada');
GO

INSERT INTO cat.cat_prioridad_alarma (codigo, descripcion) VALUES
    (N'BAJA',    N'Prioridad baja'),
    (N'MEDIA',   N'Prioridad media'),
    (N'ALTA',    N'Prioridad alta'),
    (N'CRITICA', N'Prioridad crítica');
GO

-- =============================================================================
-- 4. TABLAS RAÍZ (schema nucleo)
-- =============================================================================

CREATE TABLE nucleo.cliente (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    nombre          NVARCHAR(200)        NOT NULL,
    codigo_interno  NVARCHAR(50)         NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_cliente_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cliente_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cliente PRIMARY KEY (id)
);
GO

CREATE TABLE nucleo.proyecto (
    id               BIGINT IDENTITY(1,1) NOT NULL,
    cliente_id       BIGINT               NOT NULL,
    codigo_proyecto  NVARCHAR(30)         NOT NULL,
    nombre           NVARCHAR(200)        NOT NULL,
    activo           BIT                  NOT NULL CONSTRAINT DF_proyecto_activo DEFAULT (1),
    created_at       DATETIME2            NOT NULL CONSTRAINT DF_proyecto_created_at DEFAULT SYSUTCDATETIME(),
    updated_at       DATETIME2            NULL,
    CONSTRAINT PK_proyecto PRIMARY KEY (id),
    CONSTRAINT FK_proyecto_cliente FOREIGN KEY (cliente_id) REFERENCES nucleo.cliente (id)
);
GO

-- =============================================================================
-- 5. TABLAS DEPENDIENTES DEL NÚCLEO (orden de dependencia)
-- =============================================================================

-- 5.1 instrumento -----------------------------------------------------------
CREATE TABLE nucleo.instrumento (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    estado_pnid_id          BIGINT               NULL,
    tag_instrumento         NVARCHAR(50)         NOT NULL,
    pnpid                   NVARCHAR(50)         NULL,
    fuente_pnpid            NVARCHAR(50)         NULL,
    descripcion             NVARCHAR(300)        NULL,
    tipo_instrumento        NVARCHAR(50)         NULL,
    servicio                NVARCHAR(200)        NULL,
    sistema                 NVARCHAR(50)         NULL,
    ubicacion               NVARCHAR(100)        NULL,
    nodo                    NVARCHAR(50)         NULL,
    fecha_agregado          DATE                 NULL,
    fecha_ultima_revision   DATE                 NULL,
    activo                  BIT                  NOT NULL CONSTRAINT DF_instrumento_activo DEFAULT (1),
    created_at              DATETIME2            NOT NULL CONSTRAINT DF_instrumento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at              DATETIME2            NULL,
    CONSTRAINT PK_instrumento PRIMARY KEY (id),
    CONSTRAINT UQ_instrumento_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_instrumento_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_instrumento_estado_pnid FOREIGN KEY (estado_pnid_id) REFERENCES cat.cat_estado_pnid (id)
);
GO

-- 5.2 equipo ------------------------------------------------------------------
CREATE TABLE nucleo.equipo (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    tag_equipo      NVARCHAR(50)         NOT NULL,
    descripcion     NVARCHAR(300)        NULL,
    sistema         NVARCHAR(50)         NULL,
    nodo            NVARCHAR(50)         NULL,
    panel           NVARCHAR(50)         NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_equipo_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_equipo_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_equipo PRIMARY KEY (id),
    CONSTRAINT UQ_equipo_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_equipo_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id)
);
GO

-- 5.3 rio -----------------------------------------------------------------
CREATE TABLE nucleo.rio (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    tag_rio         NVARCHAR(50)         NOT NULL,
    descripcion     NVARCHAR(300)        NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_rio_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_rio_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_rio PRIMARY KEY (id),
    CONSTRAINT UQ_rio_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_rio_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id)
);
GO

-- 5.4 rack (depende de rio) ------------------------------------------------
CREATE TABLE nucleo.rack (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    rio_id          BIGINT               NOT NULL,
    numero_rack     SMALLINT             NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_rack_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_rack_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_rack PRIMARY KEY (id),
    CONSTRAINT UQ_rack_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_rack_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_rack_rio FOREIGN KEY (rio_id, proyecto_id) REFERENCES nucleo.rio (id, proyecto_id)
);
GO

-- 5.5 slot (depende de rack) -----------------------------------------------
CREATE TABLE nucleo.slot (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    rack_id         BIGINT               NOT NULL,
    numero_slot     SMALLINT             NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_slot_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_slot_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_slot PRIMARY KEY (id),
    CONSTRAINT UQ_slot_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_slot_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_slot_rack FOREIGN KEY (rack_id, proyecto_id) REFERENCES nucleo.rack (id, proyecto_id)
);
GO

-- 5.6 modulo (depende de slot y cat_modulo_io) -----------------------------
CREATE TABLE nucleo.modulo (
    id                   BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id          BIGINT               NOT NULL,
    slot_id              BIGINT               NOT NULL,
    catalogo_modulo_id   BIGINT               NOT NULL,
    activo               BIT                  NOT NULL CONSTRAINT DF_modulo_activo DEFAULT (1),
    created_at           DATETIME2            NOT NULL CONSTRAINT DF_modulo_created_at DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2            NULL,
    CONSTRAINT PK_modulo PRIMARY KEY (id),
    CONSTRAINT UQ_modulo_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_modulo_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_modulo_slot FOREIGN KEY (slot_id, proyecto_id) REFERENCES nucleo.slot (id, proyecto_id),
    CONSTRAINT FK_modulo_catalogo_modulo FOREIGN KEY (catalogo_modulo_id) REFERENCES cat.cat_modulo_io (id)
);
GO

-- 5.7 canal (depende de modulo) --------------------------------------------
CREATE TABLE nucleo.canal (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    modulo_id       BIGINT               NOT NULL,
    numero_canal    SMALLINT             NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_canal_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_canal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_canal PRIMARY KEY (id),
    CONSTRAINT UQ_canal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_canal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_canal_modulo FOREIGN KEY (modulo_id, proyecto_id) REFERENCES nucleo.modulo (id, proyecto_id)
);
GO

-- 5.8 switch ----------------------------------------------------------------
CREATE TABLE nucleo.switch (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    tag_switch      NVARCHAR(50)         NOT NULL,
    descripcion     NVARCHAR(300)        NULL,
    marca_modelo    NVARCHAR(100)        NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_switch_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_switch_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_switch PRIMARY KEY (id),
    CONSTRAINT UQ_switch_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_switch_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id)
);
GO

-- 5.9 puerto (depende de switch) --------------------------------------------
CREATE TABLE nucleo.puerto (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    switch_id       BIGINT               NOT NULL,
    numero_puerto   SMALLINT             NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_puerto_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_puerto_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_puerto PRIMARY KEY (id),
    CONSTRAINT UQ_puerto_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_puerto_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_puerto_switch FOREIGN KEY (switch_id, proyecto_id) REFERENCES nucleo.switch (id, proyecto_id)
);
GO

-- 5.10 enlace_com (depende de equipo, instrumento, puerto) ------------------
CREATE TABLE nucleo.enlace_com (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    equipo_id       BIGINT               NULL,
    instrumento_id  BIGINT               NULL,
    puerto_id       BIGINT               NOT NULL,
    tipo_com_id     BIGINT               NULL,
    tipo_medio_id   BIGINT               NULL,
    tag_medio       NVARCHAR(50)         NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_enlace_com_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_enlace_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_enlace_com PRIMARY KEY (id),
    CONSTRAINT UQ_enlace_com_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_enlace_com_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_enlace_com_equipo FOREIGN KEY (equipo_id, proyecto_id) REFERENCES nucleo.equipo (id, proyecto_id),
    CONSTRAINT FK_enlace_com_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_enlace_com_puerto FOREIGN KEY (puerto_id, proyecto_id) REFERENCES nucleo.puerto (id, proyecto_id),
    CONSTRAINT FK_enlace_com_tipo_com FOREIGN KEY (tipo_com_id) REFERENCES cat.cat_tipo_com (id),
    CONSTRAINT FK_enlace_com_tipo_medio FOREIGN KEY (tipo_medio_id) REFERENCES cat.cat_tipo_medio_com (id),
    CONSTRAINT CK_enlace_com_origen_xor CHECK (
        (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) = 1
    )
);
GO

-- 5.11 caja -------------------------------------------------------------------
CREATE TABLE nucleo.caja (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    tag_caja        NVARCHAR(50)         NOT NULL,
    descripcion     NVARCHAR(300)        NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_caja_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_caja_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_caja PRIMARY KEY (id),
    CONSTRAINT UQ_caja_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_caja_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id)
);
GO

-- 5.12 cable --------------------------------------------------------------
CREATE TABLE nucleo.cable (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    tag_cable               NVARCHAR(50)         NOT NULL,
    tipo_cable              NVARCHAR(100)        NULL,
    capacidad_conductores   SMALLINT             NOT NULL,
    activo                  BIT                  NOT NULL CONSTRAINT DF_cable_activo DEFAULT (1),
    created_at              DATETIME2            NOT NULL CONSTRAINT DF_cable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at              DATETIME2            NULL,
    CONSTRAINT PK_cable PRIMARY KEY (id),
    CONSTRAINT UQ_cable_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_cable_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT CK_cable_capacidad_positiva CHECK (capacidad_conductores > 0)
);
GO

-- 5.13 par_conductor (depende de cable; sin columna activo, ver 2) ---------
CREATE TABLE nucleo.par_conductor (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    cable_id        BIGINT               NOT NULL,
    numero_par      SMALLINT             NOT NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_par_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_par_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_par_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT UQ_par_conductor_cable_numero UNIQUE (cable_id, numero_par),
    CONSTRAINT FK_par_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_par_conductor_cable FOREIGN KEY (cable_id, proyecto_id) REFERENCES nucleo.cable (id, proyecto_id)
);
GO

-- 5.14 senal (depende de instrumento, equipo, canal, catálogos) -----------
CREATE TABLE nucleo.senal (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    instrumento_id              BIGINT               NULL,
    equipo_id                   BIGINT               NULL,
    instrumento_agrupador_id    BIGINT               NULL,
    clase_senal_id              BIGINT               NOT NULL,
    tipo_io_id                  BIGINT               NULL,
    direccion_com_id            BIGINT               NULL,
    tipo_interfaz_id            BIGINT               NULL,
    canal_id                    BIGINT               NULL,
    estado_revision_id          BIGINT               NULL,
    prioridad_alarma_id         BIGINT               NULL,
    tag_senal                   NVARCHAR(80)         NOT NULL,
    nombre_corto                NVARCHAR(30)         NULL,
    descripcion                 NVARCHAR(300)        NULL,
    rango_min                   FLOAT                NULL,
    rango_max                   FLOAT                NULL,
    alarma_hh                   FLOAT                NULL,
    alarma_h                    FLOAT                NULL,
    alarma_l                    FLOAT                NULL,
    alarma_ll                   FLOAT                NULL,
    valor_normal                NVARCHAR(50)         NULL,  -- 🟡 tipo provisional, ver MODELO_FISICO_SIEI.md 8.5
    unidad_ingenieria           NVARCHAR(20)         NULL,
    retardo                     NVARCHAR(50)         NULL,  -- 🟡 tipo provisional, ver MODELO_FISICO_SIEI.md 8.5
    enclavamiento                NVARCHAR(300)        NULL,
    observacion                 NVARCHAR(500)        NULL,
    activo                      BIT                  NOT NULL CONSTRAINT DF_senal_activo DEFAULT (1),
    created_at                  DATETIME2            NOT NULL CONSTRAINT DF_senal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at                  DATETIME2            NULL,
    CONSTRAINT PK_senal PRIMARY KEY (id),
    CONSTRAINT UQ_senal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_senal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_senal_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_senal_equipo FOREIGN KEY (equipo_id, proyecto_id) REFERENCES nucleo.equipo (id, proyecto_id),
    CONSTRAINT FK_senal_instrumento_agrupador FOREIGN KEY (instrumento_agrupador_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_senal_canal FOREIGN KEY (canal_id, proyecto_id) REFERENCES nucleo.canal (id, proyecto_id),
    CONSTRAINT FK_senal_clase_senal FOREIGN KEY (clase_senal_id) REFERENCES cat.cat_clase_senal (id),
    CONSTRAINT FK_senal_tipo_io FOREIGN KEY (tipo_io_id) REFERENCES cat.cat_tipo_io (id),
    CONSTRAINT FK_senal_direccion_com FOREIGN KEY (direccion_com_id) REFERENCES cat.cat_direccion_com (id),
    CONSTRAINT FK_senal_tipo_interfaz FOREIGN KEY (tipo_interfaz_id) REFERENCES cat.cat_tipo_interfaz (id),
    CONSTRAINT FK_senal_estado_revision FOREIGN KEY (estado_revision_id) REFERENCES cat.cat_estado_revision (id),
    CONSTRAINT FK_senal_prioridad_alarma FOREIGN KEY (prioridad_alarma_id) REFERENCES cat.cat_prioridad_alarma (id),
    CONSTRAINT CK_senal_origen_xor CHECK (
        (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END) = 1
    ),
    CONSTRAINT CK_senal_tipo_io_direccion_excl CHECK (
        NOT (tipo_io_id IS NOT NULL AND direccion_com_id IS NOT NULL)
    )
);
GO

-- 5.15 punto_conexion (depende de instrumento, equipo, caja, rio, modulo) --
CREATE TABLE nucleo.punto_conexion (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    instrumento_id  BIGINT               NULL,
    equipo_id       BIGINT               NULL,
    caja_id         BIGINT               NULL,
    rio_id          BIGINT               NULL,
    modulo_id       BIGINT               NULL,
    regleta         NVARCHAR(30)         NULL,
    bornera         NVARCHAR(30)         NULL,
    borne           NVARCHAR(30)         NULL,
    lado            NVARCHAR(20)         NULL,
    circuito        NVARCHAR(30)         NULL,
    hilo            NVARCHAR(30)         NULL,
    descripcion     NVARCHAR(200)        NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_punto_conexion_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_punto_conexion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_punto_conexion PRIMARY KEY (id),
    CONSTRAINT UQ_punto_conexion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_punto_conexion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_punto_conexion_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_punto_conexion_equipo FOREIGN KEY (equipo_id, proyecto_id) REFERENCES nucleo.equipo (id, proyecto_id),
    CONSTRAINT FK_punto_conexion_caja FOREIGN KEY (caja_id, proyecto_id) REFERENCES nucleo.caja (id, proyecto_id),
    CONSTRAINT FK_punto_conexion_rio FOREIGN KEY (rio_id, proyecto_id) REFERENCES nucleo.rio (id, proyecto_id),
    CONSTRAINT FK_punto_conexion_modulo FOREIGN KEY (modulo_id, proyecto_id) REFERENCES nucleo.modulo (id, proyecto_id),
    CONSTRAINT CK_punto_conexion_pertenencia_xor CHECK (
        (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN caja_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN rio_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN modulo_id IS NULL THEN 0 ELSE 1 END) = 1
    )
);
GO

-- 5.16 ruta_conexion (depende de senal) ------------------------------------
CREATE TABLE nucleo.ruta_conexion (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    senal_id        BIGINT               NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_ruta_conexion_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_ruta_conexion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_ruta_conexion PRIMARY KEY (id),
    CONSTRAINT UQ_ruta_conexion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_ruta_conexion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_ruta_conexion_senal FOREIGN KEY (senal_id, proyecto_id) REFERENCES nucleo.senal (id, proyecto_id)
);
GO

-- 5.17 tramo_conexion (depende de ruta_conexion, par_conductor, punto_conexion) --
CREATE TABLE nucleo.tramo_conexion (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ruta_conexion_id    BIGINT               NOT NULL,
    par_conductor_id    BIGINT               NOT NULL,
    punto_origen_id     BIGINT               NOT NULL,
    punto_destino_id    BIGINT               NOT NULL,
    numero_orden        SMALLINT             NOT NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_tramo_conexion_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_tramo_conexion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    CONSTRAINT PK_tramo_conexion PRIMARY KEY (id),
    CONSTRAINT UQ_tramo_conexion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_tramo_conexion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tramo_conexion_ruta FOREIGN KEY (ruta_conexion_id, proyecto_id) REFERENCES nucleo.ruta_conexion (id, proyecto_id),
    CONSTRAINT FK_tramo_conexion_par_conductor FOREIGN KEY (par_conductor_id, proyecto_id) REFERENCES nucleo.par_conductor (id, proyecto_id),
    CONSTRAINT FK_tramo_conexion_punto_origen FOREIGN KEY (punto_origen_id, proyecto_id) REFERENCES nucleo.punto_conexion (id, proyecto_id),
    CONSTRAINT FK_tramo_conexion_punto_destino FOREIGN KEY (punto_destino_id, proyecto_id) REFERENCES nucleo.punto_conexion (id, proyecto_id),
    CONSTRAINT CK_tramo_conexion_puntos_distintos CHECK (punto_origen_id <> punto_destino_id),
    CONSTRAINT CK_tramo_conexion_numero_orden CHECK (numero_orden > 0)
);
GO

-- 5.18 lazo (depende de instrumento) ---------------------------------------
CREATE TABLE nucleo.lazo (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    instrumento_id      BIGINT               NOT NULL,
    codigo_documento    NVARCHAR(100)        NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_lazo_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_lazo_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    CONSTRAINT PK_lazo PRIMARY KEY (id),
    CONSTRAINT UQ_lazo_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_lazo_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_lazo_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id)
);
GO

-- =============================================================================
-- 6. ÍNDICES
-- =============================================================================

-- 6.1 Índices únicos filtrados (borrado lógico / liberación de recursos) ----

CREATE UNIQUE INDEX UX_cliente_codigo_interno
    ON nucleo.cliente (codigo_interno)
    WHERE codigo_interno IS NOT NULL AND activo = 1;
GO

CREATE UNIQUE INDEX UX_proyecto_cliente_codigo
    ON nucleo.proyecto (cliente_id, codigo_proyecto)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_instrumento_proyecto_tag
    ON nucleo.instrumento (proyecto_id, tag_instrumento)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_instrumento_proyecto_pnpid
    ON nucleo.instrumento (proyecto_id, pnpid)
    WHERE pnpid IS NOT NULL AND activo = 1;
GO

CREATE UNIQUE INDEX UX_equipo_proyecto_tag
    ON nucleo.equipo (proyecto_id, tag_equipo)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_rio_proyecto_tag
    ON nucleo.rio (proyecto_id, tag_rio)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_rack_rio_numero
    ON nucleo.rack (rio_id, numero_rack)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_slot_rack_numero
    ON nucleo.slot (rack_id, numero_slot)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_modulo_slot
    ON nucleo.modulo (slot_id)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_canal_modulo_numero
    ON nucleo.canal (modulo_id, numero_canal)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_switch_proyecto_tag
    ON nucleo.switch (proyecto_id, tag_switch)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_puerto_switch_numero
    ON nucleo.puerto (switch_id, numero_puerto)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_enlace_com_equipo
    ON nucleo.enlace_com (equipo_id)
    WHERE equipo_id IS NOT NULL AND activo = 1;
GO

CREATE UNIQUE INDEX UX_enlace_com_instrumento
    ON nucleo.enlace_com (instrumento_id)
    WHERE instrumento_id IS NOT NULL AND activo = 1;
GO

CREATE UNIQUE INDEX UX_enlace_com_puerto
    ON nucleo.enlace_com (puerto_id)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_caja_proyecto_tag
    ON nucleo.caja (proyecto_id, tag_caja)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_cable_proyecto_tag
    ON nucleo.cable (proyecto_id, tag_cable)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_senal_proyecto_tag
    ON nucleo.senal (proyecto_id, tag_senal)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_senal_canal_id
    ON nucleo.senal (canal_id)
    WHERE canal_id IS NOT NULL AND activo = 1;
GO

CREATE UNIQUE INDEX UX_ruta_conexion_senal_id
    ON nucleo.ruta_conexion (senal_id)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_tramo_conexion_par_conductor_id
    ON nucleo.tramo_conexion (par_conductor_id)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_tramo_conexion_orden
    ON nucleo.tramo_conexion (ruta_conexion_id, numero_orden)
    WHERE activo = 1;
GO

CREATE UNIQUE INDEX UX_lazo_instrumento_id
    ON nucleo.lazo (instrumento_id)
    WHERE activo = 1;
GO

-- 6.2 Índices adicionales (columnas FK del lado "hijo", no cubiertas por UNIQUE) --

CREATE INDEX IX_senal_instrumento_id ON nucleo.senal (instrumento_id);
GO
CREATE INDEX IX_senal_equipo_id ON nucleo.senal (equipo_id);
GO
CREATE INDEX IX_senal_instrumento_agrupador_id ON nucleo.senal (instrumento_agrupador_id);
GO
CREATE INDEX IX_senal_clase_senal_id ON nucleo.senal (clase_senal_id);
GO
CREATE INDEX IX_tramo_conexion_ruta_conexion_id ON nucleo.tramo_conexion (ruta_conexion_id);
GO
CREATE INDEX IX_tramo_conexion_punto_origen_id ON nucleo.tramo_conexion (punto_origen_id);
GO
CREATE INDEX IX_tramo_conexion_punto_destino_id ON nucleo.tramo_conexion (punto_destino_id);
GO
CREATE INDEX IX_punto_conexion_instrumento_id ON nucleo.punto_conexion (instrumento_id);
GO
CREATE INDEX IX_punto_conexion_equipo_id ON nucleo.punto_conexion (equipo_id);
GO
CREATE INDEX IX_punto_conexion_caja_id ON nucleo.punto_conexion (caja_id);
GO
CREATE INDEX IX_punto_conexion_rio_id ON nucleo.punto_conexion (rio_id);
GO
CREATE INDEX IX_punto_conexion_modulo_id ON nucleo.punto_conexion (modulo_id);
GO
CREATE INDEX IX_lazo_proyecto_id ON nucleo.lazo (proyecto_id);
GO
CREATE INDEX IX_modulo_catalogo_modulo_id ON nucleo.modulo (catalogo_modulo_id);
GO

-- =============================================================================
-- 7. TRIGGERS (12 aprobados) — set-based, multi-row, transición real de estado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7.1 TR_modulo_generar_canales
--     Genera canales faltantes y desactiva/bloquea los sobrantes al reducir
--     canales_max. Solo actúa sobre módulos NUEVOS o cuyo catalogo_modulo_id
--     cambió REALMENTE de valor (no solo "participó" en el UPDATE).
--     FIX #3: un numero_canal cuenta como "ya existente" solo si tiene una
--     fila ACTIVA — una fila histórica inactiva no bloquea la regeneración
--     al reexpandir capacidad (16 -> 8 -> 16 genera una fila NUEVA para
--     CH08..CH15, sin reactivar ni alterar la fila histórica).
--     FIX #5: sin techo artificial de 256 — la recursión se acota al máximo
--     canales_max realmente presente en el lote (@max_canales), no a un
--     número inventado; OPTION (MAXRECURSION 0) deja que esa cota dinámica
--     sea la única frontera.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_modulo_generar_canales ON nucleo.modulo
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(catalogo_modulo_id) RETURN;  -- filtro barato: ¿participó la columna?

    DECLARE @max_canales SMALLINT;
    SELECT @max_canales = MAX(cmi.canales_max)
    FROM inserted i
    LEFT JOIN deleted d ON d.id = i.id
    JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
    WHERE d.id IS NULL OR d.catalogo_modulo_id <> i.catalogo_modulo_id;

    IF @max_canales IS NULL RETURN;  -- ningún módulo cambió realmente de catálogo

    ;WITH cambios AS (
        -- filtro real: fila nueva, o catalogo_modulo_id cambió de valor de verdad
        SELECT i.id AS modulo_id, i.proyecto_id, i.catalogo_modulo_id
        FROM inserted i
        LEFT JOIN deleted d ON d.id = i.id
        WHERE d.id IS NULL
           OR d.catalogo_modulo_id <> i.catalogo_modulo_id
    ),
    afectados AS (
        SELECT c.modulo_id, c.proyecto_id, cmi.canales_max
        FROM cambios c
        JOIN cat.cat_modulo_io cmi ON cmi.id = c.catalogo_modulo_id
    ),
    numeros AS (
        -- FIX punto 1: ancla y miembro recursivo deben tener el MISMO tipo;
        -- INT evita el choque de tipos anchor(SMALLINT) vs recursivo(n+1 => INT).
        -- numero_canal en la tabla sigue siendo SMALLINT; la conversión al
        -- insertar es segura porque num.n siempre queda acotado por canales_max.
        SELECT CAST(0 AS INT) AS n
        UNION ALL
        SELECT n + 1 FROM numeros WHERE n + 1 < @max_canales
    )
    INSERT INTO nucleo.canal (proyecto_id, modulo_id, numero_canal, activo)
    SELECT a.proyecto_id, a.modulo_id, num.n, 1
    FROM afectados a
    CROSS JOIN numeros num
    WHERE num.n < a.canales_max
      AND NOT EXISTS (
          -- FIX #3: solo una fila ACTIVA cuenta como "ya existe" para este numero_canal
          SELECT 1 FROM nucleo.canal ch
          WHERE ch.modulo_id = a.modulo_id AND ch.numero_canal = num.n AND ch.activo = 1
      )
    OPTION (MAXRECURSION 0);

    IF EXISTS (
        SELECT 1
        FROM nucleo.canal ch
        JOIN inserted i ON i.id = ch.modulo_id
        JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
        JOIN nucleo.senal s ON s.canal_id = ch.id AND s.activo = 1
        WHERE ch.numero_canal >= cmi.canales_max AND ch.activo = 1
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51001, 'No se puede reducir la capacidad del modulo: hay canales fuera de rango con senal activa.', 1;
    END

    UPDATE ch SET ch.activo = 0
    FROM nucleo.canal ch
    JOIN inserted i ON i.id = ch.modulo_id
    JOIN cat.cat_modulo_io cmi ON cmi.id = i.catalogo_modulo_id
    WHERE ch.numero_canal >= cmi.canales_max AND ch.activo = 1;
END
GO

-- -----------------------------------------------------------------------------
-- 7.1b TR_modulo_validar_desactivacion  (NUEVO)
--     RONDA "integridad de estados activos" — punto 2(b): no permitir
--     desactivar (transicion real 1 -> 0) un MODULO que tenga canales
--     activos en uso por señales activas. Trigger separado de
--     TR_modulo_generar_canales para mantener responsabilidades distintas:
--     aquel reacciona a cambios de catalogo_modulo_id (capacidad); este
--     reacciona a la desactivacion directa del modulo. No se desasigna nada
--     automaticamente — se rechaza la operacion.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_modulo_validar_desactivacion ON nucleo.modulo
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.canal ch ON ch.modulo_id = i.id AND ch.activo = 1
        JOIN nucleo.senal s ON s.canal_id = ch.id AND s.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51019, 'No se puede desactivar un MODULO con canales activos en uso por señales activas.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.2 TR_canal_validar_capacidad
--     Defensa en profundidad: cantidad de canales activos y rango de
--     numero_canal, siempre contra el estado vigente del modulo afectado.
--     FIX #2: el rango solo se exige a canales ACTIVOS — un canal historico
--     (activo = 0) puede conservar un numero_canal fuera de la capacidad
--     vigente sin bloquear la desactivacion que hace TR_modulo_generar_canales
--     al reducir canales_max.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_canal_validar_capacidad ON nucleo.canal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN nucleo.modulo m ON m.id = i.modulo_id
        JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
        WHERE i.activo = 1
          AND (i.numero_canal < 0 OR i.numero_canal >= cmi.canales_max)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51002, 'numero_canal fuera del rango permitido por el modelo de modulo.', 1;
    END

    IF EXISTS (
        SELECT ch.modulo_id
        FROM nucleo.canal ch
        JOIN nucleo.modulo m ON m.id = ch.modulo_id
        JOIN cat.cat_modulo_io cmi ON cmi.id = m.catalogo_modulo_id
        WHERE ch.modulo_id IN (SELECT modulo_id FROM inserted)
        GROUP BY ch.modulo_id, cmi.canales_max
        HAVING SUM(CASE WHEN ch.activo = 1 THEN 1 ELSE 0 END) > cmi.canales_max
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51003, 'La cantidad de canales activos excede la capacidad del modulo.', 1;
    END

    -- RONDA "integridad de estados activos" — punto 2(a): no permitir
    -- desactivar (transicion real 1 -> 0) un canal utilizado por una senal
    -- activa. No se desasigna la senal automaticamente: se rechaza la
    -- operacion para que el usuario resuelva el conexionado primero.
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.senal s ON s.canal_id = i.id AND s.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51018, 'No se puede desactivar un CANAL utilizado por una senal activa.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.3 TR_tramo_conexion_validar_secuencia
--     Secuencia consecutiva, continuidad fisica, origen = dueño real de la
--     senal, destino final valido (RIO/MODULO, nunca CAJA). Evaluado por
--     ruta_conexion_id afectada (inserted + deleted), multi-row.
--     FIX #1: una CTE solo tiene alcance sobre la UNICA sentencia que la
--     sigue — no es valido encadenar ";WITH ... IF EXISTS" ni reutilizar la
--     misma CTE en varios IF. El conjunto "activos" se materializa una sola
--     vez en una tabla variable (@activos) y se reutiliza en las 6
--     validaciones sin recalcular las funciones de ventana cada vez.
--     Punto 4: un tramo activo solo puede usar PUNTO_CONEXION origen/destino
--     activos y un PAR_CONDUCTOR cuyo CABLE este activo.
--     Punto 6: un nodo intermedio (todo tramo que no es el ultimo) debe
--     corresponder a CAJA — la estructura permitida es
--     INSTRUMENTO/EQUIPO -> 0..N CAJAS -> RIO/MODULO.
--     RONDA "integridad de estados activos" — punto 4(b): un TRAMO_CONEXION
--     activo requiere que su RUTA_CONEXION padre este activa.
--
--     LIMITACION DOCUMENTADA (punto 6 de esa misma ronda, sin cambio de
--     modelo): este trigger valida el conjunto ACTIVO completo de una ruta
--     despues de CADA sentencia individual, no al final de la transaccion.
--     Por eso, una ruta de varios tramos (ej. INSTRUMENTO -> CAJA -> RIO) NO
--     debe construirse/editarse con sentencias separadas — ni siquiera
--     dentro de la misma transaccion — porque el estado intermedio (solo
--     "INSTRUMENTO -> CAJA" insertado) seria rechazado por la validacion de
--     destino final (51007: el ultimo tramo activo terminaria en CAJA, no en
--     RIO/MODULO). El futuro backend/aplicacion debe crear o modificar TODOS
--     los tramos afectados de una ruta en UNA sola sentencia INSERT/UPDATE
--     multi-fila (o MERGE). No se introduce un estado DRAFT para resolver
--     esto en esta etapa — queda como requisito operativo del backend.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_tramo_conexion_validar_secuencia ON nucleo.tramo_conexion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rutas TABLE (ruta_conexion_id BIGINT PRIMARY KEY);
    INSERT INTO @rutas
        SELECT DISTINCT ruta_conexion_id FROM inserted
        UNION
        SELECT DISTINCT ruta_conexion_id FROM deleted;

    IF NOT EXISTS (SELECT 1 FROM @rutas) RETURN;

    DECLARE @activos TABLE (
        tramo_id            BIGINT PRIMARY KEY,
        ruta_conexion_id    BIGINT   NOT NULL,
        numero_orden        SMALLINT NOT NULL,
        punto_origen_id     BIGINT   NOT NULL,
        punto_destino_id    BIGINT   NOT NULL,
        par_conductor_id    BIGINT   NOT NULL,
        rn                  BIGINT   NOT NULL,
        total               INT      NOT NULL,
        siguiente_origen    BIGINT   NULL
    );

    INSERT INTO @activos (tramo_id, ruta_conexion_id, numero_orden, punto_origen_id, punto_destino_id, par_conductor_id, rn, total, siguiente_origen)
    SELECT t.id, t.ruta_conexion_id, t.numero_orden, t.punto_origen_id, t.punto_destino_id, t.par_conductor_id,
           ROW_NUMBER() OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden),
           COUNT(*)     OVER (PARTITION BY t.ruta_conexion_id),
           LEAD(t.punto_origen_id) OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden)
    FROM nucleo.tramo_conexion t
    WHERE t.activo = 1 AND t.ruta_conexion_id IN (SELECT ruta_conexion_id FROM @rutas);

    IF EXISTS (SELECT 1 FROM @activos WHERE numero_orden <> rn)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51004, 'numero_orden no es consecutivo dentro de la ruta.', 1;
    END

    IF EXISTS (SELECT 1 FROM @activos WHERE rn < total AND punto_destino_id <> siguiente_origen)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51005, 'El destino de un tramo no coincide con el origen del siguiente.', 1;
    END

    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        JOIN nucleo.senal s ON s.id = r.senal_id
        JOIN nucleo.punto_conexion p ON p.id = a.punto_origen_id
        WHERE a.rn = 1
          AND ((s.instrumento_id IS NOT NULL AND ISNULL(p.instrumento_id, -1) <> s.instrumento_id)
            OR (s.equipo_id      IS NOT NULL AND ISNULL(p.equipo_id, -1)      <> s.equipo_id))
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51006, 'El origen del primer tramo no corresponde al dueño real de la senal.', 1;
    END

    IF EXISTS (
        SELECT 1 FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn = a.total AND p.rio_id IS NULL AND p.modulo_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51007, 'El ultimo tramo no termina en un punto de RIO o MODULO.', 1;
    END

    -- Punto 4: recursos usados por un tramo activo deben estar activos
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion po ON po.id = a.punto_origen_id
        JOIN nucleo.punto_conexion pd ON pd.id = a.punto_destino_id
        JOIN nucleo.par_conductor pc ON pc.id = a.par_conductor_id
        JOIN nucleo.cable cb ON cb.id = pc.cable_id
        WHERE po.activo = 0 OR pd.activo = 0 OR cb.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51015, 'Un tramo activo no puede usar puntos de conexion o cable inactivos.', 1;
    END

    -- Punto 6: un nodo intermedio (no es el ultimo tramo) debe ser CAJA
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn < a.total AND p.caja_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'Un nodo intermedio de la ruta debe corresponder a una CAJA.', 1;
    END

    -- Punto 4(b): un tramo activo requiere que su ruta padre este activa
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        WHERE r.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51023, 'Un TRAMO_CONEXION activo requiere una RUTA_CONEXION activa.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.4 TR_ruta_conexion_desactivar_tramos
--     Cascada de desactivacion: solo para filas que hicieron la TRANSICION
--     real activo=1 -> activo=0 (no basta con que 'activo' participara en
--     el UPDATE). Nunca DELETE.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_ruta_conexion_desactivar_tramos ON nucleo.ruta_conexion
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    UPDATE tc SET tc.activo = 0
    FROM nucleo.tramo_conexion tc
    JOIN inserted i ON i.id = tc.ruta_conexion_id
    JOIN deleted  d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0   -- transicion real 1 -> 0, no solo "participó"
      AND tc.activo = 1;
END
GO

-- -----------------------------------------------------------------------------
-- 7.4b TR_senal_desactivar_ruta  (NUEVO)
--     Cascada SEÑAL -> RUTA_CONEXION: cuando una senal hace la TRANSICION
--     real activo 1 -> 0, desactiva su RUTA_CONEXION activa (si existe).
--     Esa misma UPDATE dispara (trigger anidado, habilitado por defecto en
--     SQL Server) TR_ruta_conexion_desactivar_tramos, que a su vez desactiva
--     sus TRAMO_CONEXION; el PAR_CONDUCTOR queda libre solo por efecto de
--     los indices unicos filtrados (WHERE activo = 1) — sin accion adicional.
--     Nunca DELETE. La reactivacion de la senal (0 -> 1) NO dispara nada
--     aqui (el WHERE exige la transicion 1 -> 0 exacta) — la ruta historica
--     no se restaura automaticamente, igual que ya ocurre un nivel mas abajo.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_senal_desactivar_ruta ON nucleo.senal
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    UPDATE rc SET rc.activo = 0
    FROM nucleo.ruta_conexion rc
    JOIN inserted i ON i.id = rc.senal_id
    JOIN deleted  d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0   -- transicion real 1 -> 0
      AND rc.activo = 1;
END
GO

-- -----------------------------------------------------------------------------
-- 7.5 TR_senal_validar_clase
--     Exclusion CONTROL/COM contra el codigo real del catalogo. Solo actua
--     si alguna de las columnas relevantes participo en la sentencia.
--     FIX #4: agrega la direccion que faltaba — una senal NO puede quedar
--     clasificada COM mientras tenga una RUTA_CONEXION activa (protege el
--     caso CONTROL -> COM con ruta ya existente; el caso inverso, crear/
--     reactivar una ruta para una senal ya COM, lo protege
--     TR_ruta_conexion_validar_clase_senal). No exige ENLACE_COM — una
--     senal COM sigue pudiendo existir sin enlace todavia.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_senal_validar_clase ON nucleo.senal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(clase_senal_id) OR UPDATE(tipo_io_id) OR UPDATE(canal_id) OR UPDATE(direccion_com_id)) RETURN;

    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE c.codigo = N'COM' AND (i.tipo_io_id IS NOT NULL OR i.canal_id IS NOT NULL)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51008, 'Una senal COM no puede tener tipo_io_id ni canal_id.', 1;
    END

    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE c.codigo = N'CONTROL' AND i.direccion_com_id IS NOT NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51009, 'Una senal CONTROL no puede tener direccion_com_id.', 1;
    END

    -- RONDA "integridad de estados activos" — punto 5: se agrega "i.activo = 1"
    -- para que esta prohibicion dependa UNICAMENTE del estado final de la
    -- propia fila, nunca del orden de ejecucion frente a
    -- TR_senal_desactivar_ruta (otro trigger AFTER UPDATE sobre la misma
    -- tabla). Si en la misma sentencia la senal queda activo=0 Y cambia a
    -- COM, esta regla ya no aplica (la senal se esta desactivando, no
    -- "quedando" COM con ruta activa) — sin necesitar sp_settriggerorder.
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE i.activo = 1
          AND c.codigo = N'COM'
          AND EXISTS (
              SELECT 1 FROM nucleo.ruta_conexion r
              WHERE r.senal_id = i.id AND r.activo = 1
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51013, 'No se puede clasificar como COM una senal con RUTA_CONEXION activa.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.6 TR_ruta_conexion_validar_clase_senal
--     Impide una RUTA_CONEXION activa para una senal COM, y ahora tambien
--     (punto 4a) exige que la senal referenciada este ACTIVA — una ruta
--     activa siempre requiere una senal activa y de clase CONTROL.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_ruta_conexion_validar_clase_senal ON nucleo.ruta_conexion
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(senal_id) OR UPDATE(activo)) RETURN;

    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN nucleo.senal s ON s.id = i.senal_id
        JOIN cat.cat_clase_senal c ON c.id = s.clase_senal_id
        WHERE i.activo = 1 AND c.codigo = N'COM'
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51010, 'No puede existir una RUTA_CONEXION activa para una senal COM.', 1;
    END

    -- Punto 4(a): una RUTA_CONEXION activa requiere una SEÑAL activa
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN nucleo.senal s ON s.id = i.senal_id
        WHERE i.activo = 1 AND s.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51022, 'Una RUTA_CONEXION activa requiere una SEÑAL activa.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.7 TR_senal_validar_canal_ruta
--     Coherencia del lado SEÑAL con su recurso fisico. Tres validaciones:
--     (a) canal/ruta: el canal asignado debe coincidir en RIO/modulo con el
--         destino fisico de la ruta activa (ya existia);
--     (b) punto 3: una senal ACTIVA con canal_id exige canal.activo = 1 y
--         modulo.activo = 1 (canal y su modulo deben estar vigentes);
--     (c) punto 5: si cambia el dueño (instrumento_id/equipo_id) de una
--         senal con ruta activa, el primer PUNTO_CONEXION de esa ruta debe
--         corresponder EXACTAMENTE al nuevo dueño — si no, se rechaza.
--     FIX #1: ";WITH ... IF EXISTS" es sintaxis invalida — la CTE solo
--     alcanza a la sentencia que la sigue. Los conjuntos se materializan en
--     tablas variable antes de cada IF EXISTS.
--     RONDA "integridad de estados activos" — punto 1: el trigger ahora
--     tambien se dispara en INSERT (antes solo AFTER UPDATE), para que no se
--     pueda CREAR directamente una senal activa con canal_id apuntando a un
--     CANAL/MODULO inactivo, o con una ruta cuyo destino no coincida.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_senal_validar_canal_ruta ON nucleo.senal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(canal_id) OR UPDATE(activo) OR UPDATE(instrumento_id) OR UPDATE(equipo_id)) RETURN;

    -- (a) + (b): fila NUEVA (INSERT, sin equivalente en deleted), o canal_id
    -- cambio de valor de verdad, o la senal se reactivo (0 -> 1) conservando
    -- un canal_id ya asignado — en los tres casos hay que revalidar canal/ruta.
    DECLARE @cambios TABLE (senal_id BIGINT PRIMARY KEY, canal_id BIGINT NULL);
    INSERT INTO @cambios (senal_id, canal_id)
    SELECT i.id, i.canal_id
    FROM inserted i
    LEFT JOIN deleted d ON d.id = i.id
    WHERE i.activo = 1
      AND i.canal_id IS NOT NULL
      AND ( d.id IS NULL                                       -- fila nueva (INSERT)
         OR ISNULL(i.canal_id, -1) <> ISNULL(d.canal_id, -1)    -- canal_id cambio de valor de verdad
         OR (d.activo = 0 AND i.activo = 1) );                  -- o la senal se reactivo (0 -> 1)

    IF EXISTS (SELECT 1 FROM @cambios)
    BEGIN
        -- Punto 3: canal y su modulo deben estar activos
        IF EXISTS (
            SELECT 1
            FROM @cambios c
            JOIN nucleo.canal ch ON ch.id = c.canal_id
            JOIN nucleo.modulo m ON m.id = ch.modulo_id
            WHERE ch.activo = 0 OR m.activo = 0
        )
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51014, 'Una senal activa no puede usar un CANAL o MODULO inactivo.', 1;
        END

        DECLARE @ultimo TABLE (senal_id BIGINT PRIMARY KEY, punto_destino_id BIGINT NOT NULL);
        INSERT INTO @ultimo (senal_id, punto_destino_id)
        SELECT x.senal_id, x.punto_destino_id
        FROM (
            SELECT r.senal_id, t.punto_destino_id,
                   ROW_NUMBER() OVER (PARTITION BY r.senal_id ORDER BY t.numero_orden DESC) AS rn
            FROM @cambios c
            JOIN nucleo.ruta_conexion r ON r.senal_id = c.senal_id AND r.activo = 1
            JOIN nucleo.tramo_conexion t ON t.ruta_conexion_id = r.id AND t.activo = 1
        ) x
        WHERE x.rn = 1;

        IF EXISTS (
            SELECT 1
            FROM @cambios c
            JOIN @ultimo u ON u.senal_id = c.senal_id
            JOIN nucleo.punto_conexion pd ON pd.id = u.punto_destino_id
            JOIN nucleo.canal ch ON ch.id = c.canal_id
            WHERE (pd.modulo_id IS NOT NULL AND pd.modulo_id <> ch.modulo_id)
               OR (pd.rio_id IS NOT NULL AND pd.rio_id <> (
                      SELECT rk.rio_id
                      FROM nucleo.modulo m2
                      JOIN nucleo.slot sl2 ON sl2.id = m2.slot_id
                      JOIN nucleo.rack rk  ON rk.id = sl2.rack_id
                      WHERE m2.id = ch.modulo_id
                   ))
        )
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51011, 'El canal asignado no coincide con el RIO/modulo del destino fisico de la ruta.', 1;
        END
    END

    -- (c) Punto 5: cambio de dueño con ruta activa
    DECLARE @cambios_dueno TABLE (senal_id BIGINT PRIMARY KEY, instrumento_id BIGINT NULL, equipo_id BIGINT NULL);
    INSERT INTO @cambios_dueno (senal_id, instrumento_id, equipo_id)
    SELECT i.id, i.instrumento_id, i.equipo_id
    FROM inserted i
    JOIN deleted d ON d.id = i.id
    WHERE i.activo = 1
      AND ( ISNULL(i.instrumento_id, -1) <> ISNULL(d.instrumento_id, -1)
         OR ISNULL(i.equipo_id, -1)      <> ISNULL(d.equipo_id, -1) );

    IF EXISTS (
        SELECT 1
        FROM @cambios_dueno cd
        JOIN nucleo.ruta_conexion r ON r.senal_id = cd.senal_id AND r.activo = 1
        JOIN nucleo.tramo_conexion t ON t.ruta_conexion_id = r.id AND t.activo = 1 AND t.numero_orden = 1
        JOIN nucleo.punto_conexion p ON p.id = t.punto_origen_id
        WHERE (cd.instrumento_id IS NOT NULL AND ISNULL(p.instrumento_id, -1) <> cd.instrumento_id)
           OR (cd.equipo_id      IS NOT NULL AND ISNULL(p.equipo_id, -1)      <> cd.equipo_id)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51016, 'No se puede cambiar el dueño de una senal con ruta activa cuyo primer punto no corresponda al nuevo dueño.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.8 TR_tramo_conexion_validar_canal_ruta
--     Lado "cambia la ruta" de la misma coherencia canal <-> ruta.
--     FIX #1: ";WITH ... IF EXISTS" es sintaxis invalida — "ultimo" se
--     materializa en tabla variable antes del IF EXISTS.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_tramo_conexion_validar_canal_ruta ON nucleo.tramo_conexion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rutas TABLE (ruta_conexion_id BIGINT PRIMARY KEY);
    INSERT INTO @rutas
        SELECT DISTINCT ruta_conexion_id FROM inserted
        UNION
        SELECT DISTINCT ruta_conexion_id FROM deleted;

    IF NOT EXISTS (SELECT 1 FROM @rutas) RETURN;

    DECLARE @ultimo TABLE (ruta_conexion_id BIGINT PRIMARY KEY, punto_destino_id BIGINT NOT NULL);
    INSERT INTO @ultimo (ruta_conexion_id, punto_destino_id)
    SELECT x.ruta_conexion_id, x.punto_destino_id
    FROM (
        SELECT t.ruta_conexion_id, t.punto_destino_id,
               ROW_NUMBER() OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden DESC) AS rn
        FROM nucleo.tramo_conexion t
        WHERE t.activo = 1 AND t.ruta_conexion_id IN (SELECT ruta_conexion_id FROM @rutas)
    ) x
    WHERE x.rn = 1;

    IF EXISTS (
        SELECT 1
        FROM @ultimo u
        JOIN nucleo.ruta_conexion r ON r.id = u.ruta_conexion_id AND r.activo = 1
        JOIN nucleo.senal s  ON s.id = r.senal_id AND s.canal_id IS NOT NULL
        JOIN nucleo.canal ch ON ch.id = s.canal_id
        JOIN nucleo.punto_conexion pd ON pd.id = u.punto_destino_id
        LEFT JOIN nucleo.modulo m2 ON m2.id = ch.modulo_id
        LEFT JOIN nucleo.slot  sl2 ON sl2.id = m2.slot_id
        LEFT JOIN nucleo.rack  rk  ON rk.id = sl2.rack_id
        WHERE (pd.modulo_id IS NOT NULL AND pd.modulo_id <> ch.modulo_id)
           OR (pd.rio_id    IS NOT NULL AND pd.rio_id    <> rk.rio_id)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51012, 'El destino fisico de la ruta no coincide con el RIO/modulo del canal asignado.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.9 TR_punto_conexion_validar_desactivacion  (NUEVO)
--     RONDA "integridad de estados activos" — punto 3: proteccion inversa.
--     No permite desactivar (transicion real 1 -> 0) un PUNTO_CONEXION que
--     un TRAMO_CONEXION activo este usando como origen o destino. No se
--     desactiva ninguna ruta automaticamente desde aqui — se rechaza la
--     operacion para que el usuario resuelva el conexionado primero.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_punto_conexion_validar_desactivacion ON nucleo.punto_conexion
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.tramo_conexion t
             ON (t.punto_origen_id = i.id OR t.punto_destino_id = i.id) AND t.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51020, 'No se puede desactivar un PUNTO_CONEXION utilizado por un TRAMO_CONEXION activo.', 1;
    END
END
GO

-- -----------------------------------------------------------------------------
-- 7.10 TR_cable_validar_desactivacion  (NUEVO)
--     RONDA "integridad de estados activos" — punto 3: proteccion inversa.
--     No permite desactivar (transicion real 1 -> 0) un CABLE si alguno de
--     sus PAR_CONDUCTOR participa en un TRAMO_CONEXION activo. No se
--     desactiva ninguna ruta automaticamente — se rechaza la operacion.
-- -----------------------------------------------------------------------------
CREATE TRIGGER nucleo.TR_cable_validar_desactivacion ON nucleo.cable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.par_conductor pc ON pc.cable_id = i.id
        JOIN nucleo.tramo_conexion t ON t.par_conductor_id = pc.id AND t.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51021, 'No se puede desactivar un CABLE cuyo PAR_CONDUCTOR participa en un TRAMO_CONEXION activo.', 1;
    END
END
GO

/* =============================================================================
   FIN de 001_initial_schema.sql
============================================================================= */
