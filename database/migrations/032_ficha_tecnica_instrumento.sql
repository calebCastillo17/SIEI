-- =============================================================================
-- Migracion 032: nucleo.ficha_tecnica_instrumento, nucleo.tag_proceso,
--                nucleo.ficha_tecnica_requisito, nucleo.marca_aceptable,
--                cat.cat_requisito
-- =============================================================================
-- Tercera migracion del modulo Hojas de Datos (HD) de instrumentos (ver
-- migraciones 030/031 para el contexto general).
--
-- FICHA_TECNICA_INSTRUMENTO — la "INSTRUMENTO" del modelo original de la
-- usuaria, renombrada para no chocar con nucleo.instrumento (que ya
-- significa el TAG fisico en SIEI). Es la cabecera de una CONFIGURACION
-- TECNICA UNICA: fabricante/modelo principal, grado de proteccion,
-- documento de origen. Varios tags (nucleo.instrumento) pueden compartir
-- la MISMA ficha tecnica (ej. 3 manometros identicos) — por eso vive
-- aparte, no en instrumento directo; nucleo.instrumento gana
-- ficha_tecnica_id (FK compuesta nullable, un tag puede no tener ficha
-- tecnica asociada todavia). No se agregan columnas `familia`/`tipo`
-- propias: son derivables via documento_id -> tipo_documento, evita tener
-- dos lugares que puedan desincronizarse. codigo_referencia conserva el
-- codigo de texto original de la usuaria (ej. "INS-DOC-01-01") solo como
-- referencia/trazabilidad de import, nunca como PK (surrogate BIGINT como
-- el resto del esquema) ni con unique (mismo criterio que codigo_plano).
--
-- TAG_PROCESO — cuelga del TAG FISICO (instrumento_id), no de la ficha
-- tecnica: dos tags con la misma ficha tecnica pueden tener condiciones
-- de proceso distintas (ej. dos manometros identicos en servicios
-- distintos). Formato largo (variable/minimo/nominal/maximo/unidad),
-- resuelve la duplicacion conceptual ya detectada por la propia usuaria
-- en su Excel (columnas "Flujo maximo"/"Flujo nominal"/"Flujo minimo"
-- todas la misma variable segun el documento). Los valores quedan como
-- texto (NVARCHAR), no numerico: el dato real trae placeholders no
-- numericos ("VTS", "N.A.", "TBD") ademas de numeros — mismo criterio ya
-- usado en el proyecto para no forzar tipos numericos sin evidencia de
-- que el dato sea siempre limpio. rango_calibrado_campo es opcional,
-- pedido explicito de la usuaria: solo se llena cuando la calibracion
-- real en obra difiere del rango de catalogo (que vive en el futuro
-- C_TRANSMISOR, no aca).
--
-- CAT_REQUISITO / FICHA_TECNICA_REQUISITO — formato largo transversal
-- (FAT, certificado de calibracion, placa de identificacion, etc.),
-- cuelga de la FICHA TECNICA (es la configuracion la que define que
-- requiere, no cada tag). cat_requisito es catalogo GLOBAL abierto (igual
-- criterio que cat_fabricante: un requisito tipo "prueba FAT" no es
-- especifico de un proyecto). IMPORTANTE, evidencia real de la propia
-- usuaria (su hoja _T_REQUISITO, caso REQ-BRACKET en Densidad): el MISMO
-- requisito puede legitimamente repetirse 2 veces para la misma ficha
-- tecnica con `detalle` distinto (ej. "brackets fijacion fuente
-- radioactiva" + "brackets fijacion detector/transmisor") — por eso esta
-- tabla NO lleva unique en (ficha_tecnica_id, requisito_id); forzarlo
-- bloquearia un caso real ya confirmado.
--
-- MARCA_ACEPTABLE — cuelga de la FICHA TECNICA (confirmado explicitamente
-- por la usuaria: "es propiedad de la configuracion, no de cada tag
-- individual"). A diferencia de REQUISITO, aca SI hay evidencia de que
-- (ficha_tecnica, componente, fabricante) es una clave natural real —
-- se enforce con unique filtrado.
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


-- 1) nucleo.ficha_tecnica_instrumento -----------------------------------------

CREATE TABLE nucleo.ficha_tecnica_instrumento (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    documento_id        BIGINT               NULL,
    fabricante_id       BIGINT               NULL,
    modelo              NVARCHAR(100)        NULL,
    grado_proteccion    NVARCHAR(20)         NULL,
    codigo_referencia   NVARCHAR(50)         NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_ficha_tecnica_instrumento_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_ficha_tecnica_instrumento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    created_by          BIGINT               NULL,
    updated_by          BIGINT               NULL,
    CONSTRAINT PK_ficha_tecnica_instrumento PRIMARY KEY (id),
    CONSTRAINT UQ_ficha_tecnica_instrumento_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_ficha_tecnica_instrumento_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_ficha_tecnica_instrumento_documento FOREIGN KEY (documento_id, proyecto_id) REFERENCES nucleo.documento (id, proyecto_id),
    CONSTRAINT FK_ficha_tecnica_instrumento_fabricante FOREIGN KEY (fabricante_id) REFERENCES cat.cat_fabricante (id),
    CONSTRAINT FK_ficha_tecnica_instrumento_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_ficha_tecnica_instrumento_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- codigo_referencia: solo trazabilidad del codigo original de Excel, sin
-- unique (mismo criterio que codigo_plano/codigo_documento).
CREATE INDEX IX_ficha_tecnica_instrumento_proyecto_codigo
    ON nucleo.ficha_tecnica_instrumento (proyecto_id, codigo_referencia)
    WHERE codigo_referencia IS NOT NULL AND activo = 1;
GO

ALTER TABLE nucleo.instrumento
    ADD ficha_tecnica_id BIGINT NULL;
GO

ALTER TABLE nucleo.instrumento
    ADD CONSTRAINT FK_instrumento_ficha_tecnica
        FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id);
GO


-- 2) nucleo.tag_proceso --------------------------------------------------------

CREATE TABLE nucleo.tag_proceso (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    instrumento_id          BIGINT               NOT NULL,
    variable                NVARCHAR(100)        NOT NULL,
    valor_min               NVARCHAR(50)         NULL,
    valor_nominal           NVARCHAR(50)         NULL,
    valor_max               NVARCHAR(50)         NULL,
    unidad                  NVARCHAR(30)         NULL,
    rango_calibrado_campo   NVARCHAR(50)         NULL,
    activo                  BIT                  NOT NULL CONSTRAINT DF_tag_proceso_activo DEFAULT (1),
    created_at              DATETIME2            NOT NULL CONSTRAINT DF_tag_proceso_created_at DEFAULT SYSUTCDATETIME(),
    updated_at              DATETIME2            NULL,
    created_by              BIGINT               NULL,
    updated_by              BIGINT               NULL,
    CONSTRAINT PK_tag_proceso PRIMARY KEY (id),
    CONSTRAINT FK_tag_proceso_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tag_proceso_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_tag_proceso_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tag_proceso_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_tag_proceso_instrumento_variable
    ON nucleo.tag_proceso (instrumento_id, variable)
    WHERE activo = 1;
GO


-- 3) cat.cat_requisito (global, abierto) --------------------------------------

CREATE TABLE cat.cat_requisito (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    categoria       NVARCHAR(50)         NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_requisito_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_requisito PRIMARY KEY (id),
    CONSTRAINT UQ_cat_requisito_codigo UNIQUE (codigo)
);
GO


-- 4) nucleo.ficha_tecnica_requisito (formato largo, SIN unique — ver
--    nota de cabecera sobre REQ-BRACKET) ---------------------------------

CREATE TABLE nucleo.ficha_tecnica_requisito (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,
    requisito_id        BIGINT               NOT NULL,
    valor               NVARCHAR(20)         NOT NULL,
    detalle             NVARCHAR(300)        NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_ficha_tecnica_requisito_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_ficha_tecnica_requisito_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    created_by          BIGINT               NULL,
    updated_by          BIGINT               NULL,
    CONSTRAINT PK_ficha_tecnica_requisito PRIMARY KEY (id),
    CONSTRAINT CK_ficha_tecnica_requisito_valor CHECK (valor IN (N'REQUERIDO', N'NO_REQUERIDO', N'NO_APLICA')),
    CONSTRAINT FK_ficha_tecnica_requisito_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_ficha_tecnica_requisito_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_ficha_tecnica_requisito_requisito FOREIGN KEY (requisito_id) REFERENCES cat.cat_requisito (id),
    CONSTRAINT FK_ficha_tecnica_requisito_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_ficha_tecnica_requisito_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


-- 5) nucleo.marca_aceptable ----------------------------------------------------

CREATE TABLE nucleo.marca_aceptable (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,
    componente          NVARCHAR(50)         NOT NULL,
    fabricante_id       BIGINT               NOT NULL,
    preferente          BIT                  NULL,
    notas_ref           NVARCHAR(200)        NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_marca_aceptable_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_marca_aceptable_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    created_by          BIGINT               NULL,
    updated_by          BIGINT               NULL,
    CONSTRAINT PK_marca_aceptable PRIMARY KEY (id),
    CONSTRAINT FK_marca_aceptable_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_marca_aceptable_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_marca_aceptable_fabricante FOREIGN KEY (fabricante_id) REFERENCES cat.cat_fabricante (id),
    CONSTRAINT FK_marca_aceptable_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_marca_aceptable_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_marca_aceptable_activo
    ON nucleo.marca_aceptable (ficha_tecnica_id, componente, fabricante_id)
    WHERE activo = 1;
GO
