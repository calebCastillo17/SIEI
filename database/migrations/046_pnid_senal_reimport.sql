/* =============================================================================
   046_pnid_senal_reimport.sql — SIEI
   Motor de reimportación de señales (dejado como "próximo paso" al construir
   ES_SENAL en la migración 045, ver conversación) — igual espíritu que el
   TAG fallback de instrumentos (008), pero para nucleo.senal.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario)
   -------------------------------------------------------------------------
   Hasta 045, una fila ES_SENAL era puramente informativa: el importador
   identificaba a qué instrumento real pertenece la señal, pero nunca
   escribía nada en nucleo.senal. El usuario encontró un caso real (señal
   620-PIT-5053_PI) donde el `servicio` guardado en la base ya no coincide
   con el `Servicio` que trae el reporte más nuevo para esa misma señal, y
   pidió explícitamente cerrar ese hueco:

     "OSEA CDA VEZ QUE YO IMPORTA LA SEÑAL QUE VIENE DEL REPORTE ESTE
     OLINKEADAO A LAS SEÑAL DEL CONTROL, SI DEL REPORTE VINO NO SE CAMBIO
     ESE TAG, ACA TAMBIEN SE ACTUALICE, SI SE ELIMINO, ACA NO SE ELIMINE
     PERO QUE AVISE QUE YA NO EXISTE ENTIENDES?"

   El vínculo persistente ya existe desde la migración de datos de las 175
   señales CONTROL de proyecto 620 (script reemplazarSenalesControl620
   Reporte2.ts, no una migración): `nucleo.senal.codigo_senal` (agregada en
   013 como referencia legacy no única) se usó ahí como la llave = PnPID
   del reporte que originó cada señal — esta migración construye el motor
   que la explota, no cambia la columna.

   ALCANCE — solo señales YA VINCULADAS por codigo_senal
   -------------------------------------------------------------------------
   Este motor SOLO sincroniza señales cuyo codigo_senal ya coincide con el
   PnPID de una fila ES_SENAL del reporte (175 señales CONTROL hoy). Las
   filas ES_SENAL de tipo COM/NO SENAL (65 en el reporte "Instrument List -
   2", verificado con datos reales) no tienen codigo_senal vinculado a
   ninguna señal existente — esta migración no las toca, no las auto-crea
   ni las auto-vincula por ningún otro criterio; son un problema aparte, no
   resuelto acá.

   ALCANCE — QUÉ CAMPOS SE SINCRONIZAN
   -------------------------------------------------------------------------
   tag_senal y servicio únicamente — derivados directamente del reporte
   (Instrumento Asociado + Type para el tag, Servicio tal cual para el
   segundo), sin ambigüedad de negocio. tipo_io_id queda deliberadamente
   fuera: fue una decisión puntual de la migración de datos original (AI/
   RTD/sin-definir para 120VAC "a mano caso por caso", palabras del
   usuario) y no un campo que el reporte determine de forma mecánica y
   reimportable.

   NUEVO CÓDIGO: SENAL_SIN_MATCH_EN_REPORTE
   -------------------------------------------------------------------------
   Cuando una señal YA vinculada (codigo_senal poblado) no aparece en el
   reporte más nuevo (su PnPID desapareció por completo), NUNCA se borra ni
   desvincula — se informa nada más, exactamente como pidió el usuario. Es
   el equivalente, para señales, de NO_EXISTE_EN_PNID para instrumentos,
   pero sin ninguna vía de eliminación asociada (ver pnidImports.ts).

   ALCANCE SQL
   -------------------------------------------------------------------------
   2 códigos nuevos en cat.cat_estado_pnid ya existente no aplica (ES_SENAL
   ya cubre el caso principal) — solo 1 código nuevo (SENAL_SIN_MATCH_EN_
   REPORTE); 2 columnas nuevas en integracion.importacion_pnid_resultado
   (senal_id + FK compuesta, senal_updated_at_preview para el mismo chequeo
   de concurrencia que ya existe para instrumento_updated_at_preview); 2
   columnas conteo_* nuevas en integracion.importacion_pnid, mismo patrón
   que las demás. No se toca 001-045.
============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO


/* ============================================================================
   0. VERIFICACIÓN DE PRECONDICIÓN
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'integracion' AND t.name = N'importacion_pnid_resultado'
)
BEGIN
    THROW 57001, 'La migracion 046 requiere que 004_pnid_import.sql se haya aplicado antes.', 1;
END
GO

IF EXISTS (SELECT 1 FROM cat.cat_estado_pnid WHERE codigo = N'SENAL_SIN_MATCH_EN_REPORTE')
BEGIN
    THROW 57002, 'cat.cat_estado_pnid ya tiene el codigo SENAL_SIN_MATCH_EN_REPORTE — la migracion 046 ya se aplico antes.', 1;
END
GO


/* ============================================================================
   1. NUEVO CÓDIGO EN cat.cat_estado_pnid
   ============================================================================ */

INSERT INTO cat.cat_estado_pnid (codigo, descripcion) VALUES
    (N'SENAL_SIN_MATCH_EN_REPORTE', N'Una senal ya vinculada por codigo_senal (PnPID) no aparece en el reporte mas reciente -- nunca se borra ni desvincula, solo se informa');
GO


/* ============================================================================
   2. NUEVAS COLUMNAS EN integracion.importacion_pnid_resultado
   ============================================================================ */

ALTER TABLE integracion.importacion_pnid_resultado ADD
    senal_id                       BIGINT      NULL,
    senal_updated_at_preview       DATETIME2   NULL;
GO

ALTER TABLE integracion.importacion_pnid_resultado ADD
    CONSTRAINT FK_importacion_pnid_resultado_senal
        FOREIGN KEY (senal_id, proyecto_id)
        REFERENCES nucleo.senal (id, proyecto_id);
GO

CREATE INDEX IX_importacion_pnid_resultado_senal
    ON integracion.importacion_pnid_resultado (senal_id)
    WHERE senal_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_importacion_pnid_resultado_senal
    ON integracion.importacion_pnid_resultado (importacion_id, senal_id)
    WHERE senal_id IS NOT NULL;
GO

-- CK_importacion_pnid_resultado_origen (004) solo aceptaba fila_id O
-- instrumento_id como "ancla" de un resultado sin fila fuente propia — el
-- caso original era NO_EXISTE_EN_PNID (instrumento_id NOT NULL, fila_id
-- NULL). SENAL_SIN_MATCH_EN_REPORTE es su equivalente para señales: ni
-- fila_id ni instrumento_id, solo senal_id — la CHECK se amplía para
-- aceptar ese tercer ancla, sin tocar el significado de los otros dos.
ALTER TABLE integracion.importacion_pnid_resultado
    DROP CONSTRAINT CK_importacion_pnid_resultado_origen;
GO

ALTER TABLE integracion.importacion_pnid_resultado ADD
    CONSTRAINT CK_importacion_pnid_resultado_origen
        CHECK (fila_id IS NOT NULL OR instrumento_id IS NOT NULL OR senal_id IS NOT NULL);
GO


/* ============================================================================
   3. NUEVOS CONTEOS EN integracion.importacion_pnid
   ============================================================================ */

ALTER TABLE integracion.importacion_pnid ADD
    conteo_senal_actualizada           INT NOT NULL CONSTRAINT DF_importacion_pnid_conteo_senal_actualizada DEFAULT (0),
    conteo_senal_sin_match_reporte     INT NOT NULL CONSTRAINT DF_importacion_pnid_conteo_senal_sin_match_reporte DEFAULT (0);
GO
