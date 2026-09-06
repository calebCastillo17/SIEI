-- =============================================================================
-- Migracion 040: nucleo.c_fuente_radioactiva,
--                nucleo.c_sensor.posicion_montaje/requerimiento_tuberia_recta,
--                nucleo.c_transmisor.tipo/consumo/rango_transmisor/
--                repetibilidad/compensacion_deterioro_fuente/
--                inmunidad_saturacion,
--                nucleo.c_indicador.conexion_electrica/configuracion_local/
--                longitud_max_cable
-- =============================================================================
-- Undecima migracion del modulo Hojas de Datos (HD). Familia Densidad —
-- la mas rica de todas (58 columnas), confirma que reutiliza
-- c_sensor/c_transmisor/c_indicador (mismo criterio que Flujo/Nivel,
-- migracion 039) con varios campos nuevos reales, mas una tabla nueva
-- exclusiva de esta familia: el densimetro nuclear.
--
-- C_FUENTE_RADIOACTIVA — NUEVA, exclusiva de Densidad (confirmado por la
-- _MATRIZ de la usuaria). 1:0..1, tal como ya lo definio ella misma en su
-- _MODELO. SECUNDARIO (el TRANSMISOR sigue siendo el componente
-- principal de la familia, igual que en Flujo/Nivel) -> modelo propio,
-- fabricante a marca_aceptable (componente='fuente_radioactiva'). Arrastra
-- requisitos regulatorios propios (licencias, IPEN) que van a
-- REQUISITO/CAT_REQUISITO, ya modelado en la migracion 032 — no hace
-- falta ningun cambio aca, cat_requisito es abierto y la usuaria agrega
-- los codigos (REQ-LICENCIA, REQ-CERTREG, REQ-IPEN, REQ-TRANSP,
-- REQ-INSTAL, REQ-SAT) cuando los necesite.
--
-- c_sensor gana posicion_montaje y requerimiento_tuberia_recta —
-- confirmado por la propia usuaria en su _MAPEO: "SENSOR (DETECTOR) ...
-- Aporta 'Requerimiento tubería recta' y 'Posición de montaje', validos
-- tambien para flujo" (Flujo no los mostraba con dato real todavia, pero
-- la columna queda lista para cuando se cargue).
--
-- c_transmisor gana 6 campos nuevos reales que ni Transmisores de
-- Presion ni Flujo/Nivel mostraban: `tipo` (arquitectura electronica,
-- ej. "Electrónico Smart" — distinto de tipo_sensor/tipo_medicion, que
-- ya existian), `consumo`, `rango_transmisor` (el rango de catalogo del
-- transmisor, DISTINTO de rango_ajustado que ya existe y es la
-- calibracion real de esta aplicacion — mismo criterio ya usado para
-- rango_medicion vs rango_ajustado en otras familias), `repetibilidad`
-- (ya estaba prevista en el propio _T_MEDICION de la usuaria para Nivel,
-- pero recien aparece con dato real aca), y 2 campos exclusivos de
-- densitometria nuclear: `compensacion_deterioro_fuente` e
-- `inmunidad_saturacion`.
--
-- c_indicador gana conexion_electrica, configuracion_local y
-- longitud_max_cable — este ultimo explicitamente previsto por la propia
-- usuaria en su _MODELO original ("long. maxima cable") para el caso de
-- un indicador remoto separado fisicamente del sensor/transmisor.
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


-- 1) nucleo.c_fuente_radioactiva (1:0..1) -------------------------------------

CREATE TABLE nucleo.c_fuente_radioactiva (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    ficha_tecnica_id            BIGINT               NOT NULL,

    tipo                        NVARCHAR(300)        NULL,
    elemento_radioactivo        NVARCHAR(50)         NULL,
    intensidad_radiacion        NVARCHAR(100)        NULL,
    actividad_maxima            NVARCHAR(50)         NULL,
    material_blindaje           NVARCHAR(50)         NULL,
    mecanismo_bloqueo_shutter   NVARCHAR(50)         NULL,
    asas_manipulacion           NVARCHAR(50)         NULL,
    conexion_proceso            NVARCHAR(100)        NULL,
    modelo                      NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_fuente_radioactiva_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_fuente_radioactiva_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_fuente_radioactiva PRIMARY KEY (id),
    CONSTRAINT FK_c_fuente_radioactiva_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_fuente_radioactiva_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_fuente_radioactiva_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_fuente_radioactiva_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_fuente_radioactiva_ficha_tecnica_activo
    ON nucleo.c_fuente_radioactiva (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_sensor gana 2 campos ---------------------------------------------

ALTER TABLE nucleo.c_sensor
    ADD posicion_montaje              NVARCHAR(50) NULL,
        requerimiento_tuberia_recta   NVARCHAR(50) NULL;
GO


-- 3) nucleo.c_transmisor gana 6 campos -----------------------------------------

ALTER TABLE nucleo.c_transmisor
    ADD tipo                            NVARCHAR(100) NULL,
        consumo                         NVARCHAR(30)  NULL,
        rango_transmisor                NVARCHAR(50)  NULL,
        repetibilidad                   NVARCHAR(30)  NULL,
        compensacion_deterioro_fuente   NVARCHAR(50)  NULL,
        inmunidad_saturacion            NVARCHAR(50)  NULL;
GO


-- 4) nucleo.c_indicador gana 3 campos ------------------------------------------

ALTER TABLE nucleo.c_indicador
    ADD conexion_electrica     NVARCHAR(50) NULL,
        configuracion_local    NVARCHAR(50) NULL,
        longitud_max_cable     NVARCHAR(30) NULL;
GO
