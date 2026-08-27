/* =============================================================================
   006_entregables_base.sql — SIEI
   Primer módulo real de Entregables: Listado de Instrumentos (LDI).

   Aprobado por el usuario tras dos rondas de diseño (diagnóstico + ajuste
   final). Resumen de las decisiones de negocio que esta migración
   implementa:

   - Filosofía de 3 capas: MASTER DE INSTRUMENTOS (nucleo.instrumento, ya
     existente) -> ENTREGABLE (documento controlado, numeración propia) ->
     REVISION_ENTREGABLE (snapshot histórico congelado, nunca se relee el
     master). Ver docs/MODELO_CONCEPTUAL_SIEI.md, que explícitamente dejó
     esto fuera de alcance hasta ahora.
   - `nucleo.proyecto.codigo_proyecto` NO se reutiliza para el "Proyecto
     CUMBRA" de carátula — son conceptos distintos, el segundo vive en
     `proyecto_documentacion.codigo_proyecto_cumbra`.
   - La letra de disciplina documental (ej. "J") NO es propiedad universal
     de un tipo de entregable — depende del proyecto/cliente, por eso vive
     como componente congelado en `entregable`, no en `cat_tipo_entregable`.
   - `numero_documento` único por proyecto; además protegido por unicidad
     de sus componentes (etapa+tipo+area+disciplina+correlativo) para
     evitar reutilización accidental de esa combinación.
   - Revisión con 3 estados: BORRADOR (editable, previsualizable) ->
     EMITIDA (inmutable) | DESCARTADA (solo lectura, ya no emitible).
     Ninguna transición sale de EMITIDA ni de DESCARTADA.
   - Plantilla (.xlsm/.xlsx) por proyecto+tipo de entregable, almacenada en
     VARBINARY(MAX). Nunca se edita in-place: reemplazar es INSERT nuevo +
     desactivar el anterior. Revisiones ya emitidas siguen apuntando a la
     plantilla exacta (aunque esté `activo = 0`) que usaron.
   - El .xlsx final de una revisión EMITIDA se almacena completo
     (VARBINARY(MAX) + SHA-256) — la descarga histórica nunca regenera,
     entrega el binario real.
   - Snapshot de fila en JSON (mismo patrón que
     integracion.importacion_pnid_fila, migración 004) — genérico para
     cualquier tipo de entregable futuro, no ata el esquema a las 20
     columnas específicas del LDI.
   - Orden de instrumentos asociados: catálogo global
     `cat.cat_orden_tipo_instrumento` (prefijo -> valor), preset inicial de
     Instrumentación, evolucionable a futuro (ver comentario en la tabla).

   ALCANCE
   -------
   Solo tablas/catálogos/triggers nuevos. No se toca 001-005.
============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO


/* ============================================================================
   0. VERIFICACIÓN DE PRECONDICIÓN

   006 depende de 005 (nucleo.instrumento.instrumento_asociado_id, usado por
   el criterio de orden "orden_instrumentos_asociados") y transitivamente de
   001-004 (nucleo.proyecto, nucleo.instrumento, seguridad.usuario).
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'instrumento' AND c.name = N'instrumento_asociado_id'
)
BEGIN
    THROW 56001,
    'La migracion 006 requiere que 005_instrumento_asociado.sql se haya aplicado antes (falta nucleo.instrumento.instrumento_asociado_id).',
    1;
END
GO


/* ============================================================================
   1. CATÁLOGOS GLOBALES (schema cat)
   ============================================================================ */

CREATE TABLE cat.cat_tipo_entregable (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(20)         NOT NULL,   -- 'LDI'
    descripcion     NVARCHAR(200)        NOT NULL,   -- 'LISTADO DE INSTRUMENTOS'
    disciplina      NVARCHAR(100)        NOT NULL,   -- 'Instrumentación' — conceptual, NO la letra documental (esa vive en entregable.componente_disciplina)
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_entregable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_entregable PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_entregable_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_entregable (codigo, descripcion, disciplina)
VALUES (N'LDI', N'LISTADO DE INSTRUMENTOS', N'Instrumentación');
GO


/*
   cat.cat_orden_tipo_instrumento — preset inicial de Instrumentación para
   el criterio de ordenamiento "orden_instrumentos_asociados" (prefijo de
   TAG -> valor numérico de orden). NO se asume universal ni inmutable para
   todo proyecto futuro: si algún día hace falta que un proyecto distinto
   tenga su propio preset, la evolución aditiva natural es agregar una
   columna `proyecto_id NULL` (NULL = default global) y ajustar el índice
   único a (proyecto_id, prefijo) — no hace falta rediseñar la tabla, solo
   extenderla. Por ahora es un catálogo global, igual convención que el
   resto de `cat.*` (sin `activo`, gestión por migración).
*/
CREATE TABLE cat.cat_orden_tipo_instrumento (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    prefijo         NVARCHAR(10)         NOT NULL,
    orden           INT                  NOT NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_orden_tipo_instrumento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_orden_tipo_instrumento PRIMARY KEY (id),
    CONSTRAINT UQ_cat_orden_tipo_instrumento_prefijo UNIQUE (prefijo)
);
GO

INSERT INTO cat.cat_orden_tipo_instrumento (prefijo, orden) VALUES
    (N'LIT', 10), (N'LI', 11),
    (N'HV', 20), (N'HY', 21), (N'HYC', 21), (N'HYO', 22), (N'ZSC', 23), (N'ZSO', 24),
    (N'VIT', 30), (N'VT', 31), (N'TIT', 32), (N'TT', 33), (N'TE', 34),
    (N'LV', 40), (N'PV', 40), (N'FE', 40), (N'LY', 41), (N'PY', 41), (N'FIT', 41),
    (N'ZT', 42);
GO


/* ============================================================================
   2. nucleo.proyecto_documentacion — metadatos de carátula, 1:1 con proyecto
   ============================================================================ */

CREATE TABLE nucleo.proyecto_documentacion (
    id                                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                         BIGINT               NOT NULL,

    codigo_proyecto_cumbra              NVARCHAR(50)         NULL,
    codigo_proyecto_cliente             NVARCHAR(50)         NULL,
    titulo_caratula                     NVARCHAR(400)        NULL,
    etapa_codigo                        NVARCHAR(20)         NULL,
    etapa_nombre                        NVARCHAR(200)        NULL,
    afe                                 NVARCHAR(50)         NULL,
    vp                                  NVARCHAR(200)        NULL,
    jefe_disciplina                     NVARCHAR(200)        NULL,
    lider_proyecto                      NVARCHAR(200)        NULL,
    gerente_ingenieria_construccion     NVARCHAR(200)        NULL,
    iniciales_por_default               NVARCHAR(20)         NULL,
    iniciales_revisado_default          NVARCHAR(20)         NULL,
    iniciales_aprobado_default          NVARCHAR(20)         NULL,

    created_at      DATETIME2 NOT NULL CONSTRAINT DF_proyecto_documentacion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NULL,
    created_by      BIGINT    NULL,
    updated_by      BIGINT    NULL,

    CONSTRAINT PK_proyecto_documentacion PRIMARY KEY (id),
    CONSTRAINT UQ_proyecto_documentacion_proyecto UNIQUE (proyecto_id),
    CONSTRAINT FK_proyecto_documentacion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_proyecto_documentacion_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_proyecto_documentacion_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


/* ============================================================================
   3. nucleo.plantilla_entregable
   ============================================================================ */

CREATE TABLE nucleo.plantilla_entregable (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    tipo_entregable_id  BIGINT               NOT NULL,

    nombre_archivo      NVARCHAR(260)        NOT NULL,
    archivo_blob        VARBINARY(MAX)       NOT NULL,
    archivo_hash        CHAR(64)             NOT NULL,
    tamanio_bytes        BIGINT               NOT NULL,

    activo              BIT                  NOT NULL CONSTRAINT DF_plantilla_entregable_activo DEFAULT (1),

    created_at      DATETIME2 NOT NULL CONSTRAINT DF_plantilla_entregable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NULL,
    created_by      BIGINT    NULL,
    updated_by      BIGINT    NULL,

    CONSTRAINT PK_plantilla_entregable PRIMARY KEY (id),
    CONSTRAINT UQ_plantilla_entregable_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_plantilla_entregable_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_plantilla_entregable_tipo FOREIGN KEY (tipo_entregable_id) REFERENCES cat.cat_tipo_entregable (id),
    CONSTRAINT FK_plantilla_entregable_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_plantilla_entregable_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Una sola plantilla ACTIVA por proyecto+tipo; las históricas (activo=0)
-- pueden acumularse sin límite — nunca se borran.
CREATE UNIQUE INDEX UX_plantilla_entregable_activa
    ON nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id)
    WHERE activo = 1;
GO

/*
   TR_plantilla_entregable_blob_inmutable
   El binario de una plantilla NUNCA se edita in-place, la haya usado ya
   una revisión EMITIDA o no — reemplazar siempre es INSERT de una fila
   nueva + desactivar la anterior (UPDATE de `activo` sigue permitido).
*/
CREATE TRIGGER nucleo.TR_plantilla_entregable_blob_inmutable ON nucleo.plantilla_entregable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(archivo_blob) OR UPDATE(archivo_hash) OR UPDATE(nombre_archivo) OR UPDATE(tamanio_bytes)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 56010, 'El archivo de una plantilla no se puede editar; suba una plantilla nueva (INSERT) y desactive la anterior.', 1;
    END
END
GO


/* ============================================================================
   4. nucleo.configuracion_orden
   ============================================================================ */

CREATE TABLE nucleo.configuracion_orden (
    id                    BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id           BIGINT               NOT NULL,
    tipo_entregable_id    BIGINT               NULL,

    nombre                NVARCHAR(200)        NOT NULL,
    criterios_json        NVARCHAR(MAX)        NOT NULL,
    es_default            BIT                  NOT NULL CONSTRAINT DF_configuracion_orden_default DEFAULT (0),
    activo                BIT                  NOT NULL CONSTRAINT DF_configuracion_orden_activo DEFAULT (1),

    created_at      DATETIME2 NOT NULL CONSTRAINT DF_configuracion_orden_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NULL,
    created_by      BIGINT    NULL,
    updated_by      BIGINT    NULL,

    CONSTRAINT PK_configuracion_orden PRIMARY KEY (id),
    CONSTRAINT UQ_configuracion_orden_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_configuracion_orden_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_configuracion_orden_tipo FOREIGN KEY (tipo_entregable_id) REFERENCES cat.cat_tipo_entregable (id),
    CONSTRAINT FK_configuracion_orden_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_configuracion_orden_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT CK_configuracion_orden_json CHECK (ISJSON(criterios_json) = 1)
);
GO

-- Solo una config "default" activa por proyecto+tipo — la que se precarga
-- al preparar una revisión nueva.
CREATE UNIQUE INDEX UX_configuracion_orden_default
    ON nucleo.configuracion_orden (proyecto_id, tipo_entregable_id)
    WHERE es_default = 1 AND activo = 1;
GO


/* ============================================================================
   5. nucleo.entregable
   ============================================================================ */

CREATE TABLE nucleo.entregable (
    id                       BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id              BIGINT               NOT NULL,
    tipo_entregable_id       BIGINT               NOT NULL,

    numero_documento         NVARCHAR(200)        NOT NULL,

    -- Componentes del número, congelados en el momento de creación — si
    -- proyecto_documentacion cambia después, un entregable ya creado NUNCA
    -- recalcula su número.
    componente_etapa         NVARCHAR(20)         NULL,
    componente_proyecto      NVARCHAR(50)         NULL,
    componente_cliente       NVARCHAR(50)         NULL,
    componente_tipo          NVARCHAR(20)         NOT NULL,
    componente_area          NVARCHAR(20)         NULL,
    componente_disciplina    NVARCHAR(10)         NULL,
    componente_correlativo   NVARCHAR(20)         NOT NULL,

    titulo                   NVARCHAR(400)        NULL,

    activo                   BIT                  NOT NULL CONSTRAINT DF_entregable_activo DEFAULT (1),

    created_at      DATETIME2 NOT NULL CONSTRAINT DF_entregable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NULL,
    created_by      BIGINT    NULL,
    updated_by      BIGINT    NULL,

    CONSTRAINT PK_entregable PRIMARY KEY (id),
    CONSTRAINT UQ_entregable_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT UQ_entregable_numero_documento UNIQUE (proyecto_id, numero_documento),
    CONSTRAINT UQ_entregable_componentes UNIQUE (
        proyecto_id, componente_etapa, componente_tipo, componente_area,
        componente_disciplina, componente_correlativo
    ),
    CONSTRAINT FK_entregable_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_entregable_tipo FOREIGN KEY (tipo_entregable_id) REFERENCES cat.cat_tipo_entregable (id),
    CONSTRAINT FK_entregable_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_entregable_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


/* ============================================================================
   6. nucleo.revision_entregable
   ============================================================================ */

CREATE TABLE nucleo.revision_entregable (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    entregable_id               BIGINT               NOT NULL,

    codigo_revision              NVARCHAR(10)         NOT NULL,
    fecha                        DATE                 NOT NULL CONSTRAINT DF_revision_entregable_fecha DEFAULT (CAST(SYSUTCDATETIME() AS DATE)),
    descripcion                  NVARCHAR(400)        NOT NULL,
    iniciales_por                NVARCHAR(20)         NOT NULL,
    iniciales_revisado           NVARCHAR(20)         NOT NULL,
    iniciales_aprobado           NVARCHAR(20)         NOT NULL,

    estado                       NVARCHAR(20)         NOT NULL,

    -- Congelado en el momento de generar el preview (BORRADOR) — nunca se
    -- recalcula después, ni siquiera mientras sigue en BORRADOR salvo que
    -- el usuario pida explícitamente regenerar el preview.
    configuracion_orden_id       BIGINT               NULL,
    criterios_aplicados_json     NVARCHAR(MAX)        NULL,
    metadatos_snapshot_json      NVARCHAR(MAX)        NULL,
    plantilla_id                 BIGINT               NULL,
    archivo_id                   BIGINT               NULL,

    emitida_by                   BIGINT               NULL,
    emitida_at                   DATETIME2            NULL,
    descartada_by                BIGINT               NULL,
    descartada_at                DATETIME2            NULL,

    created_at      DATETIME2 NOT NULL CONSTRAINT DF_revision_entregable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NULL,
    created_by      BIGINT    NULL,
    updated_by      BIGINT    NULL,

    CONSTRAINT PK_revision_entregable PRIMARY KEY (id),
    CONSTRAINT UQ_revision_entregable_id_proyecto UNIQUE (id, proyecto_id),

    CONSTRAINT FK_revision_entregable_entregable FOREIGN KEY (entregable_id, proyecto_id) REFERENCES nucleo.entregable (id, proyecto_id),
    CONSTRAINT FK_revision_entregable_config_orden FOREIGN KEY (configuracion_orden_id, proyecto_id) REFERENCES nucleo.configuracion_orden (id, proyecto_id),
    CONSTRAINT FK_revision_entregable_plantilla FOREIGN KEY (plantilla_id, proyecto_id) REFERENCES nucleo.plantilla_entregable (id, proyecto_id),
    CONSTRAINT FK_revision_entregable_emitida_by FOREIGN KEY (emitida_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_revision_entregable_descartada_by FOREIGN KEY (descartada_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_revision_entregable_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_revision_entregable_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id),

    CONSTRAINT CK_revision_entregable_estado CHECK (estado IN (N'BORRADOR', N'EMITIDA', N'DESCARTADA')),
    CONSTRAINT CK_revision_entregable_json CHECK (
        (criterios_aplicados_json IS NULL OR ISJSON(criterios_aplicados_json) = 1)
        AND (metadatos_snapshot_json IS NULL OR ISJSON(metadatos_snapshot_json) = 1)
    ),
    -- Una revisión EMITIDA debe tener todo lo que la hace reproducible e
    -- inmutable; una DESCARTADA o BORRADOR no lo necesitan.
    CONSTRAINT CK_revision_entregable_emitida_completa CHECK (
        estado <> N'EMITIDA'
        OR (
            criterios_aplicados_json IS NOT NULL
            AND metadatos_snapshot_json IS NOT NULL
            AND plantilla_id IS NOT NULL
            AND archivo_id IS NOT NULL
            AND emitida_by IS NOT NULL
            AND emitida_at IS NOT NULL
        )
    )
);
GO

-- Un código de revisión ("A", "B", "0"...) no se puede repetir DOS VECES
-- EMITIDO para el mismo entregable — mientras está en BORRADOR el usuario
-- puede probar/cambiar el código libremente.
CREATE UNIQUE INDEX UX_revision_entregable_codigo_emitida
    ON nucleo.revision_entregable (entregable_id, codigo_revision)
    WHERE estado = N'EMITIDA';
GO

-- A lo sumo un BORRADOR abierto por entregable a la vez.
CREATE UNIQUE INDEX UX_revision_entregable_borrador_unico
    ON nucleo.revision_entregable (entregable_id)
    WHERE estado = N'BORRADOR';
GO

/*
   TR_revision_entregable_estado_final_inmutable
   Ninguna transición sale de EMITIDA ni de DESCARTADA — ambos son estados
   finales. Cubre tanto "editar contenido" como "intentar cambiar de
   estado de nuevo": si la fila YA estaba en uno de los dos antes del
   UPDATE, se rechaza cualquier UPDATE sobre ella, sin excepción.
*/
CREATE TRIGGER nucleo.TR_revision_entregable_estado_final_inmutable ON nucleo.revision_entregable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM deleted WHERE estado IN (N'EMITIDA', N'DESCARTADA'))
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 56011, 'Una revision EMITIDA o DESCARTADA es un estado final: no admite ninguna modificacion.', 1;
    END
END
GO


/* ============================================================================
   7. nucleo.revision_entregable_fila — snapshot congelado, una fila por
      instrumento incluido en la revisión.
   ============================================================================ */

CREATE TABLE nucleo.revision_entregable_fila (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT               NOT NULL,
    revision_id       BIGINT               NOT NULL,
    instrumento_id    BIGINT               NOT NULL,

    item              INT                  NOT NULL,
    datos_snapshot    NVARCHAR(MAX)        NOT NULL,

    created_at        DATETIME2            NOT NULL CONSTRAINT DF_revision_entregable_fila_created_at DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_revision_entregable_fila PRIMARY KEY (id),
    CONSTRAINT UQ_revision_entregable_fila_item UNIQUE (revision_id, item),
    CONSTRAINT UQ_revision_entregable_fila_instrumento UNIQUE (revision_id, instrumento_id),
    CONSTRAINT FK_revision_entregable_fila_revision FOREIGN KEY (revision_id, proyecto_id) REFERENCES nucleo.revision_entregable (id, proyecto_id),
    CONSTRAINT FK_revision_entregable_fila_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT CK_revision_entregable_fila_json CHECK (ISJSON(datos_snapshot) = 1)
);
GO

CREATE INDEX IX_revision_entregable_fila_revision
    ON nucleo.revision_entregable_fila (revision_id);
GO

/*
   TR_revision_entregable_fila_estado_final_inmutable
   Refuerza la inmutabilidad desde el lado del hijo: aunque alguien intente
   tocar revision_entregable_fila directamente (sin pasar por el padre),
   se rechaza si la revisión dueña ya es EMITIDA o DESCARTADA.
*/
CREATE TRIGGER nucleo.TR_revision_entregable_fila_estado_final_inmutable ON nucleo.revision_entregable_fila
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT revision_id FROM inserted
            UNION
            SELECT revision_id FROM deleted
        ) x
        JOIN nucleo.revision_entregable r ON r.id = x.revision_id
        WHERE r.estado IN (N'EMITIDA', N'DESCARTADA')
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 56012, 'No se puede modificar el snapshot de una revision EMITIDA o DESCARTADA.', 1;
    END
END
GO


/* ============================================================================
   8. nucleo.revision_entregable_archivo — el .xlsx real emitido
   ============================================================================ */

CREATE TABLE nucleo.revision_entregable_archivo (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT               NOT NULL,
    revision_id       BIGINT               NOT NULL,

    nombre_archivo    NVARCHAR(260)        NOT NULL,
    mime_type         NVARCHAR(150)        NOT NULL CONSTRAINT DF_revision_entregable_archivo_mime DEFAULT (N'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    archivo_blob      VARBINARY(MAX)       NOT NULL,
    archivo_hash      CHAR(64)             NOT NULL,
    tamanio_bytes      BIGINT               NOT NULL,

    created_at        DATETIME2            NOT NULL CONSTRAINT DF_revision_entregable_archivo_created_at DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_revision_entregable_archivo PRIMARY KEY (id),
    CONSTRAINT UQ_revision_entregable_archivo_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT UQ_revision_entregable_archivo_revision UNIQUE (revision_id),
    CONSTRAINT FK_revision_entregable_archivo_revision FOREIGN KEY (revision_id, proyecto_id) REFERENCES nucleo.revision_entregable (id, proyecto_id)
);
GO

-- Se agrega ahora que revision_entregable_archivo ya existe: la FK
-- (nullable) desde la cabecera de la revisión hacia su archivo real.
ALTER TABLE nucleo.revision_entregable
    ADD CONSTRAINT FK_revision_entregable_archivo
        FOREIGN KEY (archivo_id, proyecto_id) REFERENCES nucleo.revision_entregable_archivo (id, proyecto_id);
GO

/*
   TR_revision_entregable_archivo_inmutable
   El binario de un archivo emitido no se edita ni se reemplaza nunca —
   ninguna columna de esta tabla admite UPDATE. Si un archivo estuviera
   mal, la corrección es una revisión nueva, no editar la histórica.
*/
CREATE TRIGGER nucleo.TR_revision_entregable_archivo_inmutable ON nucleo.revision_entregable_archivo
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    ROLLBACK TRANSACTION;
    THROW 56013, 'El archivo de una revision emitida es inmutable; no admite ningun UPDATE.', 1;
END
GO
