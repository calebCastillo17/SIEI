-- =============================================================================
-- Migracion 038: nucleo.c_actuador.recorrido_actuador/torque,
--                nucleo.c_posicionador
-- =============================================================================
-- Novena migracion del modulo Hojas de Datos (HD). Familia Valvulas
-- Moduladas — confirmado con la hoja real Instrumentos_ValvModuladas que
-- reutiliza c_cuerpo_valvula, c_set_aire, c_envolvente y c_unidad_control
-- SIN cambios (verificado campo por campo, incluyendo el mismo patron
-- fabricante Norgren/SMC para set de aire ya visto en Neumaticas). NO
-- usa c_interruptor_posicion (confirmado por la _MATRIZ de la usuaria:
-- las moduladas dan posicion continua vía posicionador, no
-- interruptores discretos).
--
-- c_actuador gana recorrido_actuador y torque — campos que ya estaban en
-- la descripcion original de la usuaria en _MODELO ("recorrido_actuador"
-- explicitamente distinto de recorrido_obturador en c_cuerpo_valvula,
-- "torque") pero no tenian evidencia real hasta ahora: Manometros/
-- Transmisores/Neumaticas/Hidraulicas no traen estos 2 campos en el
-- grupo ACTUADOR, Moduladas si (valores reales: "0 - 90° (rotativo, 1/4
-- de vuelta)" y torque="VTS").
--
-- nucleo.c_posicionador — NUEVO, exclusivo de Valvulas Moduladas
-- (confirmado por _MATRIZ: unica familia con X en esta columna). 1:0..1
-- con ficha_tecnica (asi lo definio la propia usuaria en su _MODELO).
-- SECUNDARIO (nunca el principal de una familia de valvula, ese rol lo
-- mantiene c_cuerpo_valvula en las 3 familias) -> modelo propio,
-- fabricante a marca_aceptable (componente='posicionador').
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


-- 1) nucleo.c_actuador gana recorrido_actuador / torque -----------------------

ALTER TABLE nucleo.c_actuador
    ADD recorrido_actuador NVARCHAR(50) NULL,
        torque              NVARCHAR(50) NULL;
GO


-- 2) nucleo.c_posicionador (1:0..1) -------------------------------------------

CREATE TABLE nucleo.c_posicionador (
    id                              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                     BIGINT               NOT NULL,
    ficha_tecnica_id                BIGINT               NOT NULL,

    tipo                            NVARCHAR(100)        NULL,
    accion                          NVARCHAR(30)         NULL,
    tipo_montaje                    NVARCHAR(30)         NULL,
    senal_control                   NVARCHAR(50)         NULL,
    senal_posicion                  NVARCHAR(50)         NULL,
    protocolo_comunicacion          NVARCHAR(50)         NULL,
    medidor_presion                 NVARCHAR(100)        NULL,
    funcion_diagnostico             NVARCHAR(100)        NULL,
    material_carcasa                NVARCHAR(100)        NULL,
    conexion_neumatica_cantidad     NVARCHAR(50)         NULL,
    conexion_electrica_cantidad     NVARCHAR(50)         NULL,
    grado_proteccion                NVARCHAR(20)         NULL,
    modelo                          NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_posicionador_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_posicionador_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_posicionador PRIMARY KEY (id),
    CONSTRAINT FK_c_posicionador_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_posicionador_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_posicionador_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_posicionador_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_posicionador_ficha_tecnica_activo
    ON nucleo.c_posicionador (ficha_tecnica_id)
    WHERE activo = 1;
GO
