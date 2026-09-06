-- =============================================================================
-- Migracion 034: nucleo.c_cuerpo_valvula, nucleo.c_actuador,
--                nucleo.c_interruptor_posicion
-- =============================================================================
-- Quinta migracion del modulo Hojas de Datos (HD). Primera parte de la
-- familia Valvulas Neumaticas (la mas rica en componentes, 10 tablas por
-- el _MATRIZ de la usuaria) — deliberadamente NO se incluyen en esta
-- migracion los 4 componentes del "grupo sobrecargado" (C_SET_AIRE,
-- C_SELECTOR_MANIOBRA, C_ENVOLVENTE, C_SOLENOIDE): esos vienen de dos
-- grupos de columnas ("UNIDAD DE CONTROL / SET DE AIRE / SELECTOR" y
-- "VALVULA SOLENOIDE / CAJA / MANIOBRA") que la propia usuaria senalo como
-- mezcla de varios conceptos, y 5 campos reales (Tipo de montaje,
-- Voltaje de operacion, Consumo, Presion de operacion, Accion de falla)
-- no tienen un destino inequivoco todavia sin confirmar con ella —
-- se resuelve en una migracion aparte.
--
-- C_CUERPO_VALVULA — construido 1:1 sobre la propia hoja _T_VALVULA de la
-- usuaria (ya hizo la unificacion de sinonimos entre Hidraulica/Neumatica/
-- Modulante campo por campo). Es el componente PRINCIPAL de las 3
-- familias de valvula (igual criterio que C_MANOMETRO/C_TRANSMISOR en la
-- migracion 033) -> NO lleva modelo/fabricante propios, esos ya viven en
-- ficha_tecnica_instrumento.modelo + nucleo.marca_aceptable
-- (componente='cuerpo_valvula'). ruido_max_db/ruido_distancia_m/
-- cv_valvula son los 3 unicos campos que la propia usuaria califico como
-- "Numero" (no texto) en su analisis, resto NVARCHAR libre. Varios campos
-- (direccion_flujo, caracteristica_flujo, material_mangas,
-- material_sello_vastago, cv_valvula) solo se llenan segun la familia
-- (on/off vs modulante) — quedan NULL en las que no aplican, sin CHECK
-- que lo fuerce (mismo criterio ya usado en todo el proyecto: no inventar
-- una regla de exclusividad sin que el usuario la confirme).
--
-- C_ACTUADOR — SECUNDARIO (nunca el principal de una familia de valvula)
-- -> SI tiene su propio `modelo` (igual criterio que c_sello_diafragma),
-- fabricante va a marca_aceptable (componente='actuador'). Alcance
-- limitado a los campos que existen REALMENTE en Instrumentos_ValvNeumaticas
-- (columnas 22-28): torque y recorrido_actuador, mencionados en el
-- _MODELO de la usuaria, no aparecen en esta hoja — se agregan cuando se
-- cubra Valvulas Moduladas (evolucion aditiva, no hace falta ahora).
--
-- C_INTERRUPTOR_POSICION — la usuaria decidio explicitamente en su propio
-- _MODELO que este es 1:N real (uno de los tres componentes que marco
-- asi, junto a C_SOLENOIDE y C_ENVOLVENTE): "1:N porque 'Cantidad de
-- interruptores' hoy es una columna" — es decir, el dato actual (un
-- numero) esta modelado mal, deberia ser una fila real por interruptor
-- fisico. Por eso esta tabla NO tiene unique por ficha_tecnica_id (a
-- diferencia de c_manometro/c_transmisor/c_sello_diafragma/
-- c_cuerpo_valvula/c_actuador, que son 1:0..1) y NO tiene columna
-- "cantidad" — se cuenta con COUNT(*). Cada fila trae su propia
-- posicion_conmutacion (ej. una fila "abierto"/ZSO, otra "cerrado"/ZSC),
-- que es justamente el dato que se perdia al comprimir todo en un
-- numero. Tambien SECUNDARIO -> modelo propio, fabricante a
-- marca_aceptable (componente='interruptor_posicion').
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


-- 1) nucleo.c_cuerpo_valvula (1:0..1) -----------------------------------------

CREATE TABLE nucleo.c_cuerpo_valvula (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    ficha_tecnica_id            BIGINT               NOT NULL,

    tipo_cuerpo                 NVARCHAR(200)        NULL,
    tamano_nominal               NVARCHAR(20)         NULL,
    presion_trabajo_cwp         NVARCHAR(30)         NULL,
    clase_presion_brida         NVARCHAR(30)         NULL,
    tipo_conexion                NVARCHAR(200)        NULL,
    material_cuerpo             NVARCHAR(100)        NULL,
    recubrimiento_exterior      NVARCHAR(100)        NULL,
    marcado                     NVARCHAR(100)        NULL,
    posicion_normal              NVARCHAR(20)         NULL,
    ruido_max_db                DECIMAL(6,2)         NULL,
    ruido_operador              NVARCHAR(5)          NULL,
    ruido_distancia_m           DECIMAL(5,2)         NULL,
    posicion_montaje             NVARCHAR(20)         NULL,
    trim_tipo                   NVARCHAR(100)        NULL,
    direccion_flujo             NVARCHAR(50)         NULL,
    caracteristica_flujo        NVARCHAR(50)         NULL,
    recorrido_obturador         NVARCHAR(30)         NULL,
    material_obturador          NVARCHAR(100)        NULL,
    material_mangas             NVARCHAR(100)        NULL,
    material_vastago            NVARCHAR(100)        NULL,
    material_asiento            NVARCHAR(100)        NULL,
    material_sello              NVARCHAR(100)        NULL,
    material_sello_vastago      NVARCHAR(100)        NULL,
    cv_valvula                  DECIMAL(10,2)        NULL,
    clase_hermeticidad          NVARCHAR(50)         NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_cuerpo_valvula_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_cuerpo_valvula_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_cuerpo_valvula PRIMARY KEY (id),
    CONSTRAINT FK_c_cuerpo_valvula_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_cuerpo_valvula_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_cuerpo_valvula_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_cuerpo_valvula_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_cuerpo_valvula_ficha_tecnica_activo
    ON nucleo.c_cuerpo_valvula (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 2) nucleo.c_actuador (1:0..1) ------------------------------------------------

CREATE TABLE nucleo.c_actuador (
    id                      BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id             BIGINT               NOT NULL,
    ficha_tecnica_id        BIGINT               NOT NULL,

    tipo_actuador           NVARCHAR(100)        NULL,
    accion_falla            NVARCHAR(50)         NULL,
    principio_operacion     NVARCHAR(100)        NULL,
    presion_trabajo         NVARCHAR(50)         NULL,
    alimentacion            NVARCHAR(100)        NULL,
    tiempo_apertura_cierre  NVARCHAR(30)         NULL,
    conexion_actuador       NVARCHAR(50)         NULL,
    modelo                  NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_actuador_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_actuador_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_actuador PRIMARY KEY (id),
    CONSTRAINT FK_c_actuador_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_actuador_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_actuador_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_actuador_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_c_actuador_ficha_tecnica_activo
    ON nucleo.c_actuador (ficha_tecnica_id)
    WHERE activo = 1;
GO


-- 3) nucleo.c_interruptor_posicion (1:N REAL — sin unique por ficha) ---------

CREATE TABLE nucleo.c_interruptor_posicion (
    id                          BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                 BIGINT               NOT NULL,
    ficha_tecnica_id            BIGINT               NOT NULL,

    tecnologia                  NVARCHAR(100)        NULL,
    tipo_contacto               NVARCHAR(30)         NULL,
    corriente_contacto          NVARCHAR(50)         NULL,
    cantidad_contactos          NVARCHAR(20)         NULL,
    conexion_electrica          NVARCHAR(50)         NULL,
    grado_proteccion            NVARCHAR(20)         NULL,
    posicion_conmutacion        NVARCHAR(50)         NULL,
    modelo                      NVARCHAR(100)        NULL,

    activo      BIT       NOT NULL CONSTRAINT DF_c_interruptor_posicion_activo DEFAULT (1),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_c_interruptor_posicion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NULL,
    created_by  BIGINT    NULL,
    updated_by  BIGINT    NULL,

    CONSTRAINT PK_c_interruptor_posicion PRIMARY KEY (id),
    CONSTRAINT FK_c_interruptor_posicion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_c_interruptor_posicion_ficha_tecnica FOREIGN KEY (ficha_tecnica_id, proyecto_id) REFERENCES nucleo.ficha_tecnica_instrumento (id, proyecto_id),
    CONSTRAINT FK_c_interruptor_posicion_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_c_interruptor_posicion_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO
