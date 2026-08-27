/* =============================================================================
   004_pnid_import.sql — SIEI
   Importación real de instrumentos desde reporte P&ID / Plant 3D.

   OBJETIVO
   --------
   1. Agregar a nucleo.instrumento los campos de origen P&ID que hoy no
      existen (tag_anterior, tecnologia, funcionamiento, cuerpo_instrumento,
      conexion_proceso, plano_pnid, linea_pnid, tipo_senal_pnid, y la
      referencia — resuelta o solo textual — a Equipo Asociado).
   2. Crear el schema `integracion` con un módulo de persistencia para
      importaciones P&ID: snapshot completo de cada archivo cargado
      (auditable indefinidamente) separado de las conclusiones de comparar
      ese snapshot contra el estado actual de nucleo.instrumento.
   3. Extender cat.cat_estado_pnid con los 2 códigos que le faltan para
      cubrir el flujo de comparación PREVIEW/APPLY.

   DECISIONES DE NEGOCIO QUE ESTA MIGRACIÓN IMPLEMENTA (aprobadas
   explícitamente por el usuario; ver docs/MODELO_CONCEPTUAL_SIEI.md y
   docs/MATRIZ_COBERTURA_DATOS_SIEI.md, actualizados junto con esta
   migración para no dejar el diseño desactualizado en silencio):

   - TAG_ANTERIOR reemplaza la denominación legacy "TAG_WSP"/"Tag WSP". El
     concepto ya NO es específico de una ingeniería previa concreta (WSP)
     — es una referencia genérica de "tag anterior según el P&ID",
     utilizable en cualquier proyecto. Esto reabre — de forma acotada — la
     decisión de MODELO_CONCEPTUAL_SIEI.md que diferia "WSP" al futuro
     módulo de Ingeniería Previa: esa deferencia general se mantiene, pero
     tag_anterior como campo puntual del import P&ID sí se implementa ahora.
   - El snapshot de importación (`integracion.importacion_pnid*`) es
     PERSISTENTE PARA SIEMPRE, no efímero. Reemplaza la decisión anterior
     de MODELO_CONCEPTUAL_SIEI.md que marcaba "IMPORT_PNID" como staging
     efímero no persistente — esa entrada quedó desactualizada por diseño
     y se corrige en el propio documento.
   - `funcionamiento` y `cuerpo_instrumento` son texto libre (NVARCHAR), NO
     catálogos, por ahora.
   - `equipo_asociado_id` / `equipo_asociado_tag`: relación NUEVA y
     DISTINTA de `nucleo.senal.equipo_id` (que sigue sin relación entre
     EQUIPO e INSTRUMENTO en el sentido ya decidido). Esta es "a qué equipo
     de proceso sirve funcionalmente el instrumento", no "qué equipo
     origina la señal". Nunca crea un nucleo.equipo ficticio para resolver
     la FK — si no se encuentra, solo se guarda el tag literal.
   - `pnpid` / `fuente_pnpid` de nucleo.instrumento dejan de ser editables
     por la API normal de instrumentos (POST y PATCH) a partir de este
     cambio — ver backend/src/routes/instruments.ts. Un instrumento manual
     puede seguir existiendo con pnpid NULL. Esto NO es un cambio de esta
     migración (no hay nada que alterar en esas columnas), se documenta
     acá porque es la migración que le da sentido a esa restricción.

   ALCANCE
   -------
   Solo ADD de columnas en nucleo.instrumento (ninguna columna existente se
   modifica ni se elimina), 2 INSERT en cat.cat_estado_pnid, y 3 tablas
   nuevas en un schema nuevo (`integracion`). No se toca 001, 002 ni 003.
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

   004 depende de 001 (nucleo.instrumento, nucleo.equipo, cat.cat_estado_pnid)
   y de 003 (nucleo.instrumento.created_by/updated_by, FK a seguridad.usuario).
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'instrumento' AND c.name = N'created_by'
)
BEGIN
    THROW 55901,
    'La migracion 004 requiere que 003_user_audit.sql se haya aplicado antes (falta nucleo.instrumento.created_by).',
    1;
END
GO


/* ============================================================================
   1. ESQUEMA INTEGRACION
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.schemas
    WHERE name = N'integracion'
)
BEGIN
    EXEC(N'CREATE SCHEMA integracion AUTHORIZATION dbo;');
END
GO


/* ============================================================================
   2. NUEVAS COLUMNAS EN nucleo.instrumento (campos de origen P&ID)
   ============================================================================ */

ALTER TABLE nucleo.instrumento ADD
    tag_anterior         NVARCHAR(50)  NULL,
    tecnologia           NVARCHAR(100) NULL,
    funcionamiento       NVARCHAR(50)  NULL,
    cuerpo_instrumento   NVARCHAR(50)  NULL,
    conexion_proceso     NVARCHAR(100) NULL,
    plano_pnid           NVARCHAR(30)  NULL,
    linea_pnid           NVARCHAR(100) NULL,
    tipo_senal_pnid      NVARCHAR(50)  NULL,
    equipo_asociado_id   BIGINT        NULL,
    equipo_asociado_tag  NVARCHAR(50)  NULL,
    CONSTRAINT FK_instrumento_equipo_asociado
        FOREIGN KEY (equipo_asociado_id, proyecto_id)
        REFERENCES nucleo.equipo (id, proyecto_id);
GO

CREATE INDEX IX_instrumento_equipo_asociado
    ON nucleo.instrumento (equipo_asociado_id)
    WHERE equipo_asociado_id IS NOT NULL;
GO


/* ============================================================================
   3. NUEVOS CODIGOS EN cat.cat_estado_pnid

   Los 7 codigos existentes (OK, NUEVO_EN_PNID, NO_EXISTE_EN_PNID,
   TAG_DUPLICADO, TAG_VACIO, TAG_MODIFICADO, NO_LISTADO) se reutilizan tal
   cual — ver docs/MATRIZ_COBERTURA_DATOS_SIEI.md para el mapeo completo
   contra los resultados de comparacion del import. Solo faltan 2.
   ============================================================================ */

INSERT INTO cat.cat_estado_pnid (codigo, descripcion) VALUES
    (N'DATOS_MODIFICADOS', N'Mismo PnPID y mismo TAG, pero cambio algun otro campo de origen P&ID'),
    (N'REQUIERE_REVISION',  N'Conflicto detectado durante la comparacion (p.ej. PnPID duplicado en el archivo, o TAG nuevo ya usado por otro instrumento activo) que no se puede resolver automaticamente');
GO


/* ============================================================================
   4. integracion.importacion_pnid — cabecera de un batch de importacion
   ============================================================================ */

CREATE TABLE integracion.importacion_pnid (
    id                        BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id               BIGINT               NOT NULL,

    nombre_archivo            NVARCHAR(260)        NOT NULL,
    hash_archivo              CHAR(64)             NOT NULL,   -- SHA-256 hex del contenido; solo informativo, nunca bloquea
    fuente                    NVARCHAR(50)         NOT NULL CONSTRAINT DF_importacion_pnid_fuente DEFAULT (N'PLANT3D'),

    estado                    NVARCHAR(20)         NOT NULL,   -- PREVISUALIZADO | APLICADO | DESCARTADO | ERROR

    total_filas               INT                 NOT NULL,
    total_listado_true        INT                 NOT NULL,
    conteo_sin_cambios        INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_sin_cambios DEFAULT (0),
    conteo_nuevos             INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_nuevos DEFAULT (0),
    conteo_tag_modificado     INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_tag_modificado DEFAULT (0),
    conteo_datos_modificados  INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_datos_modificados DEFAULT (0),
    conteo_excluidos_listado  INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_excluidos_listado DEFAULT (0),
    conteo_no_existe_reporte  INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_no_existe_reporte DEFAULT (0),
    conteo_requiere_revision  INT                 NOT NULL CONSTRAINT DF_importacion_pnid_conteo_requiere_revision DEFAULT (0),

    advertencias              NVARCHAR(MAX)        NULL,       -- JSON: {missingKnownColumns:[...], unknownColumns:[...]}

    fecha_carga               DATETIME2            NOT NULL CONSTRAINT DF_importacion_pnid_fecha_carga DEFAULT SYSUTCDATETIME(),
    fecha_aplicacion          DATETIME2            NULL,

    created_by                BIGINT               NULL,
    applied_by                BIGINT               NULL,
    created_at                DATETIME2            NOT NULL CONSTRAINT DF_importacion_pnid_created_at DEFAULT SYSUTCDATETIME(),
    updated_at                DATETIME2            NULL,

    CONSTRAINT PK_importacion_pnid PRIMARY KEY (id),
    CONSTRAINT UQ_importacion_pnid_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_importacion_pnid_proyecto
        FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_importacion_pnid_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_importacion_pnid_applied_by
        FOREIGN KEY (applied_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT CK_importacion_pnid_estado
        CHECK (estado IN (N'PREVISUALIZADO', N'APLICADO', N'DESCARTADO', N'ERROR')),
    CONSTRAINT CK_importacion_pnid_advertencias_json
        CHECK (advertencias IS NULL OR ISJSON(advertencias) = 1)
);
GO

CREATE INDEX IX_importacion_pnid_proyecto
    ON integracion.importacion_pnid (proyecto_id, fecha_carga DESC);
GO


/* ============================================================================
   5. integracion.importacion_pnid_fila — snapshot de cada fila fisica del
      Excel. Representa EXCLUSIVAMENTE lo que vino en el archivo: sin
      resultado de comparacion, sin instrumento_id.
   ============================================================================ */

CREATE TABLE integracion.importacion_pnid_fila (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    importacion_id    BIGINT               NOT NULL,
    proyecto_id       BIGINT               NOT NULL,

    numero_fila       INT                  NOT NULL,   -- fila de origen en el Excel (1-based, sin contar encabezado)
    pnpid             NVARCHAR(50)         NULL,
    tag_instrumento   NVARCHAR(50)         NULL,
    listado           BIT                  NOT NULL,

    datos_fuente      NVARCHAR(MAX)        NOT NULL,   -- JSON {encabezado_original: valor}, TODAS las columnas del archivo

    created_at        DATETIME2            NOT NULL CONSTRAINT DF_importacion_pnid_fila_created_at DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_importacion_pnid_fila PRIMARY KEY (id),
    CONSTRAINT UQ_importacion_pnid_fila_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT UQ_importacion_pnid_fila_numero UNIQUE (importacion_id, numero_fila),
    CONSTRAINT FK_importacion_pnid_fila_importacion
        FOREIGN KEY (importacion_id, proyecto_id)
        REFERENCES integracion.importacion_pnid (id, proyecto_id),
    CONSTRAINT CK_importacion_pnid_fila_numero
        CHECK (numero_fila > 0),
    CONSTRAINT CK_importacion_pnid_fila_json
        CHECK (ISJSON(datos_fuente) = 1)
);
GO

CREATE INDEX IX_importacion_pnid_fila_pnpid
    ON integracion.importacion_pnid_fila (importacion_id, pnpid);
GO


/* ============================================================================
   6. integracion.importacion_pnid_resultado — conclusiones de comparar el
      snapshot contra nucleo.instrumento. Puede existir SIN fila (fila_id
      NULL) para el caso "instrumento administrado por Plant3D que ya no
      aparece en el nuevo reporte" (NO_EXISTE_EN_PNID).
   ============================================================================ */

CREATE TABLE integracion.importacion_pnid_resultado (
    id                                BIGINT IDENTITY(1,1) NOT NULL,
    importacion_id                    BIGINT               NOT NULL,
    proyecto_id                       BIGINT               NOT NULL,

    fila_id                           BIGINT               NULL,
    pnpid                             NVARCHAR(50)         NULL,   -- copiado (de la fila, o del instrumento si fila_id es NULL)
    tag_instrumento                   NVARCHAR(50)         NULL,

    instrumento_id                    BIGINT               NULL,
    resultado_id                      BIGINT               NOT NULL,

    diferencias                       NVARCHAR(MAX)        NULL,   -- JSON [{campo, anterior, nuevo}] o texto explicativo
    requiere_revision                 BIT                  NOT NULL CONSTRAINT DF_importacion_pnid_resultado_requiere_revision DEFAULT (0),

    aplicado                          BIT                  NOT NULL CONSTRAINT DF_importacion_pnid_resultado_aplicado DEFAULT (0),
    aplicado_at                       DATETIME2            NULL,

    instrumento_updated_at_preview    DATETIME2            NULL,   -- snapshot de nucleo.instrumento.updated_at al momento del PREVIEW, para detectar concurrencia en APPLY

    created_at                        DATETIME2            NOT NULL CONSTRAINT DF_importacion_pnid_resultado_created_at DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_importacion_pnid_resultado PRIMARY KEY (id),
    CONSTRAINT FK_importacion_pnid_resultado_importacion
        FOREIGN KEY (importacion_id, proyecto_id)
        REFERENCES integracion.importacion_pnid (id, proyecto_id),
    CONSTRAINT FK_importacion_pnid_resultado_fila
        FOREIGN KEY (fila_id, proyecto_id)
        REFERENCES integracion.importacion_pnid_fila (id, proyecto_id),
    CONSTRAINT FK_importacion_pnid_resultado_instrumento
        FOREIGN KEY (instrumento_id, proyecto_id)
        REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_importacion_pnid_resultado_resultado
        FOREIGN KEY (resultado_id) REFERENCES cat.cat_estado_pnid (id),
    CONSTRAINT CK_importacion_pnid_resultado_origen
        CHECK (fila_id IS NOT NULL OR instrumento_id IS NOT NULL),
    CONSTRAINT CK_importacion_pnid_resultado_diferencias_json
        CHECK (diferencias IS NULL OR ISJSON(diferencias) = 1)
);
GO

CREATE INDEX IX_importacion_pnid_resultado_importacion
    ON integracion.importacion_pnid_resultado (importacion_id);
GO

CREATE INDEX IX_importacion_pnid_resultado_instrumento
    ON integracion.importacion_pnid_resultado (instrumento_id)
    WHERE instrumento_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_importacion_pnid_resultado_fila
    ON integracion.importacion_pnid_resultado (importacion_id, fila_id)
    WHERE fila_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_importacion_pnid_resultado_instrumento
    ON integracion.importacion_pnid_resultado (importacion_id, instrumento_id)
    WHERE instrumento_id IS NOT NULL;
GO
