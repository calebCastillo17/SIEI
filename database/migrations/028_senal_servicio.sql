-- =============================================================================
-- Migracion 028: nucleo.senal.servicio
-- =============================================================================
-- Contexto: la hoja SENALES del master del usuario tiene una columna
-- SERVICIO que, verificado con datos reales, es un texto POR SEÑAL — un
-- nivel de detalle mas fino que nucleo.instrumento.servicio (el servicio
-- general del instrumento). Ejemplo real (620-HV-5084, ya con hijos
-- instrumento reales HS-5084/ZSO-5084/ZSC-5084/HYO-5084/HYC-5084 como
-- dueños de sus 5 señales via senal.instrumento_id): cada hijo YA tiene su
-- propio instrumento.servicio poblado con exactamente ese texto granular
-- ("DETECCION DE POSICION ABIERTO DE VALVULA...", etc.) — para el caso de
-- instrumento con hijos, NO hace falta ningun cambio de esquema, el dato
-- ya vive correctamente en instrumento.servicio del hijo real.
--
-- El hueco real esta del lado EQUIPO: senales como 620-PPS-5005_RDY/REM/
-- ESP/RUN/FAL/ST tienen servicios DISTINTOS por señal en el Excel
-- ("MOTOR LISTO PARA FUNCIONAR", "MOTOR EN MODO REMOTO", "PARADA DE
-- EMERGENCIA ACTIVADA", ...) pero el equipo dueño (620-PPS-5005) no tiene
-- una estructura padre/hijo de instrumentos — RDY/REM/RUN/FAL/ESP/ST son
-- estados internos de un mismo equipo (el arrancador del motor), no
-- instrumentos fisicos reales con su propio tag en el P&ID (a diferencia
-- de HS-5084/ZSO-5084/ZSC-5084, que si lo son) — modelarlos como
-- instrumento seria inventar un instrumento que no existe fisicamente. Y
-- nucleo.equipo no tiene columna servicio.
--
-- nucleo.senal.servicio (NVARCHAR(200) NULL, mismo tamaño que
-- instrumento.servicio) cubre ese hueco: un respaldo por señal, sin
-- exclusividad de clase ni de tipo de dueño (mismo criterio que
-- causa_alarma en la migracion 013 — un atributo independiente de SIEI,
-- sin CHECK ni trigger de exclusividad), pensado principalmente para
-- señales de equipo pero disponible para cualquier señal que lo necesite.
-- Dato 100% manual, igual que tag_senal/descripcion/observacion — nunca
-- derivado ni auto-poblado al crear una señal o un instrumento nuevo.
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

ALTER TABLE nucleo.senal
    ADD servicio NVARCHAR(200) NULL;
GO
