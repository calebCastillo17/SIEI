/* =============================================================================
   019_tipo_io_com_modulo_comunicacion.sql — SIEI
   Agrega 'COM' a cat.cat_tipo_io — un valor de marcador temporal para
   catalogar módulos de comunicación (ej. tarjetas Ethernet/IP de un rack
   real) que NO tienen canales de E/S propios, a diferencia de AI/AO/DI/
   DO/RTD (todos confirmados contra el Excel de origen).

   CONTEXTO / DECISION DE NEGOCIO (aprobada explícitamente por el usuario):

   - cat.cat_tipo_io está registrado como catálogo CERRADO
     (createSimpleCatalogRouter('cat.cat_tipo_io', false) en server.ts) —
     agregar un código nuevo es deliberadamente una migración, no una
     llamada a la API (ver el comentario del propio router). 'COM' NO es
     un tipo de señal real como los otros 5 — es un marcador temporal
     ("por ahora solo llámalo así", palabras del usuario) para poder
     catalogar el HARDWARE de un módulo de comunicación sin inventarle un
     tipo de señal que no tiene. Si más adelante se necesita modelar esto
     mejor (separar "tipo de módulo" de "tipo de señal E/S"), es trabajo
     futuro documentado, no resuelto acá.

   - cat.cat_modulo_io.canales_max pasa a aceptar 0 (antes exigía > 0,
     ver moduleTypes.ts) — 0 es el valor real para un módulo sin canales
     de E/S, no un valor inventado. TR_modulo_generar_canales (001) ya
     maneja canales_max = 0 correctamente sin necesitar ningún cambio: su
     CTE recursiva ancla en n=0 y el WHERE `num.n < a.canales_max` excluye
     esa ancla cuando canales_max = 0, así que no se genera ningún canal —
     comportamiento ya correcto, confirmado leyendo el trigger, no
     modificado acá.
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM cat.cat_tipo_io WHERE codigo = N'COM')
BEGIN
    INSERT INTO cat.cat_tipo_io (codigo, descripcion, created_at)
    VALUES (N'COM', N'Módulo de comunicación (sin canales de E/S) — marcador temporal', SYSUTCDATETIME());
END

COMMIT TRANSACTION;
GO
