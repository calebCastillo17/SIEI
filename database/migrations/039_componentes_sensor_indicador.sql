-- =============================================================================
-- Migracion 039: nucleo.c_sensor, nucleo.c_indicador,
--                nucleo.c_transmisor.montaje/material_carcasa
-- =============================================================================
-- Decima migracion del modulo Hojas de Datos (HD). Familias Flujo +
-- Nivel juntas (comparten C_SENSOR/C_TRANSMISOR/C_INDICADOR, mismo
-- criterio que la propia usuaria ya aplico al partir sus grupos mixtos
-- "SENSOR-TRANSMISOR" de Nivel y "TRANSMISOR INDICADOR" de Flujo en su
-- hoja _T_MEDICION, seguida aca campo por campo).
--
-- C_SENSOR — NUEVO, exclusivo de Flujo/Nivel/Densidad (Manometros/
-- Transmisores/Valvulas no lo usan). SECUNDARIO -> modelo propio,
-- fabricante a marca_aceptable (componente='sensor'). material_sensor y
-- material_liner van SEPARADOS (pedido explicito de la propia usuaria en
-- su _MAPEO: "'Material del sensor / liner' entra como dos columnas
-- separadas").
--
-- nucleo.c_transmisor gana montaje y material_carcasa — confirmados con
-- evidencia real de Flujo/Nivel (la carcasa electronica y el montaje del
-- transmisor no aparecian en las hojas de Manometros/Transmisores de
-- Presion usadas para construir esta tabla en la migracion 033).
--
-- C_INDICADOR — NUEVO. La propia usuaria encontro, al partir el grupo
-- "SENSOR-TRANSMISOR" de Nivel, que "Indicador integrado" (Requerido/N.A.)
-- es en realidad UN INDICADOR MAS, ademas del "INDICADOR REMOTO" que
-- Nivel ya declara aparte — nota textual suya: "Con C_INDICADOR 1:N se
-- registran ambos". Por eso esta tabla es 1:N (mismo patron que
-- c_interruptor_posicion/c_solenoide/c_envolvente/c_selector_maniobra),
-- con `es_integrado` (BIT) distinguiendo un indicador integral al
-- transmisor de uno remoto separado. SECUNDARIO -> modelo propio,
-- fabricante a marca_aceptable (componente='indicador').
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


-- 1) nucleo.c_sensor (1:0..1) --------------------------------------------------

CREATE TABLE nucleo.c_sensor (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo                    NVARCHAR(200)        NULL,
    material_sensor         NVARCHAR(100)        NULL,
    material_liner          NVARCHAR(100)        NULL,
    montaje_configuracion   NVARCHAR(200)        NULL,
    frecuencia_operacion    NVARCHAR(30)         NULL,
    conexion_proceso        NVARCHAR(100)        NULL,
    angulo_haz              NVARCHAR(20)         NULL,
    dead_band               NVARCHAR(30)         NULL,
    rango_medicion          NVARCHAR(50)         NULL,
    grado_proteccion        NVARCHAR(20)         NULL,
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_sensor_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_sensor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_sensor PRIMARY KEY (id),
    CONSTRAINT FK_c_sensor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_sensor_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_sensor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_sensor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_sensor_ficha_tecnica_activo
    ON nucleo.c_sensor (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_transmisor gana montaje / material_carcasa ----------------------

ALTER TABLE nucleo.c_transmisor
    ADD montaje           NVARCHAR(150) NULL,
        material_carcasa  NVARCHAR(100) NULL;
GO


-- 3) nucleo.c_indicador (1:N REAL) --------------------------------------------

CREATE TABLE nucleo.c_indicador (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    ficha_tecnica_id    BIGINT               NOT NULL,

    tipo                NVARCHAR(100)        NULL,
    es_integrado        BIT                  NULL,
    alimentacion        NVARCHAR(100)        NULL,
    consumo_electrico   NVARCHAR(30)         NULL,
    pantalla            NVARCHAR(100)        NULL,
    escala              NVARCHAR(50)         NULL,
    teclado             NVARCHAR(50)         NULL,
    entrada_cable       NVARCHAR(50)         NULL,
    material_carcasa    NVARCHAR(100)        NULL,
    grado_proteccion    NVARCHAR(20)         NULL,
    montaje             NVARCHAR(100)        NULL,
    modelo              NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_indicador_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_indicador_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_indicador PRIMARY KEY (id),
    CONSTRAINT FK_c_indicador_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_indicador_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_indicador_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_indicador_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO
