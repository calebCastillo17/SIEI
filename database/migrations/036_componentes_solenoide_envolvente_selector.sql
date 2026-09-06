-- =============================================================================
-- Migracion 036: nucleo.c_solenoide, nucleo.c_envolvente,
--                nucleo.c_selector_maniobra
-- =============================================================================
-- Septima migracion del modulo Hojas de Datos (HD). Cierra la familia
-- Valvulas Neumaticas resolviendo la segunda mitad del grupo
-- "sobrecargado" VALVULA SOLENOIDE / CAJA / MANIOBRA (columnas 63-84 de
-- Instrumentos_ValvNeumaticas).
--
-- Los 3 componentes son 1:N REALES (mismo criterio que
-- c_interruptor_posicion, migracion 034) — sin unique por ficha_tecnica_id,
-- sin columna "cantidad":
--
-- C_SOLENOIDE — la propia usuaria ya lo marco 1:N en su _MODELO. Datos
-- reales: "Cantidad de solenoides -> 02 (open / close)" es el mismo
-- sintoma que ya se corrigio en interruptor_posicion — se agrega
-- `funcion` (ej. "apertura"/"cierre") para que cada solenoide fisico sea
-- su propia fila en vez de un numero. `cantidad_valvulas` SI se conserva
-- como columna (no como "cantidad de filas"): es una propiedad del
-- manifold neumatico completo (cuantas valvulas de 3/4 vias contiene),
-- no varia por solenoide individual, se repite igual en todas las filas
-- de una misma ficha tecnica.
--
-- C_ENVOLVENTE — la propia usuaria ya lo marco 1:N ("un mismo instrumento
-- puede tener 2-3 cajas": caja de conexiones, caja de solenoide, caja de
-- set de aire). Se agrega `funcion` para identificar cual caja es cada
-- fila (dato que en el Excel viene implicito por el grupo de columnas de
-- origen, no por un campo propio) — sin esto, 3 filas de un mismo
-- instrumento serian indistinguibles entre si.
--
-- C_SELECTOR_MANIOBRA — CORREGIDO de 1:0..1 (asi estaba en el _MODELO
-- original de la usuaria) a 1:N, confirmado explicitamente por la usuaria
-- en conversacion: el "Selector remoto/local" de la unidad de control y
-- el "Maniobra" de la caja del solenoide son DOS interruptores fisicos
-- distintos, no el mismo dato repetido. Se agrega `funcion` (ej.
-- "selector_remoto_local" / "maniobra_local") por el mismo motivo que
-- c_envolvente.
--
-- Los 3 son SECUNDARIOS (nunca el principal de una familia de valvula)
-- -> modelo propio por fila, fabricante a marca_aceptable
-- (componente='solenoide'/'envolvente'/'selector_maniobra').
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


-- 1) nucleo.c_solenoide (1:N REAL) --------------------------------------------

CREATE TABLE nucleo.c_solenoide (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,

    tipo                NVARCHAR(50)         NULL,
    funcion             NVARCHAR(50)         NULL,
    cantidad_valvulas   NVARCHAR(20)         NULL,
    voltaje_operacion   NVARCHAR(30)         NULL,
    conexion_neumatica  NVARCHAR(50)         NULL,
    grado_proteccion    NVARCHAR(20)         NULL,
    modelo              NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_solenoide_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_solenoide_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_solenoide PRIMARY KEY (id),
    CONSTRAINT FK_c_solenoide_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_solenoide_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_solenoide_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_solenoide_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


-- 2) nucleo.c_envolvente (1:N REAL) -------------------------------------------

CREATE TABLE nucleo.c_envolvente (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,

    funcion             NVARCHAR(50)         NULL,
    dimensiones_whd     NVARCHAR(50)         NULL,
    material            NVARCHAR(100)        NULL,
    espesor             NVARCHAR(30)         NULL,
    grado_proteccion    NVARCHAR(20)         NULL,
    placa_montaje       NVARCHAR(50)         NULL,
    voltaje             NVARCHAR(30)         NULL,
    modelo              NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_envolvente_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_envolvente_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_envolvente PRIMARY KEY (id),
    CONSTRAINT FK_c_envolvente_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_envolvente_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_envolvente_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_envolvente_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO


-- 3) nucleo.c_selector_maniobra (1:N REAL — corregido de 1:0..1) -------------

CREATE TABLE nucleo.c_selector_maniobra (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,

    funcion             NVARCHAR(50)         NULL,
    tipo                NVARCHAR(100)        NULL,
    tipo_contacto       NVARCHAR(30)         NULL,
    corriente_contacto  NVARCHAR(50)         NULL,
    cantidad_contactos  NVARCHAR(20)         NULL,
    ranura_candado      NVARCHAR(50)         NULL,
    grado_proteccion    NVARCHAR(20)         NULL,
    modelo              NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_selector_maniobra_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_selector_maniobra_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_selector_maniobra PRIMARY KEY (id),
    CONSTRAINT FK_c_selector_maniobra_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_selector_maniobra_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_selector_maniobra_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_selector_maniobra_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO
