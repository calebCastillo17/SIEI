/* =============================================================================
   015_terminaciones.sql — SIEI
   Primer registro estructural del dominio de conexionado a nivel de
   conductor/terminal: CONDUCTOR (hilo fisico individual), BLOQUE_TERMINAL +
   TERMINAL + POSICION_TERMINAL (jerarquia fisica de terminales en
   caja/gabinete/modulo), TRAMO_CONDUCTOR (que conductores viven en que
   tramo) y TERMINACION (el hecho fisico: este conductor, en este tramo, en
   este extremo, aterriza en esta posicion de terminal). No importa datos
   reales — todas las tablas nuevas quedan vacias.

   Ver docs/DIAGNOSTICO_SENALES_GABINETES.md secciones 36-39 para el
   diagnostico completo y las 3 rondas de correccion de diseño que
   precedieron esta migracion (36: diagnostico inicial y evidencia Excel;
   37: primer rediseño, POSICION_TERMINAL descartado; 38: TERMINACION
   confirmada obligatoria, POSICION_TERMINAL reintroducida; 39: la
   incompatibilidad real con tramo_conexion.par_conductor_id NOT NULL,
   encontrada por el usuario, que hace que esta migracion NO sea 100%
   aditiva).

   CONTEXTO / DECISIONES DE NEGOCIO CLAVE (aprobadas explicitamente):

   - tramo_conexion.par_conductor_id (BIGINT NOT NULL desde 001, con
     UX_tramo_conexion_par_conductor_id sin filtro IS NOT NULL porque no
     hacia falta) NO puede seguir NOT NULL: un tramo del modelo nuevo
     (conductores individuales via TRAMO_CONDUCTOR, sin un PAR_CONDUCTOR
     real detras — el caso real es un cable "1-19c#14 AWG" sin pares)
     necesita poder existir con par_conductor_id = NULL. Se evoluciona a
     NULL (ALTER COLUMN, sin tocar 001_initial_schema.sql), se reemplaza
     su indice unico por una version filtrada (WHERE par_conductor_id IS
     NOT NULL AND activo = 1), y se recrean (DROP + CREATE, cuerpo
     minimamente modificado) los 2 unicos triggers que la referenciaban:
     TR_tramo_conexion_validar_secuencia (la tabla variable @activos
     declaraba su propia columna par_conductor_id BIGINT NOT NULL — un
     valor NULL real la habria roto para TODA la ruta afectada, no solo
     el tramo nuevo) y TR_cable_validar_desactivacion (solo conocia el
     camino legacy par_conductor -> tramo_conexion.par_conductor_id; se
     EXTIENDE, no solo se adapta, para tambien detectar el camino nuevo
     conductor -> tramo_conductor). Confirmado por busqueda exhaustiva:
     ningun otro trigger de 001/012 referencia esta columna. Politica:
     LEGACY (par_conductor_id poblado) sigue validandose exactamente
     igual que hoy; NUEVO MODELO (par_conductor_id NULL) no exige par —
     la integridad de sus conductores se valida en TRAMO_CONDUCTOR/
     TERMINACION, no en TR_tramo_conexion_validar_secuencia.

   - Topologia GABINETE intermedio (revision bloqueante posterior a la
     primera version de esta migracion, ver seccion 41 del diagnostico):
     el modelo heredado solo aceptaba CAJA como nodo intermedio de una
     ruta ("Punto 6" de TR_tramo_conexion_validar_secuencia, error 51017)
     — pero la regla fisica real de 015 (cable de campo -> terminal de
     GABINETE + cableado interno -> terminal de MODULO) exige que un
     GABINETE tambien pueda ser intermedio en el caso especifico
     GABINETE->MODULO. Busqueda exhaustiva confirmo que el UNICO trigger
     que impide esto es "Punto 6"; TR_senal_validar_canal_ruta y
     TR_tramo_conexion_validar_canal_ruta (001/012) solo validan el nodo
     FINAL de la ruta (via @ultimo, rn=1 ORDER BY numero_orden DESC) y no
     necesitan cambio alguno — en la topologia nueva el nodo final sigue
     siendo un punto de MODULO exactamente como siempre. "Punto 6" se
     divide en 3 chequeos: intermedios estrictamente antes del penultimo
     siguen exigiendo CAJA; el PENULTIMO admite CAJA o GABINETE; y si es
     GABINETE, el ultimo debe ser un MODULO que pertenezca FISICAMENTE a
     ese mismo gabinete (modulo->slot->rack->gabinete, error 51034) —
     rechaza GABINETE A -> MODULO de GABINETE B. Backend: connectionRoutes.ts
     no tenia validacion propia de "intermedios = solo caja" (solo traduce
     el 51017 de la BD a HTTP) — no requirio cambio de logica, solo un
     mensaje de error mas generico y el mapeo del nuevo 51034.

   - nucleo.conductor es la unidad fisica fundamental de un cable —
     nucleo.par_conductor (solo pares) no basta: el cable real
     "1-19c#14 AWG" (620-HV-5084, ver seccion 36.6) tiene 19 conductores
     individuales sin estructura de pares. par_conductor se preserva SIN
     ningun cambio de esquema ni de dato — pasa a ser una agrupacion
     OPCIONAL de conductores (conductor.par_conductor_id NULL), nunca la
     unidad fundamental. Sin restriccion de cardinalidad "exactamente 2
     por par" (existen configuraciones tipo triada/"Tr" en los datos que
     no encajan en "par" y para las que no se ha diseñado todavia un
     concepto general grupo_conductor — se deja abierto a proposito).
     conductor.codigo es NVARCHAR (no un entero) porque un hilo puede
     identificarse como "1", "2", "BK", "WH", "+", "-": no se asume que
     todo conductor se numera secuencialmente. conductor.cable_id es
     NOT NULL (un jumper interno gabinete->modulo usa una fila real de
     nucleo.cable con tipo_cable libre, ej. "JUMPER INTERNO" — no se creo
     ningun catalogo de jumpers ni se dejo cable_id nullable). Cuando
     conductor.par_conductor_id tiene valor, la base de datos (no solo el
     backend) garantiza que ese par pertenece al MISMO cable del
     conductor, via una clave candidata aditiva sobre par_conductor
     (id, cable_id, proyecto_id) y una FK compuesta de 3 columnas en
     conductor — un conductor no puede agruparse bajo un par de otro
     cable.

   - Exclusividad fisica de conductor: un CONDUCTOR fisico admite como
     maximo un TRAMO_CONDUCTOR activo (mismo principio que ya protegia el
     PAR_CONDUCTOR con UX_tramo_conexion_par_conductor_id). Un unico
     indice UNIQUE(conductor_id) WHERE activo=1 en tramo_conductor basta
     — es estrictamente mas fuerte que, e implica, un indice adicional
     sobre (tramo_conexion_id, conductor_id), que por eso NO se crea.

   - BLOQUE_TERMINAL es dueño XOR de exactamente una via: caja_id,
     gabinete_id o modulo_id — igual patron que punto_conexion (XOR de 5),
     pero acotado a estas 3 (no se modela borne de instrumento/equipo en
     esta fase, ver mas abajo). codigo es dato real, nunca hardcodeado a
     "TB" — soporta multiples bloques nombrados por dueño (TB1/TB2/X1/X2)
     aunque el Excel de referencia solo use la constante "TB" hoy.

   - TERMINAL pertenece a un bloque_terminal; NUNCA persiste listas tipo
     "1,2,3" o "F1-2" como su propia identidad — cada borne fisico
     individual es su propia fila (BORNERA "F1-2" -> dos filas TERMINAL,
     numero='F1' y numero='F2'). catalogo_modulo_io_terminal_id (NULL
     para caja/gabinete y para cualquier terminal manual) identifica un
     terminal MATERIALIZADO desde el catalogo de fabricante de un modulo.

   - POSICION_TERMINAL representa el clamp/lado fisico de aterrizaje de UN
     conductor dentro de un TERMINAL — necesaria porque un mismo terminal
     fisico admite legitimamente 2 aterrizajes simultaneos (cable de campo
     + cableado interno, ver el caso Gabinete TB1 -> Modulo mas abajo).
     codigo es libre (NO se asume universalmente A/B). Un terminal de
     modulo materializado recibe 1 posicion por defecto (sin evidencia de
     doble clamp del lado modulo); caja/gabinete admiten 1..N posiciones
     manuales.

   - cat.cat_modulo_io_terminal es 1:N por canal (catalogo_modulo_id +
     numero_canal + orden_terminal, NUNCA solo modelo+canal+etiqueta,
     porque una etiqueta puede repetirse legitimamente — el caso real
     RTD 3 hilos tiene 2 filas con la misma etiqueta "IN_0/A" para el
     mismo canal 0, distinguidas solo por orden_terminal). Sigue el
     mismo patron de "catalogo universal, sin proyecto_id, sin activo"
     de TODO cat.* (ver comentario de cabecera de la seccion 2 de
     001_initial_schema.sql) — un catalogo de hardware es dominio
     abierto (se agrega, no se retira), igual que cat.cat_modulo_io.

   - Integridad catalogo<->modulo instalado (obligatoria en BD, no solo
     backend): si un TERMINAL viene de catalogo Y su bloque_terminal
     pertenece a un modulo, el catalogo_modulo_id de esa fila de catalogo
     DEBE coincidir con el catalogo_modulo_id del modulo instalado — un
     terminal de un modelo de hardware distinto no puede materializarse
     en un modulo que no es de ese modelo. Se implementa con un trigger
     (TR_terminal_validar_catalogo_modulo), no con una FK compuesta —
     el cruce real es TERMINAL -> BLOQUE_TERMINAL -> MODULO por un lado y
     TERMINAL -> CAT_MODULO_IO_TERMINAL por otro, un salto multi-tabla
     que una FK simple no expresa (mismo criterio ya usado para
     TR_senal_validar_canal_ruta).

     CORRECCION DE DISEÑO ENCONTRADA AL IMPLEMENTAR: el indice
     "un numero por bloque" (UX_terminal_bloque_numero) NO puede aplicar
     sin filtrar a los terminales materializados desde catalogo — el caso
     real RTD (2 filas de catalogo con la misma etiqueta "IN_0/A" para el
     canal 0) generaria 2 TERMINAL con numero='IN_0/A' en el MISMO
     bloque_terminal del modulo, lo que un indice unico sin filtro
     rechazaria. Se filtra a WHERE catalogo_modulo_io_terminal_id IS NULL
     (solo terminales manuales de caja/gabinete) — los terminales de
     catalogo tienen su propia unicidad real via
     UX_terminal_bloque_catalogo (bloque_terminal_id,
     catalogo_modulo_io_terminal_id), que es la identidad correcta para
     ese caso (una fila de catalogo se materializa como maximo una vez
     por bloque, sin importar si su etiqueta se repite).

   - Alcance explicito de esta fase: NO se modelan bornes internos de
     instrumento/equipo — bloque_terminal no tiene esas vias de dueño.
     TR_terminacion_validar_propietario_y_canal rechaza cualquier intento
     de crear una TERMINACION cuyo extremo corresponda a un punto_conexion
     de tipo instrumento/equipo (no hay bloque_terminal valido al que
     pueda apuntar). En la practica, el extremo instrumento-side de un
     tramo instrumento->caja simplemente no tiene fila TERMINACION en
     015 — el CONDUCTOR existe igual via TRAMO_CONDUCTOR, solo su
     aterrizaje fisico del lado del instrumento no se modela todavia.
     Tampoco se implementan: importacion real de SENALES_CONTROL, parseo
     automatico de BORNE_JB o del formato legacy ambiguo "F1-F2-3-4",
     puentes/jumpers como dominio propio (el indice de ocupacion es
     relajable aditivamente mas adelante sin romper nada), B_NUM_RESERVA,
     generacion CAD, vw_conexionado definitiva, carga de datos real.

   - Materializacion de terminales de modulo: automatica e idempotente,
     TR_modulo_generar_terminales, simetrico en espiritu a
     TR_modulo_generar_canales (mismo filtro barato IF NOT
     UPDATE(catalogo_modulo_id), mismo criterio "bloquear si hay uso,
     nunca destruir/regenerar en silencio", mismo criterio "nunca
     reactivar una fila historica, siempre crear una nueva"). Ademas se
     crea el procedimiento nucleo.sp_sincronizar_terminales_modulo
     (logica equivalente, parametrizada por un solo @modulo_id) para el
     caso "el modulo ya esta instalado y se agregan filas nuevas a
     cat.cat_modulo_io_terminal despues" — agregar una fila de catalogo
     NO dispara ningun trigger de nucleo.modulo (la tabla modulo no
     cambio), asi que ese caso necesita una via explicita, invocable
     desde el backend. La logica esta deliberadamente duplicada (no
     factorizada en un llamado cruzado trigger->procedimiento) para
     evitar un CURSOR dentro del trigger — ambas via son 100% set-based.

   VERIFICACION DE DATOS REALES (SIEI_DEV, previa a aplicar esta
   migracion): nucleo.tramo_conexion / par_conductor / cable existen solo
   como fixtures de smoke tests en TEST-001 — cero dato real de produccion
   afectado por el ALTER de nullability. Las 6 tablas nuevas empiezan y
   terminan vacias.

   ESTRATEGIA TRANSACCIONAL: identica a 012/013/014 — SET XACT_ABORT ON +
   transaccion explicita abarcando todos los batches, aplicada con
   "sqlcmd -b" (aborta al primer error).
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO


/* ============================================================================
   0. VERIFICACION DE PRECONDICION E IDEMPOTENCIA
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'plano'
)
BEGIN
    THROW 55994, 'La migracion 015 requiere que 014_planos.sql se haya aplicado antes (falta nucleo.plano).', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'conductor'
)
BEGIN
    THROW 55995, 'La migracion 015 ya fue aplicada (nucleo.conductor ya existe).', 1;
END
GO


BEGIN TRANSACTION;


/* ============================================================================
   1. cat.cat_modulo_io_terminal — catalogo global de fabricante (1:N por
      canal). Mismo patron "sin proyecto_id, sin activo" de todo cat.*.
   ============================================================================ */

CREATE TABLE cat.cat_modulo_io_terminal (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    catalogo_modulo_id  BIGINT               NOT NULL,
    numero_canal        SMALLINT             NOT NULL,
    orden_terminal      SMALLINT             NOT NULL,
    etiqueta_terminal   NVARCHAR(50)         NOT NULL,
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_cat_modulo_io_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    CONSTRAINT PK_cat_modulo_io_terminal PRIMARY KEY (id),
    CONSTRAINT FK_cat_modulo_io_terminal_modulo FOREIGN KEY (catalogo_modulo_id) REFERENCES cat.cat_modulo_io (id)
);
GO

-- catalogo_modulo_id + numero_canal + etiqueta NO basta como identidad: el
-- caso real RTD tiene 2 filas con la MISMA etiqueta ("IN_0/A") para el
-- mismo canal — orden_terminal es la unica columna que las distingue.
CREATE UNIQUE INDEX UX_cat_modulo_io_terminal_modelo_canal_orden
    ON cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal);
GO


/* ============================================================================
   2. nucleo.conductor — unidad fisica fundamental de un cable
   ============================================================================ */

CREATE TABLE nucleo.conductor (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT               NOT NULL,
    cable_id          BIGINT               NOT NULL,
    codigo            NVARCHAR(20)         NOT NULL,
    orden             SMALLINT             NULL,
    par_conductor_id  BIGINT               NULL,
    activo            BIT                  NOT NULL CONSTRAINT DF_conductor_activo DEFAULT (1),
    created_at        DATETIME2            NOT NULL CONSTRAINT DF_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2            NULL,
    created_by        BIGINT               NULL,
    updated_by        BIGINT               NULL,
    CONSTRAINT PK_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_conductor_cable FOREIGN KEY (cable_id, proyecto_id) REFERENCES nucleo.cable (id, proyecto_id),
    CONSTRAINT FK_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_conductor_cable_codigo
    ON nucleo.conductor (cable_id, codigo)
    WHERE activo = 1;
GO


/* ============================================================================
   3. Clave candidata aditiva sobre par_conductor (tabla de 001, no se toca
      su archivo) — permite que la FK de conductor garantice en BD que un
      par referenciado pertenece al MISMO cable del conductor.
   ============================================================================ */

ALTER TABLE nucleo.par_conductor
    ADD CONSTRAINT UQ_par_conductor_id_cable_proyecto UNIQUE (id, cable_id, proyecto_id);
GO

-- FK compuesta de 3 columnas: si par_conductor_id es NULL, SQL Server no
-- evalua esta FK (semantica MATCH SIMPLE) — sin restriccion para
-- conductores sin par. Si tiene valor, exige que exista una fila
-- par_conductor con exactamente ese (id, cable_id, proyecto_id): un
-- conductor no puede agruparse bajo un par de un cable distinto al suyo.
ALTER TABLE nucleo.conductor
    ADD CONSTRAINT FK_conductor_par_mismo_cable
    FOREIGN KEY (par_conductor_id, cable_id, proyecto_id)
    REFERENCES nucleo.par_conductor (id, cable_id, proyecto_id);
GO


/* ============================================================================
   4. Evolucion legacy de tramo_conexion.par_conductor_id: NOT NULL -> NULL
   ============================================================================ */

ALTER TABLE nucleo.tramo_conexion ALTER COLUMN par_conductor_id BIGINT NULL;
GO

DROP INDEX UX_tramo_conexion_par_conductor_id ON nucleo.tramo_conexion;
GO

CREATE UNIQUE INDEX UX_tramo_conexion_par_conductor_id
    ON nucleo.tramo_conexion (par_conductor_id)
    WHERE par_conductor_id IS NOT NULL AND activo = 1;
GO


/* ============================================================================
   5. nucleo.bloque_terminal — dueño XOR de 3 vias (caja/gabinete/modulo)
   ============================================================================ */

CREATE TABLE nucleo.bloque_terminal (
    id            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id   BIGINT               NOT NULL,
    caja_id       BIGINT               NULL,
    gabinete_id   BIGINT               NULL,
    modulo_id     BIGINT               NULL,
    codigo        NVARCHAR(20)         NOT NULL,
    descripcion   NVARCHAR(200)        NULL,
    activo        BIT                  NOT NULL CONSTRAINT DF_bloque_terminal_activo DEFAULT (1),
    created_at    DATETIME2            NOT NULL CONSTRAINT DF_bloque_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2            NULL,
    created_by    BIGINT               NULL,
    updated_by    BIGINT               NULL,
    CONSTRAINT PK_bloque_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_bloque_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_bloque_terminal_pertenencia_xor CHECK (
        (IIF(caja_id IS NOT NULL, 1, 0) + IIF(gabinete_id IS NOT NULL, 1, 0) + IIF(modulo_id IS NOT NULL, 1, 0)) = 1
    ),
    CONSTRAINT FK_bloque_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_bloque_terminal_caja FOREIGN KEY (caja_id, proyecto_id) REFERENCES nucleo.caja (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_gabinete FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_modulo FOREIGN KEY (modulo_id, proyecto_id) REFERENCES nucleo.modulo (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_bloque_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- codigo es dato real (nunca hardcodeado) — soporta TB/TB1/TB2/X1/X2 por
-- dueño; un indice separado por columna de dueño porque el XOR ya
-- garantiza que solo una de las 3 esta poblada.
CREATE UNIQUE INDEX UX_bloque_terminal_caja_codigo
    ON nucleo.bloque_terminal (caja_id, codigo) WHERE caja_id IS NOT NULL AND activo = 1;
GO
CREATE UNIQUE INDEX UX_bloque_terminal_gabinete_codigo
    ON nucleo.bloque_terminal (gabinete_id, codigo) WHERE gabinete_id IS NOT NULL AND activo = 1;
GO
CREATE UNIQUE INDEX UX_bloque_terminal_modulo_codigo
    ON nucleo.bloque_terminal (modulo_id, codigo) WHERE modulo_id IS NOT NULL AND activo = 1;
GO


/* ============================================================================
   6. nucleo.terminal — terminal individual dentro de un bloque. NUNCA
      persiste listas ("1,2,3", "F1-2") como su propia identidad.
   ============================================================================ */

CREATE TABLE nucleo.terminal (
    id                              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                     BIGINT               NOT NULL,
    bloque_terminal_id              BIGINT               NOT NULL,
    numero                          NVARCHAR(20)         NOT NULL,
    catalogo_modulo_io_terminal_id  BIGINT               NULL,
    activo                          BIT                  NOT NULL CONSTRAINT DF_terminal_activo DEFAULT (1),
    created_at                      DATETIME2            NOT NULL CONSTRAINT DF_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at                      DATETIME2            NULL,
    created_by                      BIGINT               NULL,
    updated_by                      BIGINT               NULL,
    CONSTRAINT PK_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminal_bloque FOREIGN KEY (bloque_terminal_id, proyecto_id) REFERENCES nucleo.bloque_terminal (id, proyecto_id),
    CONSTRAINT FK_terminal_catalogo FOREIGN KEY (catalogo_modulo_io_terminal_id) REFERENCES cat.cat_modulo_io_terminal (id),
    CONSTRAINT FK_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Solo para terminales MANUALES (caja/gabinete, o un terminal de modulo
-- sin origen de catalogo): "numero" debe ser unico dentro del bloque.
-- CORRECCION DE DISEÑO (ver nota de cabecera): esto NO puede aplicar sin
-- filtro a los terminales de catalogo — el caso real RTD produce 2 filas
-- con numero='IN_0/A' en el mismo bloque de modulo, cada una identificada
-- por su propia fila de catalogo, no por su etiqueta.
CREATE UNIQUE INDEX UX_terminal_bloque_numero
    ON nucleo.terminal (bloque_terminal_id, numero)
    WHERE catalogo_modulo_io_terminal_id IS NULL AND activo = 1;
GO

-- Identidad real de un terminal MATERIALIZADO desde catalogo: una fila de
-- catalogo se materializa como maximo una vez por bloque.
CREATE UNIQUE INDEX UX_terminal_bloque_catalogo
    ON nucleo.terminal (bloque_terminal_id, catalogo_modulo_io_terminal_id)
    WHERE catalogo_modulo_io_terminal_id IS NOT NULL AND activo = 1;
GO


/* ============================================================================
   7. nucleo.posicion_terminal — clamp/lado fisico de aterrizaje dentro de
      un TERMINAL. codigo libre (NO se asume universalmente A/B).
   ============================================================================ */

CREATE TABLE nucleo.posicion_terminal (
    id            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id   BIGINT               NOT NULL,
    terminal_id   BIGINT               NOT NULL,
    codigo        NVARCHAR(10)         NOT NULL,
    activo        BIT                  NOT NULL CONSTRAINT DF_posicion_terminal_activo DEFAULT (1),
    created_at    DATETIME2            NOT NULL CONSTRAINT DF_posicion_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2            NULL,
    created_by    BIGINT               NULL,
    updated_by    BIGINT               NULL,
    CONSTRAINT PK_posicion_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_posicion_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_posicion_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_posicion_terminal_terminal FOREIGN KEY (terminal_id, proyecto_id) REFERENCES nucleo.terminal (id, proyecto_id),
    CONSTRAINT FK_posicion_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_posicion_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_posicion_terminal_terminal_codigo
    ON nucleo.posicion_terminal (terminal_id, codigo)
    WHERE activo = 1;
GO


/* ============================================================================
   8. nucleo.tramo_conductor — que CONDUCTOR participa en que TRAMO_CONEXION
   ============================================================================ */

CREATE TABLE nucleo.tramo_conductor (
    id                 BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id        BIGINT               NOT NULL,
    tramo_conexion_id  BIGINT               NOT NULL,
    conductor_id       BIGINT               NOT NULL,
    activo             BIT                  NOT NULL CONSTRAINT DF_tramo_conductor_activo DEFAULT (1),
    created_at         DATETIME2            NOT NULL CONSTRAINT DF_tramo_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at         DATETIME2            NULL,
    created_by         BIGINT               NULL,
    updated_by         BIGINT               NULL,
    CONSTRAINT PK_tramo_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_tramo_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tramo_conductor_tramo FOREIGN KEY (tramo_conexion_id, proyecto_id) REFERENCES nucleo.tramo_conexion (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_conductor FOREIGN KEY (conductor_id, proyecto_id) REFERENCES nucleo.conductor (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tramo_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Exclusividad fisica: un CONDUCTOR admite como maximo un TRAMO_CONDUCTOR
-- activo, sin importar de que tramo se trate. Estrictamente mas fuerte
-- que (tramo_conexion_id, conductor_id) y la implica — por eso NO se crea
-- un segundo indice sobre ese par (ver nota de cabecera).
CREATE UNIQUE INDEX UX_tramo_conductor_conductor_exclusivo
    ON nucleo.tramo_conductor (conductor_id)
    WHERE activo = 1;
GO


/* ============================================================================
   9. nucleo.terminacion — el hecho fisico: conductor+tramo+extremo -> una
      posicion de terminal
   ============================================================================ */

CREATE TABLE nucleo.terminacion (
    id                    BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id           BIGINT               NOT NULL,
    tramo_conductor_id    BIGINT               NOT NULL,
    posicion_terminal_id  BIGINT               NOT NULL,
    extremo               NVARCHAR(10)         NOT NULL,
    activo                BIT                  NOT NULL CONSTRAINT DF_terminacion_activo DEFAULT (1),
    created_at            DATETIME2            NOT NULL CONSTRAINT DF_terminacion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at            DATETIME2            NULL,
    created_by            BIGINT               NULL,
    updated_by            BIGINT               NULL,
    CONSTRAINT PK_terminacion PRIMARY KEY (id),
    CONSTRAINT UQ_terminacion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_terminacion_extremo CHECK (extremo IN (N'ORIGEN', N'DESTINO')),
    CONSTRAINT FK_terminacion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminacion_tramo_conductor FOREIGN KEY (tramo_conductor_id, proyecto_id) REFERENCES nucleo.tramo_conductor (id, proyecto_id),
    CONSTRAINT FK_terminacion_posicion FOREIGN KEY (posicion_terminal_id, proyecto_id) REFERENCES nucleo.posicion_terminal (id, proyecto_id),
    CONSTRAINT FK_terminacion_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminacion_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Un conductor, en un tramo, tiene a lo sumo una terminacion por extremo.
-- Deliberadamente NO exige que ambos extremos existan (ingenieria
-- incompleta valida: solo ORIGEN, solo DESTINO, ambos, o ninguno).
CREATE UNIQUE INDEX UX_terminacion_tramo_conductor_extremo
    ON nucleo.terminacion (tramo_conductor_id, extremo)
    WHERE activo = 1;
GO

-- Ocupacion: una posicion de terminal admite como maximo una terminacion
-- activa. El terminal (un nivel arriba) puede sostener 2+ aterrizajes
-- simultaneos siempre que sean POSICIONES distintas (caso Gabinete
-- TB1 -> Modulo, ver seccion 38.10 del diagnostico) — por eso la
-- exclusividad vive aqui, no en terminal_id.
CREATE UNIQUE INDEX UX_terminacion_posicion_ocupacion
    ON nucleo.terminacion (posicion_terminal_id)
    WHERE activo = 1;
GO


/* ============================================================================
   10. Recreacion de triggers legacy afectados por el ALTER de
       tramo_conexion.par_conductor_id (DROP + CREATE, cuerpo identico al
       original salvo lo estrictamente necesario — ver nota de cabecera).
   ============================================================================ */

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_tramo_conexion_validar_secuencia')
BEGIN
    THROW 55996, 'Falta TR_tramo_conexion_validar_secuencia (revisar 001/012).', 1;
END
GO

DROP TRIGGER nucleo.TR_tramo_conexion_validar_secuencia;
GO

-- 10.1 TR_tramo_conexion_validar_secuencia — cuerpo identico al vigente
--      (001_initial_schema.sql, recreado sin cambio funcional en
--      012_gabinetes.sql salvo rio_id->gabinete_id) salvo:
--      (a) @activos.par_conductor_id pasa de NOT NULL a NULL;
--      (b) el chequeo "Punto 4" (recursos activos) cambia sus JOIN a
--          par_conductor/cable de INNER a LEFT, y la condicion de cable
--          exige ademas pc.id IS NOT NULL — un tramo del modelo nuevo
--          (par_conductor_id NULL) sigue validando que sus punto_conexion
--          esten activos, simplemente no evalua por esta via el
--          sub-chequeo de "cable activo" (ese camino se cubre aparte,
--          extendiendo TR_cable_validar_desactivacion mas abajo);
--      (c) "Punto 6" se divide en 3 chequeos (revision bloqueante
--          posterior a la primera version de 015, ver seccion 41 del
--          diagnostico): un nodo intermedio estrictamente antes del
--          penultimo sigue exigiendo CAJA sin excepcion; el PENULTIMO
--          nodo (si existe) admite CAJA o, novedad de 015, GABINETE —
--          soporta CAJA?->GABINETE->MODULO e INSTRUMENTO->GABINETE->
--          MODULO directo (cable de campo a un terminal de gabinete +
--          cableado interno a un terminal de modulo); y si el penultimo
--          es GABINETE, el ultimo debe ser un MODULO que pertenezca
--          FISICAMENTE a ese mismo gabinete (modulo->slot->rack->
--          gabinete) — rechaza GABINETE A -> MODULO de GABINETE B.
CREATE TRIGGER nucleo.TR_tramo_conexion_validar_secuencia ON nucleo.tramo_conexion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rutas TABLE (ruta_conexion_id BIGINT PRIMARY KEY);
    INSERT INTO @rutas
        SELECT DISTINCT ruta_conexion_id FROM inserted
        UNION
        SELECT DISTINCT ruta_conexion_id FROM deleted;

    IF NOT EXISTS (SELECT 1 FROM @rutas) RETURN;

    DECLARE @activos TABLE (
        tramo_id            BIGINT PRIMARY KEY,
        ruta_conexion_id    BIGINT   NOT NULL,
        numero_orden        SMALLINT NOT NULL,
        punto_origen_id     BIGINT   NOT NULL,
        punto_destino_id    BIGINT   NOT NULL,
        par_conductor_id    BIGINT   NULL,
        rn                  BIGINT   NOT NULL,
        total               INT      NOT NULL,
        siguiente_origen    BIGINT   NULL
    );

    INSERT INTO @activos (tramo_id, ruta_conexion_id, numero_orden, punto_origen_id, punto_destino_id, par_conductor_id, rn, total, siguiente_origen)
    SELECT t.id, t.ruta_conexion_id, t.numero_orden, t.punto_origen_id, t.punto_destino_id, t.par_conductor_id,
           ROW_NUMBER() OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden),
           COUNT(*)     OVER (PARTITION BY t.ruta_conexion_id),
           LEAD(t.punto_origen_id) OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden)
    FROM nucleo.tramo_conexion t
    WHERE t.activo = 1 AND t.ruta_conexion_id IN (SELECT ruta_conexion_id FROM @rutas);

    IF EXISTS (SELECT 1 FROM @activos WHERE numero_orden <> rn)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51004, 'numero_orden no es consecutivo dentro de la ruta.', 1;
    END

    IF EXISTS (SELECT 1 FROM @activos WHERE rn < total AND punto_destino_id <> siguiente_origen)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51005, 'El destino de un tramo no coincide con el origen del siguiente.', 1;
    END

    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        JOIN nucleo.senal s ON s.id = r.senal_id
        JOIN nucleo.punto_conexion p ON p.id = a.punto_origen_id
        WHERE a.rn = 1
          AND ((s.instrumento_id IS NOT NULL AND ISNULL(p.instrumento_id, -1) <> s.instrumento_id)
            OR (s.equipo_id      IS NOT NULL AND ISNULL(p.equipo_id, -1)      <> s.equipo_id))
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51006, 'El origen del primer tramo no corresponde al dueño real de la senal.', 1;
    END

    IF EXISTS (
        SELECT 1 FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn = a.total AND p.gabinete_id IS NULL AND p.modulo_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51007, 'El ultimo tramo no termina en un punto de GABINETE o MODULO.', 1;
    END

    -- Punto 4: recursos usados por un tramo activo deben estar activos.
    -- LEFT JOIN a par_conductor/cable (antes INNER): un tramo del modelo
    -- nuevo (par_conductor_id NULL) no se excluye del chequeo de puntos
    -- activos solo por no tener par legacy.
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion po ON po.id = a.punto_origen_id
        JOIN nucleo.punto_conexion pd ON pd.id = a.punto_destino_id
        LEFT JOIN nucleo.par_conductor pc ON pc.id = a.par_conductor_id
        LEFT JOIN nucleo.cable cb ON cb.id = pc.cable_id
        WHERE po.activo = 0 OR pd.activo = 0 OR (pc.id IS NOT NULL AND cb.activo = 0)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51015, 'Un tramo activo no puede usar puntos de conexion o cable inactivos.', 1;
    END

    -- Punto 6 (revisado en 015 — topologia GABINETE intermedio, ver
    -- seccion 41 del diagnostico): un nodo intermedio ESTRICTAMENTE antes
    -- del penultimo sigue debiendo ser CAJA, sin excepcion.
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn < a.total - 1 AND p.caja_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'Un nodo intermedio de la ruta debe corresponder a una CAJA.', 1;
    END

    -- Punto 6b (nuevo en 015): el PENULTIMO nodo (si existe, total > 1)
    -- puede ser CAJA (como siempre) o, novedad de 015, GABINETE — para
    -- soportar CAJA?->GABINETE->MODULO / INSTRUMENTO->GABINETE->MODULO
    -- (cable de campo a un terminal de gabinete + cableado interno a un
    -- terminal de modulo). MODULO nunca puede ser penultimo: un modulo
    -- solo puede ser el nodo FINAL de la ruta.
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn = a.total - 1 AND a.total > 1
          AND p.caja_id IS NULL AND p.gabinete_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'El penultimo nodo de la ruta debe corresponder a una CAJA o un GABINETE.', 1;
    END

    -- Punto 6c (nuevo en 015): si el penultimo nodo es un GABINETE, el
    -- ultimo nodo debe ser un MODULO (nunca otro GABINETE) que pertenezca
    -- FISICAMENTE a ese mismo gabinete (modulo -> slot -> rack ->
    -- gabinete) — rechaza GABINETE A -> MODULO de GABINETE B aunque
    -- ambos sean del mismo proyecto.
    IF EXISTS (
        SELECT 1
        FROM @activos aPenult
        JOIN nucleo.punto_conexion pPenult ON pPenult.id = aPenult.punto_destino_id AND pPenult.gabinete_id IS NOT NULL
        JOIN @activos aFinal ON aFinal.ruta_conexion_id = aPenult.ruta_conexion_id AND aFinal.rn = aFinal.total
        JOIN nucleo.punto_conexion pFinal ON pFinal.id = aFinal.punto_destino_id
        LEFT JOIN nucleo.modulo m  ON m.id = pFinal.modulo_id
        LEFT JOIN nucleo.slot  sl ON sl.id = m.slot_id
        LEFT JOIN nucleo.rack  rk ON rk.id = sl.rack_id
        WHERE aPenult.rn = aPenult.total - 1 AND aPenult.total > 1
          AND (pFinal.modulo_id IS NULL OR rk.gabinete_id IS NULL OR rk.gabinete_id <> pPenult.gabinete_id)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51034, 'Si el penultimo nodo es un GABINETE, el ultimo debe ser un MODULO que pertenezca fisicamente a ese mismo gabinete.', 1;
    END

    -- Punto 4(b): un tramo activo requiere que su ruta padre este activa
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        WHERE r.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51023, 'Un TRAMO_CONEXION activo requiere una RUTA_CONEXION activa.', 1;
    END
END
GO


IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_cable_validar_desactivacion')
BEGIN
    THROW 55997, 'Falta TR_cable_validar_desactivacion (revisar 001_initial_schema.sql).', 1;
END
GO

DROP TRIGGER nucleo.TR_cable_validar_desactivacion;
GO

-- 10.2 TR_cable_validar_desactivacion — se EXTIENDE (no solo se adapta):
--      un cable puede estar "en uso" tanto por un par_conductor legacy
--      referenciado desde tramo_conexion.par_conductor_id como por un
--      conductor propio referenciado desde tramo_conductor.conductor_id.
--      Mismo codigo de error (51021): es la MISMA regla de negocio,
--      ampliada a los dos caminos posibles.
CREATE TRIGGER nucleo.TR_cable_validar_desactivacion ON nucleo.cable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        WHERE d.activo = 1 AND i.activo = 0
          AND (
                EXISTS (  -- camino legacy: par_conductor + tramo_conexion.par_conductor_id
                    SELECT 1 FROM nucleo.par_conductor pc
                    JOIN nucleo.tramo_conexion t ON t.par_conductor_id = pc.id AND t.activo = 1
                    WHERE pc.cable_id = i.id
                )
             OR EXISTS (  -- camino nuevo: conductor + tramo_conductor
                    SELECT 1 FROM nucleo.conductor c
                    JOIN nucleo.tramo_conductor tc ON tc.conductor_id = c.id AND tc.activo = 1
                    WHERE c.cable_id = i.id
                )
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51021, 'No se puede desactivar un CABLE cuyo PAR_CONDUCTOR o CONDUCTOR participa en un TRAMO activo.', 1;
    END
END
GO


/* ============================================================================
   11. TR_terminal_validar_catalogo_modulo — integridad catalogo<->modulo
       instalado (punto 6 del pedido de implementacion): un TERMINAL
       materializado desde catalogo cuyo bloque pertenece a un MODULO debe
       venir de una fila de catalogo del MISMO catalogo_modulo_id del
       modulo instalado.
   ============================================================================ */

CREATE TRIGGER nucleo.TR_terminal_validar_catalogo_modulo ON nucleo.terminal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(catalogo_modulo_io_terminal_id) AND NOT UPDATE(bloque_terminal_id) RETURN;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN nucleo.bloque_terminal bt ON bt.id = i.bloque_terminal_id AND bt.modulo_id IS NOT NULL
        JOIN nucleo.modulo m ON m.id = bt.modulo_id
        JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = i.catalogo_modulo_io_terminal_id
        WHERE i.catalogo_modulo_io_terminal_id IS NOT NULL
          AND cmit.catalogo_modulo_id <> m.catalogo_modulo_id
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51026, 'El terminal de catalogo no pertenece al mismo catalogo_modulo_id del modulo instalado.', 1;
    END
END
GO


/* ============================================================================
   12. TR_terminacion_validar_propietario_y_canal (puntos 10/11/13 del
       pedido de implementacion): (a) el dueño del bloque_terminal debe
       coincidir con el dueño real del punto_conexion del extremo del
       tramo — rechaza cross-owner y rechaza instrumento/equipo (fuera de
       alcance en 015); (b) si el terminal es de modulo y viene de
       catalogo, su numero_canal debe coincidir con el canal real de la
       señal de esa ruta.
   ============================================================================ */

CREATE TRIGGER nucleo.TR_terminacion_validar_propietario_y_canal ON nucleo.terminacion
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- (a) propietario del bloque_terminal vs. propietario real del
    --     punto_conexion del extremo correspondiente del tramo.
    IF EXISTS (
        SELECT 1
        FROM inserted te
        JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id
        JOIN nucleo.tramo_conexion tc   ON tc.id = tcd.tramo_conexion_id
        JOIN nucleo.punto_conexion pto  ON pto.id = CASE te.extremo WHEN N'ORIGEN' THEN tc.punto_origen_id ELSE tc.punto_destino_id END
        JOIN nucleo.posicion_terminal pos ON pos.id = te.posicion_terminal_id
        JOIN nucleo.terminal ter        ON ter.id = pos.terminal_id
        JOIN nucleo.bloque_terminal bt  ON bt.id = ter.bloque_terminal_id
        WHERE te.activo = 1
          AND (
                (pto.caja_id        IS NOT NULL AND ISNULL(bt.caja_id, -1)     <> pto.caja_id)
             OR (pto.gabinete_id    IS NOT NULL AND ISNULL(bt.gabinete_id, -1) <> pto.gabinete_id)
             OR (pto.modulo_id      IS NOT NULL AND ISNULL(bt.modulo_id, -1)   <> pto.modulo_id)
             OR (pto.instrumento_id IS NOT NULL)   -- sin bloque_terminal de instrumento en 015
             OR (pto.equipo_id      IS NOT NULL)   -- idem equipo
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51024, 'La terminacion no pertenece al mismo propietario que el punto_conexion del extremo del tramo.', 1;
    END

    -- (b) si el terminal es de modulo y viene de catalogo, el numero_canal
    --     del catalogo debe coincidir con el canal real de la señal de la ruta.
    IF EXISTS (
        SELECT 1
        FROM inserted te
        JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id
        JOIN nucleo.tramo_conexion tc   ON tc.id = tcd.tramo_conexion_id
        JOIN nucleo.ruta_conexion rc    ON rc.id = tc.ruta_conexion_id
        JOIN nucleo.senal sg            ON sg.id = rc.senal_id AND sg.canal_id IS NOT NULL
        JOIN nucleo.canal cn            ON cn.id = sg.canal_id
        JOIN nucleo.posicion_terminal pos ON pos.id = te.posicion_terminal_id
        JOIN nucleo.terminal ter        ON ter.id = pos.terminal_id
        JOIN nucleo.bloque_terminal bt  ON bt.id = ter.bloque_terminal_id AND bt.modulo_id IS NOT NULL
        JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = ter.catalogo_modulo_io_terminal_id
        WHERE te.activo = 1
          AND (cn.modulo_id <> bt.modulo_id OR cn.numero_canal <> cmit.numero_canal)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51025, 'La terminacion en un terminal de modulo no corresponde al canal real de la señal.', 1;
    END
END
GO


/* ============================================================================
   13. TR_modulo_generar_terminales — materializacion automatica e
       idempotente, simetrica en espiritu a TR_modulo_generar_canales
       (001_initial_schema.sql linea 804). Solo actua sobre modulos NUEVOS
       o cuyo catalogo_modulo_id cambio REALMENTE de valor.
   ============================================================================ */

CREATE TRIGGER nucleo.TR_modulo_generar_terminales ON nucleo.modulo
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(catalogo_modulo_id) RETURN;  -- filtro barato: ¿participó la columna?

    DECLARE @modulos TABLE (
        modulo_id           BIGINT PRIMARY KEY,
        proyecto_id         BIGINT NOT NULL,
        catalogo_modulo_id  BIGINT NOT NULL,
        created_by          BIGINT NULL
    );

    INSERT INTO @modulos (modulo_id, proyecto_id, catalogo_modulo_id, created_by)
    SELECT i.id, i.proyecto_id, i.catalogo_modulo_id, i.created_by
    FROM inserted i
    LEFT JOIN deleted d ON d.id = i.id
    WHERE d.id IS NULL OR d.catalogo_modulo_id <> i.catalogo_modulo_id;

    IF NOT EXISTS (SELECT 1 FROM @modulos) RETURN;

    -- 1. asegurar bloque_terminal del modulo (idempotente, 1 por modulo)
    INSERT INTO nucleo.bloque_terminal (proyecto_id, modulo_id, codigo, activo, created_at, created_by)
    SELECT m.proyecto_id, m.modulo_id, N'MODULO', 1, SYSUTCDATETIME(), m.created_by
    FROM @modulos m
    WHERE NOT EXISTS (
        SELECT 1 FROM nucleo.bloque_terminal bt WHERE bt.modulo_id = m.modulo_id AND bt.activo = 1
    );

    -- 2. bloqueo: si el catalogo cambio y algun terminal que dejaria de
    --    pertenecer al catalogo vigente tiene una posicion ocupada,
    --    aborta TODO el lote — nunca destruye/regenera en silencio (mismo
    --    criterio que TR_modulo_generar_canales con canales fuera de
    --    rango en uso, error 51001).
    IF EXISTS (
        SELECT 1
        FROM @modulos m
        JOIN nucleo.bloque_terminal bt ON bt.modulo_id = m.modulo_id AND bt.activo = 1
        JOIN nucleo.terminal t ON t.bloque_terminal_id = bt.id AND t.activo = 1
        JOIN nucleo.posicion_terminal pt ON pt.terminal_id = t.id AND pt.activo = 1
        JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
        WHERE t.catalogo_modulo_io_terminal_id IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM cat.cat_modulo_io_terminal cmit
                WHERE cmit.id = t.catalogo_modulo_io_terminal_id
                  AND cmit.catalogo_modulo_id = m.catalogo_modulo_id
           )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51027, 'No se puede cambiar el catalogo del modulo: hay un terminal ocupado que dejaria de pertenecer al catalogo vigente.', 1;
    END

    -- 3. desactivar terminales/posiciones que ya no pertenecen al catalogo
    --    vigente (sin ocupacion, ya verificado en el paso 2). Nunca
    --    reactiva una fila historica (mismo criterio "FIX #3" que
    --    TR_modulo_generar_canales ya aplica a los canales).
    UPDATE pt SET pt.activo = 0, pt.updated_at = SYSUTCDATETIME(), pt.updated_by = m.created_by
    FROM nucleo.posicion_terminal pt
    JOIN nucleo.terminal t ON t.id = pt.terminal_id
    JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id
    JOIN @modulos m ON m.modulo_id = bt.modulo_id
    WHERE pt.activo = 1 AND t.activo = 1
      AND (t.catalogo_modulo_io_terminal_id IS NULL
           OR NOT EXISTS (
                SELECT 1 FROM cat.cat_modulo_io_terminal cmit
                WHERE cmit.id = t.catalogo_modulo_io_terminal_id
                  AND cmit.catalogo_modulo_id = m.catalogo_modulo_id
           ));

    UPDATE t SET t.activo = 0, t.updated_at = SYSUTCDATETIME(), t.updated_by = m.created_by
    FROM nucleo.terminal t
    JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id
    JOIN @modulos m ON m.modulo_id = bt.modulo_id
    WHERE t.activo = 1
      AND t.catalogo_modulo_io_terminal_id IS NOT NULL
      AND NOT EXISTS (
            SELECT 1 FROM cat.cat_modulo_io_terminal cmit
            WHERE cmit.id = t.catalogo_modulo_io_terminal_id
              AND cmit.catalogo_modulo_id = m.catalogo_modulo_id
      );

    -- 4. crear terminales faltantes del catalogo vigente (idempotente)
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero, catalogo_modulo_io_terminal_id, activo, created_at, created_by)
    SELECT m.proyecto_id, bt.id, cmit.etiqueta_terminal, cmit.id, 1, SYSUTCDATETIME(), m.created_by
    FROM @modulos m
    JOIN nucleo.bloque_terminal bt ON bt.modulo_id = m.modulo_id AND bt.activo = 1
    JOIN cat.cat_modulo_io_terminal cmit ON cmit.catalogo_modulo_id = m.catalogo_modulo_id
    WHERE NOT EXISTS (
        SELECT 1 FROM nucleo.terminal t
        WHERE t.bloque_terminal_id = bt.id AND t.catalogo_modulo_io_terminal_id = cmit.id AND t.activo = 1
    );

    -- 5. 1 posicion_terminal por defecto para cada terminal sin ninguna
    --    (politica cerrada para 015: sin evidencia de doble clamp del
    --    lado modulo — ver seccion 39.12 del diagnostico).
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo, activo, created_at, created_by)
    SELECT t.proyecto_id, t.id, N'A', 1, SYSUTCDATETIME(), m.created_by
    FROM nucleo.terminal t
    JOIN nucleo.bloque_terminal bt ON bt.id = t.bloque_terminal_id
    JOIN @modulos m ON m.modulo_id = bt.modulo_id
    WHERE t.activo = 1
      AND NOT EXISTS (SELECT 1 FROM nucleo.posicion_terminal pt WHERE pt.terminal_id = t.id AND pt.activo = 1);
END
GO


/* ============================================================================
   14. nucleo.sp_sincronizar_terminales_modulo — sincronizacion bajo
       demanda para el caso "modulo ya instalado + filas nuevas agregadas
       despues a cat.cat_modulo_io_terminal" (punto 15 del pedido): agregar
       una fila de catalogo NO dispara ningun trigger de nucleo.modulo (esa
       tabla no cambio), asi que este caso necesita una via explicita,
       invocable desde el backend. Logica equivalente a los pasos 1/2/4/5
       del trigger de arriba, deliberadamente duplicada (no factorizada via
       un llamado cruzado trigger<->procedimiento) para mantener ambas
       vias 100% set-based, sin CURSOR. Requiere ejecutarse dentro de una
       transaccion ya abierta por el llamador (igual que cualquier trigger
       de este esquema: el ROLLBACK TRANSACTION de este procedimiento
       revierte la transaccion del llamador, no crea una propia).
   ============================================================================ */

CREATE PROCEDURE nucleo.sp_sincronizar_terminales_modulo
    @modulo_id   BIGINT,
    @actor_id    BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @proyecto_id BIGINT, @catalogo_modulo_id BIGINT;
    SELECT @proyecto_id = proyecto_id, @catalogo_modulo_id = catalogo_modulo_id
    FROM nucleo.modulo
    WHERE id = @modulo_id AND activo = 1;

    IF @proyecto_id IS NULL
    BEGIN
        THROW 51032, 'El modulo no existe en este proyecto o esta inactivo.', 1;
    END

    -- 1. asegurar bloque_terminal del modulo (idempotente)
    DECLARE @bloque_id BIGINT;
    SELECT @bloque_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @modulo_id AND activo = 1;

    IF @bloque_id IS NULL
    BEGIN
        INSERT INTO nucleo.bloque_terminal (proyecto_id, modulo_id, codigo, activo, created_at, created_by)
        VALUES (@proyecto_id, @modulo_id, N'MODULO', 1, SYSUTCDATETIME(), @actor_id);
        SET @bloque_id = SCOPE_IDENTITY();
    END

    -- 2. crear terminales faltantes desde el catalogo vigente (NOT EXISTS = idempotente)
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero, catalogo_modulo_io_terminal_id, activo, created_at, created_by)
    SELECT @proyecto_id, @bloque_id, cmit.etiqueta_terminal, cmit.id, 1, SYSUTCDATETIME(), @actor_id
    FROM cat.cat_modulo_io_terminal cmit
    WHERE cmit.catalogo_modulo_id = @catalogo_modulo_id
      AND NOT EXISTS (
          SELECT 1 FROM nucleo.terminal t
          WHERE t.bloque_terminal_id = @bloque_id
            AND t.catalogo_modulo_io_terminal_id = cmit.id
            AND t.activo = 1
      );

    -- 3. 1 posicion_terminal por defecto para cada terminal recien creado sin ninguna
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo, activo, created_at, created_by)
    SELECT t.proyecto_id, t.id, N'A', 1, SYSUTCDATETIME(), @actor_id
    FROM nucleo.terminal t
    WHERE t.bloque_terminal_id = @bloque_id
      AND t.activo = 1
      AND NOT EXISTS (SELECT 1 FROM nucleo.posicion_terminal pt WHERE pt.terminal_id = t.id AND pt.activo = 1);
END
GO


/* ============================================================================
   15. Cascada logica hacia abajo: TRAMO_CONEXION -> TRAMO_CONDUCTOR ->
       TERMINACION (misma transicion-real-1->0 de TR_ruta_conexion_
       desactivar_tramos, 001_initial_schema.sql linea 1116).
   ============================================================================ */

CREATE TRIGGER nucleo.TR_tramo_conexion_desactivar_conductores ON nucleo.tramo_conexion
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;  -- filtro barato: ¿participó la columna?

    UPDATE tcd SET tcd.activo = 0
    FROM nucleo.tramo_conductor tcd
    JOIN inserted i ON i.id = tcd.tramo_conexion_id
    JOIN deleted  d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0   -- transicion real 1 -> 0
      AND tcd.activo = 1;
END
GO

CREATE TRIGGER nucleo.TR_tramo_conductor_desactivar_terminaciones ON nucleo.tramo_conductor
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    UPDATE te SET te.activo = 0
    FROM nucleo.terminacion te
    JOIN inserted i ON i.id = te.tramo_conductor_id
    JOIN deleted  d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0
      AND te.activo = 1;
END
GO


/* ============================================================================
   16. Recursos en uso no se desactivan (mismo idioma que TR_cable_validar_
       desactivacion / TR_punto_conexion_validar_desactivacion): rechaza,
       nunca desasigna en silencio.
   ============================================================================ */

CREATE TRIGGER nucleo.TR_conductor_validar_desactivacion ON nucleo.conductor
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.tramo_conductor tc ON tc.conductor_id = i.id AND tc.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51028, 'No se puede desactivar un CONDUCTOR que participa en un TRAMO_CONDUCTOR activo.', 1;
    END
END
GO

CREATE TRIGGER nucleo.TR_posicion_terminal_validar_desactivacion ON nucleo.posicion_terminal
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.terminacion te ON te.posicion_terminal_id = i.id AND te.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51029, 'No se puede desactivar una POSICION_TERMINAL con una TERMINACION activa.', 1;
    END
END
GO

-- TR_terminal_validar_desactivacion combina las dos mitades de la
-- politica pedida: (a) BLOQUEA si alguna posicion esta ocupada; (b) si no
-- hay ocupacion, CASCADEA hacia abajo desactivando sus POSICION_TERMINAL
-- — nunca deja un terminal inactivo con una posicion todavia activa.
CREATE TRIGGER nucleo.TR_terminal_validar_desactivacion ON nucleo.terminal
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.posicion_terminal pt ON pt.terminal_id = i.id AND pt.activo = 1
        JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51030, 'No se puede desactivar un TERMINAL con una posicion ocupada.', 1;
    END

    UPDATE pt SET pt.activo = 0
    FROM nucleo.posicion_terminal pt
    JOIN inserted i ON i.id = pt.terminal_id
    JOIN deleted d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0 AND pt.activo = 1;
END
GO

-- Mismo criterio combinado que TR_terminal_validar_desactivacion:
-- BLOQUEA si algun terminal tiene una posicion ocupada; si no, CASCADEA
-- hacia abajo desactivando sus TERMINAL — esa misma UPDATE dispara (en
-- cascada anidada, habilitada por defecto en SQL Server) el trigger de
-- arriba, que a su vez desactiva las POSICION_TERMINAL de cada terminal.
-- Nunca deja "padre activo=0, hijo activo=1" en ningun nivel.
CREATE TRIGGER nucleo.TR_bloque_terminal_validar_desactivacion ON nucleo.bloque_terminal
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.id = i.id
        JOIN nucleo.terminal t ON t.bloque_terminal_id = i.id AND t.activo = 1
        JOIN nucleo.posicion_terminal pt ON pt.terminal_id = t.id AND pt.activo = 1
        JOIN nucleo.terminacion te ON te.posicion_terminal_id = pt.id AND te.activo = 1
        WHERE d.activo = 1 AND i.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51031, 'No se puede desactivar un BLOQUE_TERMINAL con un terminal ocupado.', 1;
    END

    UPDATE t SET t.activo = 0
    FROM nucleo.terminal t
    JOIN inserted i ON i.id = t.bloque_terminal_id
    JOIN deleted d ON d.id = i.id
    WHERE d.activo = 1 AND i.activo = 0 AND t.activo = 1;
END
GO


COMMIT TRANSACTION;
GO
