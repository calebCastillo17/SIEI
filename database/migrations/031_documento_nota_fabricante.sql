-- =============================================================================
-- Migracion 031: nucleo.documento, nucleo.nota, nucleo.instrumento_nota,
--                nucleo.instrumento_documento, cat.cat_tipo_documento,
--                cat.cat_fabricante
-- =============================================================================
-- Segunda migracion del modulo Hojas de Datos (HD) de instrumentos (ver
-- migracion 030 para el contexto general y la conversacion sobre el
-- Excel "DB HD.xlsx" de la usuaria).
--
-- DOCUMENTO — la usuaria confirmo que es un catalogo separado de PLANO
-- (plano = dibujo CAD; documento = un listado de documentos con su propia
-- descripcion, ej. una Hoja de Datos), modelado con la MISMA filosofia
-- que nucleo.plano (migracion 014): contenido externo que SIEI cataloga,
-- no genera, hoy. La usuaria explicitamente dejo la puerta abierta a que
-- algun documento se termine emitiendo desde SIEI como un entregable mas
-- adelante (igual que LDI) — eso no requiere ningun cambio de diseno aca:
-- nucleo.documento (catalogo) y nucleo.entregable/revision_entregable
-- (generado por SIEI) son conceptos independientes y pueden coexistir sin
-- acoplarse; el dia que haga falta, se agrega un cat_tipo_entregable
-- nuevo que lea de la misma data estructurada, sin tocar esta tabla.
--
-- codigo_documento queda SIN unique (mismo criterio que codigo_plano —
-- sin evidencia todavia de que sea siempre distinto). revision se agrega
-- desde el arranque (a diferencia de plano, que la sumo en una migracion
-- aparte, la 022) porque ya sabemos que hace falta.
--
-- Un documento puede aplicar a VARIOS instrumentos/tags a la vez (una
-- Hoja de Datos de Manometros cubre varios tags) — nucleo.instrumento_documento
-- es una relacion N:M real, mismo patron que gabinete_plano/caja_plano:
-- una fila por asociacion activa, reasociar reactiva en vez de duplicar.
--
-- cat.cat_tipo_documento — catalogo global, dominio ABIERTO (writable=true
-- en el router, igual que cat_tipo_interfaz/cat_tipo_com/cat_tipo_medio_com):
-- arranca vacio, sin seed. La usuaria va a agregar tipos (HOJA_DE_DATOS
-- primero, otros despues) segun los vaya necesitando, sin requerir una
-- migracion cada vez.
--
-- NOTA / INSTRUMENTO_NOTA — el texto de cada nota numerada de un
-- documento (numeracion propia POR documento, confirmado con datos
-- reales: DOC-01 tiene notas 1-8, DOC-02 las suyas), y que tags la tienen
-- asociada. A diferencia del modelo original de la usuaria (TAG_NOTA con
-- clave compuesta tag_id+documento_id+numero), nota tiene su propio id
-- surrogate y la relacion N:M solo necesita instrumento_id+nota_id — mas
-- simple, sin arrastrar documento_id+numero de nuevo.
--
-- CAT_FABRICANTE — confirmado por la usuaria: catalogo UNIVERSAL, sirve
-- para todos los proyectos y clientes -> cat.* global, no nucleo.*.
-- Mismo criterio de dominio abierto que los catalogos anteriores.
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


-- 1) Catalogos globales, dominio abierto, sin seed --------------------------

CREATE TABLE cat.cat_tipo_documento (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_documento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_documento PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_documento_codigo UNIQUE (codigo)
);
GO

CREATE TABLE cat.cat_fabricante (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(30)         NOT NULL,
    descripcion     NVARCHAR(200)        NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_fabricante_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_fabricante PRIMARY KEY (id),
    CONSTRAINT UQ_cat_fabricante_codigo UNIQUE (codigo)
);
GO


-- 2) nucleo.documento ---------------------------------------------------------

CREATE TABLE nucleo.documento (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    codigo_documento    NVARCHAR(100)        NULL,
    descripcion         NVARCHAR(300)        NOT NULL,
    tipo_documento_id   BIGINT               NOT NULL,
    revision            NVARCHAR(10)         NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_documento_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_documento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    created_by          BIGINT               NULL,
    updated_by          BIGINT               NULL,
    CONSTRAINT PK_documento PRIMARY KEY (id),
    CONSTRAINT UQ_documento_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_documento_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_documento_tipo_documento FOREIGN KEY (tipo_documento_id) REFERENCES cat.cat_tipo_documento (id),
    CONSTRAINT FK_documento_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_documento_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- codigo_documento: sin unique, mismo criterio que plano.codigo_plano —
-- indice de busqueda no unico, filtrado.
CREATE INDEX IX_documento_proyecto_codigo
    ON nucleo.documento (proyecto_id, codigo_documento)
    WHERE codigo_documento IS NOT NULL AND activo = 1;
GO


-- 3) nucleo.instrumento_documento (N:M) --------------------------------------

CREATE TABLE nucleo.instrumento_documento (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    instrumento_id  BIGINT               NOT NULL,
    documento_id    BIGINT               NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_instrumento_documento_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_instrumento_documento_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    created_by      BIGINT               NULL,
    updated_by      BIGINT               NULL,
    CONSTRAINT PK_instrumento_documento PRIMARY KEY (id),
    CONSTRAINT FK_instrumento_documento_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_instrumento_documento_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_instrumento_documento_documento FOREIGN KEY (documento_id, proyecto_id) REFERENCES nucleo.documento (id, proyecto_id),
    CONSTRAINT FK_instrumento_documento_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_instrumento_documento_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Impide repetir la MISMA asociacion activa dos veces; no limita cuantos
-- documentos distintos puede tener un instrumento ni cuantos instrumentos
-- distintos puede tener un documento.
CREATE UNIQUE INDEX UX_instrumento_documento_activo
    ON nucleo.instrumento_documento (instrumento_id, documento_id)
    WHERE activo = 1;
GO


-- 4) nucleo.nota ----------------------------------------------------------

CREATE TABLE nucleo.nota (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    documento_id    BIGINT               NOT NULL,
    numero          SMALLINT             NOT NULL,
    texto           NVARCHAR(MAX)        NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_nota_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_nota_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    created_by      BIGINT               NULL,
    updated_by      BIGINT               NULL,
    CONSTRAINT PK_nota PRIMARY KEY (id),
    CONSTRAINT UQ_nota_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_nota_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_nota_documento FOREIGN KEY (documento_id, proyecto_id) REFERENCES nucleo.documento (id, proyecto_id),
    CONSTRAINT FK_nota_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_nota_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT CK_nota_numero_positivo CHECK (numero > 0)
);
GO

-- No se repite el mismo numero de nota dentro de un mismo documento
-- mientras este activa.
CREATE UNIQUE INDEX UX_nota_documento_numero
    ON nucleo.nota (documento_id, numero)
    WHERE activo = 1;
GO


-- 5) nucleo.instrumento_nota (N:M) -------------------------------------------

CREATE TABLE nucleo.instrumento_nota (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    instrumento_id  BIGINT               NOT NULL,
    nota_id         BIGINT               NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_instrumento_nota_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_instrumento_nota_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    created_by      BIGINT               NULL,
    updated_by      BIGINT               NULL,
    CONSTRAINT PK_instrumento_nota PRIMARY KEY (id),
    CONSTRAINT FK_instrumento_nota_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_instrumento_nota_instrumento FOREIGN KEY (instrumento_id, proyecto_id) REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT FK_instrumento_nota_nota FOREIGN KEY (nota_id, proyecto_id) REFERENCES nucleo.nota (id, proyecto_id),
    CONSTRAINT FK_instrumento_nota_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_instrumento_nota_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_instrumento_nota_activo
    ON nucleo.instrumento_nota (instrumento_id, nota_id)
    WHERE activo = 1;
GO
