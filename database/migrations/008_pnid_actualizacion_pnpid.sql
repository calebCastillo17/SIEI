/* =============================================================================
   008_pnid_actualizacion_pnpid.sql — SIEI
   Nuevo código en cat.cat_estado_pnid: PNPID_ACTUALIZADO.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - Con datos reales del proyecto se confirmó que la herramienta P&ID del
     usuario (Plant 3D) regenera el PnPID de un objeto entre exportaciones
     aunque el TAG y el instrumento físico sigan siendo el mismo — en el
     reporte de referencia esto afectaba al 67% de las filas (322 de 478).
     El importador, antes de este cambio, identificaba (proyecto_id, PnPID)
     como la única clave — un PnPID nuevo bajo un TAG ya usado caía siempre
     en REQUIERE_REVISION, nunca aplicado automáticamente, así que las
     mismas "novedades" volvían a aparecer en cada reimportación sin que
     nada las resolviera.
   - El usuario compartió la macro VBA legacy que usaba antes de SIEI
     (`Actualizar_Master_Desde_IMPORT`): busca primero por PnPID: si no
     encuentra, cae a buscar por TAG, y si encuentra por TAG re-ancla el
     PnPID al valor nuevo sin pedir revisión — nunca lo distingue de un
     "sin cambios" común. El usuario pidió adoptar ese mismo fallback,
     automático, en SIEI.
   - Diferencia deliberada respecto a la macro: acá NO se mezcla en
     silencio con OK/DATOS_MODIFICADOS — queda como código propio y
     auditable (`PNPID_ACTUALIZADO`) en el historial de cada importación,
     para poder ver más adelante qué instrumentos tuvieron su PnPID
     renovado y cuándo.
   - El fallback por TAG solo aplica cuando el dueño del TAG es un
     instrumento ya administrado por Plant3D (`fuente_pnpid = 'PLANT3D'`)
     — ver backend/src/lib/pnidImport/compare.ts. Si el TAG pertenece a un
     instrumento creado a mano (`fuente_pnpid IS NULL`), se mantiene
     REQUIERE_REVISION sin cambios: que un reporte P&ID reclame de golpe un
     instrumento manual sigue siendo una decisión que un humano debe
     confirmar.

   ALCANCE
   -------
   1 INSERT en cat.cat_estado_pnid (lista cerrada, ver 001/004) + 1 columna
   nueva en integracion.importacion_pnid (conteo_pnpid_actualizado, mismo
   patrón que los demás conteo_* de la migración 004). No se toca 001-007.
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
    WHERE s.name = N'cat' AND t.name = N'cat_estado_pnid'
)
BEGIN
    THROW 55930, 'La migracion 008 requiere que 001_initial_schema.sql se haya aplicado antes (falta cat.cat_estado_pnid).', 1;
END
GO

IF EXISTS (SELECT 1 FROM cat.cat_estado_pnid WHERE codigo = N'PNPID_ACTUALIZADO')
BEGIN
    THROW 55931, 'cat.cat_estado_pnid ya tiene el codigo PNPID_ACTUALIZADO — la migracion 008 ya se aplico antes.', 1;
END
GO


/* ============================================================================
   1. NUEVO CÓDIGO EN cat.cat_estado_pnid
   ============================================================================ */

INSERT INTO cat.cat_estado_pnid (codigo, descripcion) VALUES
    (N'PNPID_ACTUALIZADO', N'Mismo TAG que un instrumento ya administrado por Plant3D, pero con un PnPID nuevo — se re-ancla automaticamente, sin requerir revision manual');
GO


/* ============================================================================
   2. NUEVA COLUMNA EN integracion.importacion_pnid

   Mismo patrón que los demás conteo_* (migración 004) — el conteo de cada
   importación se persiste como columna, no se recalcula al leer.
   ============================================================================ */

ALTER TABLE integracion.importacion_pnid ADD
    conteo_pnpid_actualizado INT NOT NULL CONSTRAINT DF_importacion_pnid_conteo_pnpid_actualizado DEFAULT (0);
GO
