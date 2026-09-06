-- =============================================================================
-- Migracion 035: nucleo.c_unidad_control, nucleo.c_set_aire
-- =============================================================================
-- Sexta migracion del modulo Hojas de Datos (HD). Segunda parte de la
-- familia Valvulas Neumaticas — resuelve la primera mitad del grupo
-- "sobrecargado" UNIDAD DE CONTROL / SET DE AIRE / SELECTOR (columnas
-- 41-54 de Instrumentos_ValvNeumaticas).
--
-- C_UNIDAD_CONTROL — componente NUEVO, no estaba en el _MODELO original
-- de la usuaria (que solo preveia C_SET_AIRE/C_SELECTOR_MANIOBRA/
-- C_ENVOLVENTE para este grupo). Confirmado explicitamente por la usuaria:
-- 5 campos (tipo de montaje, voltaje de operacion, consumo, presion de
-- operacion, accion de falla) describen la unidad de control neumatica en
-- si misma — la cajita que recibe la senal y controla el aire hacia el
-- actuador — un concepto real distinto de C_ACTUADOR y de C_ENVOLVENTE.
-- Sin fabricante/modelo propios: no hay evidencia en los datos reales de
-- un par Fabricante/Modelo dedicado a este componente (el que aparece
-- justo despues, columnas 53-54, corresponde al SET DE AIRE que sigue,
-- confirmado por evidencia cruzada: MARCA_ACEPTABLE de la usuaria ya cita
-- "Norgren / SMC" como marcas de set de aire, una identidad de fabricante
-- propia y distinta de la unidad de control).
--
-- C_SET_AIRE — ya estaba en el _MODELO original de la usuaria: "Tipo,
-- rango de presion, conexion neumatica, cantidad, manometro, regulador de
-- velocidad, kit de puesta a tierra". A diferencia de
-- c_interruptor_posicion (migracion 034, 1:N real), la propia usuaria
-- SIEMPRE listo este como 1:0..1 — "cantidad" aca es un dato real (ej.
-- "01"), no un sustituto de filas. Componente SECUNDARIO -> modelo
-- propio, fabricante a marca_aceptable (componente='set_aire').
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


-- 1) nucleo.c_unidad_control (1:0..1) -----------------------------------------

CREATE TABLE nucleo.c_unidad_control (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,

    tipo_montaje        NVARCHAR(30)         NULL,
    voltaje_operacion   NVARCHAR(30)         NULL,
    consumo_w           NVARCHAR(30)         NULL,
    presion_operacion   NVARCHAR(30)         NULL,
    accion_falla        NVARCHAR(50)         NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_unidad_control_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_unidad_control_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_unidad_control PRIMARY KEY (id),
    CONSTRAINT FK_c_unidad_control_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_unidad_control_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_unidad_control_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_unidad_control_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_unidad_control_ficha_tecnica_activo
    ON nucleo.c_unidad_control (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_set_aire (1:0..1) ------------------------------------------------

CREATE TABLE nucleo.c_set_aire (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo                    NVARCHAR(50)         NULL,
    rango_presion           NVARCHAR(30)         NULL,
    conexion_neumatica      NVARCHAR(50)         NULL,
    cantidad                NVARCHAR(20)         NULL,
    manometro               NVARCHAR(100)        NULL,
    regulador_velocidad     NVARCHAR(50)         NULL,
    kit_puesta_tierra       NVARCHAR(50)         NULL,
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_set_aire_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_set_aire_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_set_aire PRIMARY KEY (id),
    CONSTRAINT FK_c_set_aire_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_set_aire_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_set_aire_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_set_aire_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_set_aire_ficha_tecnica_activo
    ON nucleo.c_set_aire (ficha_tecnica_id)
    WHERE activo = 1;
GO
