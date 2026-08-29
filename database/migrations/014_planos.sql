/* =============================================================================
   014_planos.sql — SIEI
   Primer registro estructural del dominio PLANO: identidad del dibujo de
   ingenieria (nucleo.plano), catalogo de tipos (cat.cat_tipo_plano), y sus
   relaciones N:M reales con gabinete/caja (nucleo.gabinete_plano,
   nucleo.caja_plano). No importa datos del Excel de referencia — deja las
   3 tablas nuevas vacias, listas para una futura carga real.

   CONTEXTO / DECISIONES DE NEGOCIO (aprobadas explicitamente por el
   usuario tras el diseño tecnico exacto documentado en
   docs/DIAGNOSTICO_SENALES_GABINETES.md, seccion 35):

   - PLANO = identidad viva del dibujo de ingenieria, separado a proposito
     de ENTREGABLE/REVISION_ENTREGABLE (documento generado por SIEI desde
     plantilla, hoy solo LDI). Un plano puede existir sin ninguna revision
     controlada emitida jamas — de hecho, 014 no crea ningun concepto de
     revision de plano en absoluto (ver mas abajo).

   - Tipos de plano (cat.cat_tipo_plano): confirmados con evidencia real
     contra reference_excel/02_MASTER_IO_620.xlsm, hoja PLANOS (40 filas
     reales) — CONEXIONADO (33 filas, "DIAGRAMA(S) DE CONEXIONADO"),
     LAYOUT (5 filas, prefijo "PE -", verificado 1:1 contra la palabra
     "LAYOUT" en la descripcion), UNIFILAR (2 filas reales e inequivocas,
     "DIAGRAMA UNIFILAR" — suministro 480V y centro de control de
     motores, un tipo de dibujo electrico genuinamente distinto),
     INTERIOR_GABINETE (no aparece como fila propia en PLANOS, pero
     PLANOS.PLANO_CONEX_INTERIOR es, con evidencia real, un SEGUNDO
     codigo de plano constante por gabinete — nunca aparece en una fila
     cuyo TABLERO sea una caja — que se materializara como su propio
     registro nucleo.plano de este tipo al importar). NO se agrega
     GANCHO: PLANO_GANCHO solo existe en SENALES_CONTROL, y el 83% de sus
     valores coinciden literalmente con un CODIGO ya existente en
     PLANOS — es una referencia de SEÑAL hacia un plano ya existente
     (mismo concepto que lazo.codigo_documento), no una categoria de
     plano; se deja documentada como referencia futura, sin columna
     nueva en nucleo.senal. Tampoco se agregan LAZO, UBICACION ni P&ID
     como tipos — sin evidencia real de planos de esa naturaleza en el
     dataset actual.

   - codigo_plano (NVARCHAR(50) NULL): NVARCHAR(50) por consistencia con
     tag_gabinete/tag_caja/tag_instrumento (el dato real observado es
     uniforme de 11 caracteres, formato "###-J-#####"/"###-E-#####", pero
     se sigue el ancho ya establecido para columnas de este rol en vez de
     ajustarlo al minimo observado). Nullable porque 3/40 filas reales
     (las 3 LAYOUT con codigo) no tienen codigo todavia. SIN UNIQUE: se
     encontro UN DUPLICADO REAL en el unico dataset disponible
     ("620-J-20039", compartido por un plano de CONEXIONADO y uno de
     LAYOUT, filas 25/26 de PLANOS) — evidencia mas fuerte que la ya
     usada para decidir que codigo_senal (013) tampoco fuera unico. Se
     agrega en su lugar un indice NO UNICO filtrado
     (IX_plano_proyecto_codigo) para busqueda por codigo sin bloquear
     ninguna importacion legitima. plano.id sigue siendo la identidad
     real.

   - codigo_anterior (NVARCHAR(50) NULL, mismo patron que
     instrumento.tag_anterior/gabinete.tag_anterior): existe
     conceptualmente pero NO se puebla desde PLANOS.TABLERO_WSP — ese
     valor, confirmado con datos reales, es el identificador WSP
     historico del TABLERO/GABINETE que el plano documenta, no del plano
     en si (mismo hallazgo que ya motivo gabinete.tag_anterior en la
     migracion 012). TABLERO_WSP alimentara, en una futura importacion,
     gabinete.tag_anterior o caja.tag_anterior (esta ultima columna aun
     no existe en nucleo.caja — no se crea aqui, es una migracion de
     Cajas fuera de este alcance). El Excel actual no muestra evidencia
     de un codigo anterior real de PLANO — queda NULL para todo lo que
     se importe de este dataset.

   - PLANOS.TABLERO mezcla dos clases de objeto reales, confirmado 100%
     resuelto contra SENALES_CONTROL.RIO (gabinete: 620-PCC-5006,
     620-RIO-5012, 620-RIO-5013 — 18 filas) y SENALES_CONTROL.TAG_CAJA/
     CAJA_EQUIPO (caja: prefijos 620-TBC-/620-TBJ-, 12 tags distintos —
     14 filas), cero filas sin resolver. NO se crea plano.tablero como
     columna — se resuelve exclusivamente via gabinete_plano/caja_plano.

   - Cardinalidad N:M real, no 1:1 ni 1:N asumida: 620-RIO-5012 tiene 7
     planos propios, 620-RIO-5013 tiene 6, 620-PCC-5006 tiene 5 (1
     gabinete -> N planos). La fila 34 de PLANOS
     ("TABLERO='620-TBC-5016/5017'") es UN plano LAYOUT documentando DOS
     cajas a la vez, y 620-TBC-5016 tiene 3 planos propios — confirma
     N:M en ambos sentidos para caja tambien. gabinete_plano/caja_plano
     son tablas de union N:M reales (no relacion polimorfica generica
     plano_entidad/tipo_entidad/entidad_id), primera tabla puramente de
     union del esquema nucleo — se sigue el mismo principio del resto
     del modelo (FK compuesta por proyecto, indice unico filtrado, soft
     delete + auditoria igual que cualquier tabla nucleo).

   - Proteccion cross-project: cada fila de gabinete_plano/caja_plano
     lleva su propio proyecto_id, y ambas FK compuestas (gabinete_id,
     proyecto_id)/(plano_id, proyecto_id) exigen el MISMO proyecto_id de
     esa fila — estructuralmente imposible relacionar entidades de
     proyectos distintos, sin CHECK ni trigger adicional, mismo
     mecanismo que el resto del esquema.

   - Anomalias reales encontradas, documentadas para el futuro
     importador, NO resueltas aqui (014 no lee ni corrige datos legacy):
     (a) el codigo "620-J-20019" usado como PLANO_CONEX_INTERIOR de
     620-PCC-5006 coincide literalmente con el CODIGO propio de un plano
     de 620-RIO-5012 (fila 4, "HOJA 3") — posible error de tipeo/copiado
     en el Excel legacy, sin evidencia suficiente para confirmarlo o
     corregirlo unilateralmente; (b) el duplicado real de codigo_plano
     "620-J-20039" (arriba). La futura politica de importacion sera
     detectar + advertir, nunca corregir ni fusionar automaticamente.

   - ESTAD0 (progresion de revision + estado documental mezclados,
     28/40 filas pobladas, exclusivamente en filas CONEXIONADO) sigue
     sin modelarse — no se crea cat_estado_plano ni revision_plano en
     esta migracion, documentado como analisis pendiente de separar en
     una fase futura.

   VERIFICACION DE DATOS REALES (SIEI_DEV, previa a aplicar esta
   migracion): nucleo.gabinete 42 filas / 1 activa, nucleo.caja 33 filas
   / 0 activas, TODAS en TEST-001 (fixtures de sesiones anteriores). El
   proyecto real 22043 tiene 0 gabinetes y 0 cajas. nucleo.plano no
   existe todavia. Cero riesgo de dato real afectado — las 3 tablas
   nuevas quedan vacias al terminar esta migracion, sin ningun backfill.

   ESTRATEGIA TRANSACCIONAL: identica a las migraciones 012/013 — SET
   XACT_ABORT ON + transaccion explicita abarcando todos los batches,
   aplicada con "sqlcmd -b" (aborta al primer error) para que un fallo a
   mitad de camino nunca deje el esquema parcialmente modificado.
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
    WHERE s.name = N'nucleo' AND t.name = N'gabinete'
)
BEGIN
    THROW 55992, 'La migracion 014 requiere que 012_gabinetes.sql se haya aplicado antes (falta nucleo.gabinete).', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'plano'
)
BEGIN
    THROW 55993, 'La migracion 014 ya fue aplicada (nucleo.plano ya existe).', 1;
END
GO


BEGIN TRANSACTION;


/* ============================================================================
   1. cat.cat_tipo_plano — catalogo global, lista cerrada, 4 valores
      confirmados con evidencia real (ver nota de cabecera)
   ============================================================================ */

CREATE TABLE cat.cat_tipo_plano (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_plano_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_plano PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_plano_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_plano (codigo, descripcion) VALUES
    (N'CONEXIONADO',       N'Diagrama de conexionado / cableado'),
    (N'INTERIOR_GABINETE', N'Plano de conexionado interior de un gabinete'),
    (N'LAYOUT',            N'Plano de distribucion fisica (layout)'),
    (N'UNIFILAR',          N'Diagrama unifilar (una linea) de distribucion electrica');
GO


/* ============================================================================
   2. nucleo.plano — identidad del dibujo de ingenieria
   ============================================================================ */

CREATE TABLE nucleo.plano (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    codigo_plano        NVARCHAR(50)         NULL,
    codigo_anterior     NVARCHAR(50)         NULL,
    descripcion         NVARCHAR(300)        NOT NULL,
    tipo_plano_id       BIGINT               NOT NULL,
    activo              BIT                  NOT NULL CONSTRAINT DF_plano_activo DEFAULT (1),
    created_at          DATETIME2            NOT NULL CONSTRAINT DF_plano_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2            NULL,
    created_by          BIGINT               NULL,
    updated_by          BIGINT               NULL,
    CONSTRAINT PK_plano PRIMARY KEY (id),
    CONSTRAINT UQ_plano_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_plano_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_plano_tipo_plano FOREIGN KEY (tipo_plano_id) REFERENCES cat.cat_tipo_plano (id),
    CONSTRAINT FK_plano_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_plano_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- codigo_plano: NO UNIQUE (duplicado real 620-J-20039 encontrado, ver
-- nota de cabecera) — indice de busqueda no unico, filtrado.
CREATE INDEX IX_plano_proyecto_codigo
    ON nucleo.plano (proyecto_id, codigo_plano)
    WHERE codigo_plano IS NOT NULL AND activo = 1;
GO


/* ============================================================================
   3. nucleo.gabinete_plano — union N:M entre gabinete y plano
   ============================================================================ */

CREATE TABLE nucleo.gabinete_plano (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    gabinete_id     BIGINT               NOT NULL,
    plano_id        BIGINT               NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_gabinete_plano_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_gabinete_plano_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    created_by      BIGINT               NULL,
    updated_by      BIGINT               NULL,
    CONSTRAINT PK_gabinete_plano PRIMARY KEY (id),
    CONSTRAINT FK_gabinete_plano_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_gabinete_plano_gabinete FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id),
    CONSTRAINT FK_gabinete_plano_plano FOREIGN KEY (plano_id, proyecto_id) REFERENCES nucleo.plano (id, proyecto_id),
    CONSTRAINT FK_gabinete_plano_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_gabinete_plano_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

-- Impide repetir la MISMA asociacion activa dos veces; no limita cuantos
-- planos distintos puede tener un gabinete ni cuantos gabinetes distintos
-- puede tener un plano (la unicidad es sobre el PAR, no sobre una sola columna).
CREATE UNIQUE INDEX UX_gabinete_plano_activo
    ON nucleo.gabinete_plano (gabinete_id, plano_id)
    WHERE activo = 1;
GO


/* ============================================================================
   4. nucleo.caja_plano — union N:M entre caja y plano (estructuralmente
      identica a gabinete_plano)
   ============================================================================ */

CREATE TABLE nucleo.caja_plano (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id     BIGINT               NOT NULL,
    caja_id         BIGINT               NOT NULL,
    plano_id        BIGINT               NOT NULL,
    activo          BIT                  NOT NULL CONSTRAINT DF_caja_plano_activo DEFAULT (1),
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_caja_plano_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    created_by      BIGINT               NULL,
    updated_by      BIGINT               NULL,
    CONSTRAINT PK_caja_plano PRIMARY KEY (id),
    CONSTRAINT FK_caja_plano_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_caja_plano_caja FOREIGN KEY (caja_id, proyecto_id) REFERENCES nucleo.caja (id, proyecto_id),
    CONSTRAINT FK_caja_plano_plano FOREIGN KEY (plano_id, proyecto_id) REFERENCES nucleo.plano (id, proyecto_id),
    CONSTRAINT FK_caja_plano_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_caja_plano_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
GO

CREATE UNIQUE INDEX UX_caja_plano_activo
    ON nucleo.caja_plano (caja_id, plano_id)
    WHERE activo = 1;
GO


COMMIT TRANSACTION;
GO
