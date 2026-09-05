-- =============================================================================
-- Migracion 027: EQUIPO como nodo intermedio de ruta ("panel electrico")
-- =============================================================================
-- Contexto: el usuario identifico que no todo lo que sigue a un RIO/gabinete
-- en una ruta es una CAJA real — a veces el cable de campo llega directo al
-- panel electrico propio de un equipo (ej. 620-AFM-5005), sin bornas/TB
-- modelados ("EL PANEL NO TIENE TB o no nos interesa, solamente se sabe que
-- llega... consideralo como un panel electrico"). Un barrido completo del
-- Excel encontro 15 grupos reales dueno-equipo-con-panel-distinto (~62
-- senales) donde el dueno de la senal (instrumento o equipo) y el panel que
-- recibe el cable son dos NUCLEO.EQUIPO distintos (ej. dueno 620-PPS-5005,
-- panel 620-AFM-5005).
--
-- TR_tramo_conexion_validar_secuencia (definido en 001, revisado en 015 para
-- permitir GABINETE en el penultimo nodo) solo acepta CAJA como nodo
-- intermedio estrictamente antes del penultimo (Punto 6, error 51017) y solo
-- CAJA/GABINETE en el penultimo (Punto 6b, mismo error). Un EQUIPO-panel
-- distinto del dueno no puede aparecer en ninguna de esas dos posiciones hoy
-- — confirmado en vivo (route_intermediate_invalid) al intentar construir
-- DUENO -> PANEL(equipo) -> GABINETE -> MODULO.
--
-- Esta migracion agrega EQUIPO como owner valido de un punto_conexion tanto
-- en el Punto 6 (nodo intermedio estricto) como en el Punto 6b (penultimo),
-- exactamente en paralelo a como 015 agrego GABINETE. No se toca el Punto 6c
-- (51034): esa regla solo se dispara "si el penultimo es GABINETE" — un
-- EQUIPO en el penultimo no tiene jerarquia modulo->slot->rack->equipo
-- analoga, asi que no aplica ninguna restriccion adicional sobre cual
-- gabinete/modulo puede ser el nodo final cuando el penultimo es EQUIPO
-- (misma libertad que ya tiene CAJA en el penultimo). El Punto 3 (51006,
-- origen del primer tramo == dueno real de la senal) y el Punto 5 (51007,
-- nodo final debe ser GABINETE o MODULO) quedan sin cambios: el dueno sigue
-- siendo siempre el origen de tramo1, y el panel es simplemente el destino
-- de tramo1 / origen de tramo2 — un EQUIPO intermedio, no un reemplazo del
-- dueno.
--
-- Topologia que esto habilita, ejemplo real (PPS-5005 -> AFM-5005):
--   tramo1: PPS-5005 (dueno, EQUIPO)  -> AFM-5005 (panel, EQUIPO)   [rn=1, total=3, antes del penultimo]
--   tramo2: AFM-5005 (panel, EQUIPO)  -> GABINETE                  [rn=2=total-1, penultimo]
--   tramo3: GABINETE                  -> MODULO (mismo gabinete)   [rn=3=total, final]
--
-- Caso ya soportado sin cambios (dueno == panel, ej. 620-TSA-5001): el
-- EQUIPO aparece solo como origen de tramo1 (rn=1, sin restriccion de owner
-- en el origen), no como nodo intermedio — no requeria esta migracion.
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

DROP TRIGGER nucleo.TR_tramo_conexion_validar_secuencia;
GO

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

    -- Punto 6 (revisado en 027 — panel electrico como nodo intermedio, ver
    -- migracion 027): un nodo intermedio ESTRICTAMENTE antes del penultimo
    -- debe ser CAJA o, novedad de 027, EQUIPO (un panel electrico distinto
    -- del dueno de la senal, sin bornas modeladas — ej. DUENO(equipo) ->
    -- PANEL(equipo) -> GABINETE -> MODULO).
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn < a.total - 1 AND p.caja_id IS NULL AND p.equipo_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'Un nodo intermedio de la ruta debe corresponder a una CAJA o un EQUIPO (panel electrico).', 1;
    END

    -- Punto 6b (revisado en 015 y 027): el PENULTIMO nodo (si existe, total
    -- > 1) puede ser CAJA, GABINETE (015) o EQUIPO/panel electrico (027) —
    -- para soportar CAJA?/PANEL?->GABINETE->MODULO / INSTRUMENTO->GABINETE
    -- ->MODULO / DUENO->PANEL(equipo)->MODULO directo (cable de campo a un
    -- terminal de gabinete o modulo + cableado interno). MODULO nunca puede
    -- ser penultimo: un modulo solo puede ser el nodo FINAL de la ruta.
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn = a.total - 1 AND a.total > 1
          AND p.caja_id IS NULL AND p.gabinete_id IS NULL AND p.equipo_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'El penultimo nodo de la ruta debe corresponder a una CAJA, un GABINETE o un EQUIPO (panel electrico).', 1;
    END

    -- Punto 6c (nuevo en 015, sin cambios en 027): si el penultimo nodo es
    -- un GABINETE, el ultimo debe ser un MODULO (nunca otro GABINETE) que
    -- pertenezca FISICAMENTE a ese mismo gabinete (modulo -> slot -> rack ->
    -- gabinete) — rechaza GABINETE A -> MODULO de GABINETE B aunque ambos
    -- sean del mismo proyecto. Un EQUIPO en el penultimo no tiene una
    -- jerarquia analoga (un panel electrico no "posee" modulos), asi que no
    -- se agrega ninguna restriccion equivalente para ese caso: el nodo
    -- final solo queda sujeto al Punto 5 (GABINETE o MODULO, sin mas).
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
END;
GO
