# Diagnóstico: Señales y Conexionado a Gabinetes de Control

**Estado: DIAGNÓSTICO. No implementado. No es una migración. No modifica backend/frontend/Excel.**

Fuente analizada: `reference_excel/02_MASTER_IO_620.xlsm` (2.2 MB, 13 hojas, Power Query + VBA activos), contrastada contra `reference_excel/01_MASTER_INSTRUMENTOS_620.xlsm` y el modelo actual de SIEI (`database/migrations/001_initial_schema.sql`, `backend/src/routes/`, `frontend/src/`).

Metodología: no se asumió nada por el nombre de una columna. Cada afirmación de este documento está respaldada por evidencia literal extraída del archivo: valores reales de celdas, fórmulas de hoja, código M de Power Query (extraído del blob `DataMashup` embebido en `customXml/item2.xml`), y macros VBA (extraídas con `oletools`/`olevba`).

---

## 1. Inventario completo de hojas

| Hoja | Visibilidad | Dimensión | Filas de datos reales | Naturaleza |
|---|---|---|---|---|
| `SENALES` | visible | A1:BG489 | 488 | **Manual/editable.** Fuente cruda de señales CONTROL (cableadas). |
| `COM` | visible | A1:AH772 | ~762 (con filas de relleno pre-filldown) | **Manual/editable.** Fuente cruda de señales COM (comunicaciones). |
| `SENALES_CONTROL` | visible | A1:BW489 | 488 | **Derivada (Power Query).** `SENALES` + FillDown + JOIN con `MASTER_SENALES`. |
| `SENALES_COM` | visible | A1:AX771 | 762 | **Derivada (Power Query).** `COM` + FillDown + JOIN con `MASTER_SENALES`. |
| `MASTER_SENALES` | visible | A1:AP1032 | 1031 (269 CONTROL + 762 COM) | **Semi-manual.** Tabla local (`tbl_MASTER_SENALES`) mantenida por macro VBA — alarmas/rangos/interlocks por `ID_SENAL`. Es la fuente, no la consulta, de esos campos. |
| `PLANOS` | visible | A1:H44 | 41 | **Manual.** Catálogo de planos/diagramas de conexionado, referenciado por fórmulas `INDEX/MATCH` desde `SENALES`. |
| `VALIDACIONES` | visible | A1:M73 | dinámico | **Derivada (macro VBA).** Salida de `Actualizar_VALIDACION_NUMERO_SENALES` — cuenta señales por instrumento asociado. Vista de control de calidad, no fuente. |
| `EQUIPOS` | visible | A1:G28 | 27 | **Manual.** Catálogo de equipos del nodo (mismo espíritu que `nucleo.equipo`, con `TAG_EQUIPO_INST` que SIEI evaluó y rechazó explícitamente — ver `CLAUDE.md`). |
| `SEN` | visible | A1:BJ350 | 349 | **Derivada (Power Query, `queryTable` sobre tabla externa).** Espejo en vivo de `tbl_MASTER_INSTRUMENTOS` de `01_MASTER_INSTRUMENTOS_620.xlsm` (leído vía SharePoint), **extendido a mano** con columnas de hoja de datos (alimentación, rango, protocolo, alarmas). Ver sección 2. |
| `Config` | oculta | A1:B1 | 1 | **Manual.** `ULTIMO_ID_SENAL = 446` — checkpoint del correlativo de `ID_SENAL`. |
| `MASTER_INSTRUMENTOS` | oculta | A1:AM353 | 352 | Copia de trabajo del master de instrumentos (mismo origen que `01_MASTER_INSTRUMENTOS_620.xlsm`). |
| `__TMP_SWAP_SENALES__` | muy oculta | A1:A1 | — | Auxiliar de macro (swap temporal). |
| `__UNDO_SENALES__` | muy oculta | A1:BR505 | — | Auxiliar de macro (deshacer). |

No existen hojas llamadas `SENALES_DETALLE`, `BASE_CONTEO_IO` ni `LISTA_IO` — no se encontraron con ese nombre exacto ni equivalente evidente. `Config` es la única hoja con ese nombre (una celda, no un panel de configuración).

### 1.1 Motor de datos: Power Query real (no solo fórmulas)

El workbook tiene 4 conexiones activas (`xl/connections.xml`), todas Power Query (`Microsoft.Mashup.OleDb`):

1. **`SENALES_CONTROL`** — lee la propia hoja `SENALES` (vía `Web.Contents` a la copia de SharePoint del **mismo archivo** — un patrón real pero fragil: la consulta no lee el libro abierto, lee la última versión guardada en SharePoint, por eso las macros hacen `wb.Save` antes de refrescar).
2. **`SENALES_COM`** — misma lógica sobre la hoja `COM`.
3. **`SENALES_TODAS`** — `UNION` de las dos anteriores, con columna `FUENTE` = `"CONTROL"` / `"COM"`. **No está materializada como hoja visible** (no aparece en el inventario) — es connection-only, probablemente para un `PivotTable` o exportación ad hoc.
4. **`tbl_MASTER_INSTRUMENTOS (2)`** — lee la tabla `tbl_MASTER_INSTRUMENTOS` de `01_MASTER_INSTRUMENTOS_620.xlsm` (otro archivo, también vía SharePoint). Su resultado se materializa en la hoja **`SEN`**.

### 1.2 Diagrama de flujo y dependencias

```
01_MASTER_INSTRUMENTOS_620.xlsm
   [tbl_MASTER_INSTRUMENTOS]
        │
        │ Power Query (SharePoint, connectionId=4)
        ▼
   Hoja "SEN"  (02_MASTER_IO_620.xlsm)
   — instrumento + hoja de datos (alimentación, rango, protocolo, alarmas)
   — NO alimenta SENALES/SENALES_CONTROL directamente (sin evidencia de ese enlace)


Hoja "SENALES" (manual, cableado físico)  Hoja "COM" (manual, comunicaciones)
 - bloques con FillDown implícito          - bloques con FillDown implícito
 - fórmulas locales: TAG_CABLE,             - sin fórmulas locales de derivado
   TAG_CAJA, TAG_SENAL, BORNERA_BLOQUE...     (todo texto tecleado)
        │                                          │
        │ Power Query "SENALES_CONTROL"            │ Power Query "SENALES_COM"
        │  1. FillDown de campos de ubicación      │  1. marca filas válidas (evita
        │  2. JOIN con MASTER_SENALES              │     que el FillDown arrastre
        │     por ID_SENAL (alarmas/rango)         │     el último PANEL/EQUIPO a
        ▼                                          ▼     filas vacías del final)
   Hoja "SENALES_CONTROL"                     Hoja "SENALES_COM"       │  2. FillDown
   (269 filas, vista de trabajo)              (762 filas, vista)       │  3. JOIN con MASTER_SENALES
        │                                          │                  │  4. control de seguridad:
        └──────────────┬───────────────────────────┘                     aborta si alguna fila
                        │                                                 "rellenada" no era real
                        ▼
              Power Query "SENALES_TODAS" (connection-only, sin hoja)
              UNION + columna FUENTE=CONTROL/COM


                MACRO VBA "ACTUALIZAR_MASTER_SENALES" (ID_SENAL_AUTO.bas)
                ─────────────────────────────────────────────────────────
   SENALES/COM (asigna ID_SENAL nuevo solo si TAG_SENAL≠"" e ID_SENAL="")
        │  guarda archivo → refresca SENALES_CONTROL/SENALES_COM
        ▼
   MASTER_SENALES (tbl_MASTER_SENALES)
   - purga IDs que ya no están en las consultas (sin huérfanos)
   - agrega fila nueva (plantilla) para cada ID_SENAL nuevo
   - ESTADO_REVISION = "PENDIENTE" en la fila nueva
        │
        └── alimenta (vía el JOIN de arriba) alarmas/rangos/ENCLAVAMIENTO
            de vuelta a SENALES_CONTROL / SENALES_COM

                MACRO VBA "Actualizar_VALIDACION_NUMERO_SENALES"
   SENALES → agrupa por TAG_INSTRUMENTO_ASOCIADO → hoja VALIDACIONES
   (cuenta DI/DO/AI/AO/RTD por tag — detección de instrumentos mal cableados)
```

**Conclusión de flujo**: `SENALES` y `COM` son las **únicas fuentes de verdad manuales** de la parte física/cableado. `MASTER_SENALES` es la única fuente manual de la parte de ingeniería (alarmas, rangos, enclavamientos). Todo lo demás (`SENALES_CONTROL`, `SENALES_COM`, `SENALES_TODAS`) es 100% derivado y desechable/regenerable. `SEN` es un espejo de otro archivo, conceptualmente más cerca de `nucleo.instrumento` que de `nucleo.senal`.

---

## 2. Anatomía completa de `SENALES`

Confirmado con evidencia: **una fila de `SENALES` NO es una señal.** Es la intersección física de hasta 5 conceptos simultáneos, y la hoja usa un patrón de **"bloque con encabezado"**: los campos de ubicación/módulo (gabinete, chasis, slot, modelo, módulo) se escriben **una sola vez** al inicio de cada bloque de canales, y el resto de filas del bloque los dejan en blanco — el Power Query `SENALES_CONTROL` hace `Table.FillDown` sobre exactamente esas columnas para reconstruir el valor por fila:

```m
#"Rellenar hacia abajo" = Table.FillDown(#"Encabezados limpiados", {
    "RIO","PLANO_INTERIOR_RIO","DESCRIPCION_PLANO_INTERIOR","PLANO_RIO",
    "DESCRIPCION_PLANO_RIO","CHASIS","SLOT","MODELO","MODULO","DISPR","TB"
})
```

Esto es evidencia directa y literal de que esos 11 campos son "cabecera de bloque físico", no atributos de la señal individual — el propio autor del Excel los trata así.

### 2.1 Las 59 columnas de `SENALES`, agrupadas conceptualmente

**A. Identidad de señal**

| Columna | Ejemplo | % no vacío | Manual/Derivado | Va a |
|---|---|---|---|---|
| `ID_SENAL` | `620-SIG-000232` | 55.1% (269/488 — el resto son filas de canales sin señal asignada, spare) | **Semi-manual**: valor fijo, asignado una sola vez por la macro `ACTUALIZAR_MASTER_SENALES` cuando `TAG_SENAL≠""` e `ID_SENAL=""`. Nunca se regenera si ya existe. | `nucleo.senal.id` conceptualmente (ver sección 7) |
| `TAG_SENAL` | `620-PPS-5005_RDY` | 55.1% | **Derivado por fórmula**: `=TAG_EQUIPO_INST & "_" & SENAL` (confirmado leyendo la fórmula real de la celda) | `nucleo.senal.tag_senal` |
| `SENAL` | `RDY` | 55.1% | Manual (sufijo funcional de la señal) | parte de `tag_senal` |

**B. Instrumento/equipo origen**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `TAG_EQUIPO_INST` | `620-PPS-5005` | 55.1% | El "dueño" real de la señal — puede ser instrumento O equipo. Alimenta la fórmula de `TAG_SENAL`. |
| `TAG_INSTRUMENTO` | `620-HS-5084` | 38.7% | Solo cuando el origen es un instrumento propiamente dicho (no todo `TAG_EQUIPO_INST` tiene un instrumento asociado — ej. señales de motor van directo al equipo). |
| `TAG_INSTRUMENTO_ASOCIADO` | `620-HV-5084` | 38.7% | El instrumento "padre" (ej. `HS-5084` es el selector local/remoto asociado a la válvula `HV-5084`) — ya existe en SIEI como `instrumento_asociado_id`. |
| `ID_INSTRUMENTO`, `PnPID`, `TAG_WSP` | `INS-000231`, `198111`, `N/A` | 38.7% / 38.7% / 37.3% | Ya modelados en `nucleo.instrumento`. |
| `TIPO_INSTRUMENTO`, `SERVICIO`, `SISTEMA` | `HS`, `BOMBA DE AGUA...`, `LINEA DE IMPULSIÓN...` | 38.7% / 45.9% / 44.9% | Ya modelados en `nucleo.instrumento`. |
| `TECNOLOGIA`, `FUNCIONAMIENTO`, `CUERPO_INSTRUMENTO` | `PIEZORRESISTIVO`, `NEUMATICO`, `CUCHILLA` | 38.7% / 24.0% / 24.0% | Ya modelados en `nucleo.instrumento`. |
| `Column50` (sin encabezado) | `NC` / `NO` | 24.0% | **Hallazgo**: valores de posición normal de válvula (Normally Closed/Open). **Sin nombre de columna en el Excel** — encabezado real está vacío. |
| `Column51` (sin encabezado) | `FL` / `FO` / `FC` | 23.6% | **Hallazgo**: posición en falla (Fail Last/Open/Closed). Mismo problema: sin encabezado propio. |
| `CONEX_TIPO` | `LP`, `BOT_S`, `BOT_D` | 20.5% | Confirmado con evidencia cruzada: `LP` = Loop Powered (aparece en todos los AI/RTD de 4-20mA/HART/resistencia). `BOT_S`/`BOT_D` aparecen en instrumentos `HS` (selectores) — probablemente botonera simple/doble, a confirmar con el usuario. |
| `PLANO_LAZO` | `620-J-30017` | 38.7% | Ya modelado (`nucleo.lazo.codigo_documento`). |

**C. Clasificación de señal**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `MODULO_VISTA` | `DI` | **100%** | **El campo de clasificación físico real** (DI/DO/AI/AO/RTD) — confirmado por la propia macro `Validacion_senales.bas`, que lo usa como criterio principal y solo cae a `TIPO_SENAL` como respaldo si está vacío/inválido. Corresponde a `cat_tipo_io` + `clase_senal_id='CONTROL'`. |
| `TIPO_SENAL` | `4 a 20 mA + HART`, `RESISTENCIA`, `120 VAC`, `120 VDC` | 54.9% | **No es DI/DO/AI/AO** — es el tipo eléctrico/de protocolo de la señal (confirmado con datos reales: un AI real trae `"4 a 20 mA + HART"` aquí). Complementa a `MODULO_VISTA`, no lo reemplaza. |
| `MODULO_VISTA_ORDEN` | `DI-01` | 100% | **100% derivado** (fórmula `LET` que numera módulos del mismo tipo dentro de un chasis). No debe almacenarse — es un cálculo de posición, reproducible con `ROW_NUMBER()` en SQL. |

**D. Gabinete** — ver sección 4 completa.

| Columna | Ejemplo | % no vacío (antes de FillDown) | Nota |
|---|---|---|---|
| `RIO` | `620-PCC-5006`, `620-RIO-5012` | 0.6% (solo cabecera de bloque; tras FillDown en `SENALES_CONTROL`: 100%) | **Evidencia dura de que "RIO" ya no es un nombre preciso**: la misma columna contiene tanto tags `620-RIO-XXXX` (E/S remota real) como `620-PCC-XXXX` (Panel/Power Control Center — un gabinete de control de motores, no de E/S remota). |
| `PLANO_INTERIOR_RIO`, `DESCRIPCION_PLANO_INTERIOR` | `620-J-20013`, texto | 0.6% | Plano del interior físico del gabinete (lookup a `PLANOS`). |
| `PLANO_RIO`, `DESCRIPCION_PLANO_RIO` | `620-J-20014`, texto | 2.3% | Plano de conexionado del gabinete (lookup a `PLANOS`). |

**E. Rack/chasis**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `CHASIS` | `CHASIS 1` | 0.8% (cabecera de bloque) | Mapea a `nucleo.rack`, pero como **texto libre** ("CHASIS 1"), no como número — `nucleo.rack.numero_rack` es `SMALLINT`; habría que parsear. |

**F. Módulo/slot/canal**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `SLOT` | `SLOT-04` | 8.0% (cabecera de bloque) | Mapea a `nucleo.slot.numero_slot` — mismo problema de texto libre ("SLOT-04" vs `4`). |
| `MODELO` | `1756-IA16I` | 8.0% | Mapea a `cat.cat_modulo_io` (catálogo de modelos físicos de módulo — ya existe el concepto). |
| `MODULO` | `DI` | 8.0% (cabecera) | Redundante con `MODULO_VISTA` una vez expandido — es la misma info, sin FillDown. |
| `DISPR` | `DISPR01` | 8.0% | Identificador de "dispositivo remoto" dentro del chasis — sin equivalente claro en el modelo actual. A confirmar significado exacto con el usuario. |
| `TB` | `TB-01` | 8.0% | Bloque de terminales del **módulo** (distinto de `TB_CAJA`, el de la caja). |
| `CANAL` | `0`, `1`, `2`… | **100%** | Mapea directo a `nucleo.canal.numero_canal`. |
| `T_MODULO` | `IN-0;L2-0` | **100%** | Etiqueta física del terminal del módulo (según el fabricante del PLC) — no modelado hoy. |
| `BORNERA` | `F1-2` | **100%** | Terminal específico dentro de `TB` — se acerca a `punto_conexion.bornera`/`.borne`, pero el formato real (`F1-2`, rango de dos bornes) no calza 1:1 con el modelo actual (`borne` es un campo único, no un rango). |

**G. Terminación de módulo/gabinete (cable interno)**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `N° CABLE`, `N_PAR_CABLE` | `1`, `1` | 55.1% | `N_PAR_CABLE` es **derivado** (`COUNTIF` acumulativo — numera el par dentro del cable). No almacenar tal cual; es `nucleo.par_conductor.numero_par`. |
| `TAG_CABLE` | `620AFM5005-T01` | 55.1% | **Derivado por fórmula** (concatena `CAJA_EQUIPO` + sufijo por tipo de módulo). Corresponde a `nucleo.cable.tag_cable` del tramo **gabinete↔caja/equipo** (el "home-run"). |
| `R_CABLE` | `2` | 8.2% | Sin significado confirmado — posiblemente reserva de conductores del cable. A confirmar. |
| `TIPO_CABLE` | `1-19c#14 AWG` | 55.1% | Mapea a `nucleo.cable.tipo_cable`. |
| `PLANO_GANCHO`, `PLANO_GANCHO_DESCRIPCION` | `620-E-60026`, texto | 55.1% / 46.5% | Plano del "gancho" (diagrama de conexionado del extremo de campo) — lookup a `PLANOS`. |

**H. Caja de conexiones**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `CAJA_EQUIPO` | `620-AFM-5005` | 55.1% | El tag del **equipo o caja** donde termina el cable de home-run — no siempre es una caja real (puede ser el panel local de un arrancador de motor). |
| `TAG_CAJA` | `620-TBC-XXX1` | 36.7% (subconjunto de `CAJA_EQUIPO`) | **Derivado por fórmula** (`LET` que extrae el patrón `620-TBC-`/`620-TBJ-` de `CAJA_EQUIPO`). Solo se llena cuando el destino ES una caja de paso real. Confirma que `CAJA_EQUIPO` es más genérico que `TAG_CAJA`. |
| `BORNERA_BLOQUE_CAJA` | `1`, `2`, `3`… | 38.7% | **100% derivado** (`COUNTIFS`+`SUMIFS` — numera el bloque de bornera dentro de la caja). No almacenar. |
| `BORNE_JB`, `TB_CAJA` | `"1,2,3"`, `TB` | 38.7% | `BORNE_JB` es una **lista de bornes en un solo campo de texto** (no normalizado) — un tramo puede usar 2-3 bornes físicos a la vez (ej. RTD de 3 hilos). |
| `B_NUM_RESERVA` | `2` | 2.5% | Bornes de reserva/spare en el bloque — concepto de capacidad libre, no modelado hoy. |
| `ORDEN_INST_CAJA` | `1` | 36.7% | Orden de instalación dentro de la caja — parece ser posicional/de dibujo, no de negocio. |

**I. Cables/conductores (lado instrumento)**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `TAG_CABLE_INST` | `620HV5084-T01` | 38.7% | El cable del tramo **instrumento↔caja** (distinto de `TAG_CABLE`, que es caja/equipo↔gabinete). Confirma que una señal con caja tiene **2 cables en serie**, no 1. |
| `TIPO_CABLE_INST` | `1-19c#14 AWG` | 38.7% | Tipo del cable de ese segundo tramo. |

**J. Datos de proceso/documentales**

| Columna | Ejemplo | % no vacío | Nota |
|---|---|---|---|
| `DESTINO` | `MOTOR LISTO PARA FUNCIONAR` | **100%** | Descripción funcional de la señal — el "para qué" en lenguaje de ingeniería. Corresponde a `nucleo.senal.descripcion`. |
| `NODO` | `Nodo 7` | 46.1% | Ya modelado (`nucleo.instrumento.nodo`, pero aquí es un atributo de la fila física — puede diferir del nodo del instrumento si la señal cruza de nodo). |
| `LINEA` | `620-PW-4"-C1E2A-26602` | 37.9% | Ya modelado (`instrumento.linea` vía import P&ID). |
| `EQUIPO_ASOCIADO` | `620-HV-5084` | 38.7% | Ya modelado (`instrumento.equipo_asociado_tag`). |
| `P&ID` | `620-F-20017` | 38.7% | Ya modelado (`instrumento.plano_pnid`). |
| `UBICACIÓN` | (1 valor en todo el archivo) | 0.2% | Prácticamente vacía — posible remanente, no columna viva. |
| `OBSERVACIONES` | — | **0%** | Completamente vacía en las 488 filas. |

**K. Alarmas/rangos** — **no existen en `SENALES`** (todas vacías o ausentes). Viven exclusivamente en `MASTER_SENALES`, unidas por `ID_SENAL` vía Power Query. Esto es la confirmación más clara de la separación física/wiring vs. ingeniería/alarma que ya está en el modelo de SIEI (`nucleo.senal` las trae directamente).

**L. Campos derivados/auxiliares (NO deben almacenarse tal cual)**

- `N_PAR_CABLE` — posición calculada (`COUNTIF`).
- `TAG_CABLE` — concatenación calculada.
- `TAG_CAJA` — extracción de texto calculada.
- `BORNERA_BLOQUE_CAJA` — posición calculada (`COUNTIFS`+`SUMIFS`).
- `TAG_SENAL` — concatenación calculada (`TAG_EQUIPO_INST & "_" & SENAL`).
- `MODULO_VISTA_ORDEN` — numeración de módulos por chasis, calculada con fórmula `LET`.
- `DESCRIPCION_PLANO_INTERIOR`, `DESCRIPCION_PLANO_RIO`, `PLANO_GANCHO_DESCRIPCION` — lookups a `PLANOS`, no datos propios.

**Hallazgo de calidad de datos (evidencia dura)**: la consulta `SENALES_CONTROL` intenta traer `CLASE_ALARMA` desde `MASTER_SENALES`, pero la columna real en `MASTER_SENALES` se llama `CAUSA_ALARMA` (no `CLASE_ALARMA`) — confirmado: `CAUSA_ALARMA` tiene 1031/1031 valores no vacíos en `MASTER_SENALES`, mientras que `CLASE_ALARMA` en `SENALES_CONTROL` tiene **0/488** valores no vacíos. El JOIN de Power Query queda mudo para ese campo desde que alguien renombró la columna en `MASTER_SENALES` sin actualizar la consulta. Ningún dato se pierde (sigue en `MASTER_SENALES`), pero **la vista de trabajo que el equipo mira día a día muestra ese campo vacío sin ningún aviso.**

---

## 3. Diferencia `SENALES` vs. `SENALES_CONTROL`

No son la misma información con otro nombre. `SENALES_CONTROL` es una **vista materializada, derivada por Power Query**, que a `SENALES` le agrega exactamente dos cosas:

1. **FillDown** de los 11 campos de cabecera de bloque (gabinete/chasis/slot/modelo/módulo) — convierte el patrón "un valor cada N filas" en "un valor por fila".
2. **JOIN por `ID_SENAL`** contra `MASTER_SENALES`, trayendo 16 campos de ingeniería que `SENALES` nunca tuvo: `ENCLAVAMIENTO`, `ALARMA_HH/H/L/LL`, `RANGO_MIN/MAX`, `UNIDAD_INGENIERIA`, `VALOR_NORMAL`, `CLASE_ALARMA` (roto, ver arriba), `PRIORIDAD_ALARMA`, `RETARDO`, `OBSERVACION_REVISION`, `OBSERVACION`, `ESTADO_REVISION`, `COMPLETITUD`.

`SENALES` nunca se edita a mano para esos 16 campos — se editan en `MASTER_SENALES`, que la macro sincroniza. Editar `SENALES_CONTROL` directamente no tendría efecto persistente (es una tabla de consulta; un refresh la vuelve a generar desde cero).

---

## 4. Conteos por tipo de señal (evidencia real, 488 filas de `SENALES`)

| Tipo (`MODULO_VISTA`) | Cantidad |
|---|---|
| DI | 208 |
| DO | 144 |
| AI | 96 |
| AO | 24 |
| RTD | 16 |
| **Total** | **488** |

`COM` (comunicaciones, hoja separada): 762 filas antes de limpieza de filas de relleno; `MASTER_SENALES` reporta 762 con `HOJA_ORIGEN='SENALES_COM'` + 269 con `HOJA_ORIGEN='SENALES_CONTROL'` = 1031 señales totales en todo el proyecto (269 físicas cableadas + 762 de comunicaciones). El desbalance (762 COM vs. 269 CONTROL) es real, no un error de lectura — hay casi 3 veces más señales de comunicación (variadores, PLCs de terceros, medidores inteligentes) que señales físicamente cableadas a un módulo I/O.

---

## 5. RIO → GABINETE: evidencia del problema real (no solo hipótesis)

Reconstruyendo 4 señales reales con su gabinete ya expandido (columna `RIO` de `SENALES_CONTROL`, después del FillDown):

| ID_SENAL | TAG_SENAL | Columna `RIO` real | ¿Es realmente un RIO? |
|---|---|---|---|
| `620-SIG-000070` | `620-HV-5084_REM` | **`620-PCC-5006`** | No — PCC = Panel/Power Control Center (motor). |
| `620-SIG-001038` | `620-PPS-5005_ST` | **`620-PCC-5006`** | No — mismo gabinete de control de motor. |
| `620-SIG-000232` | `620-PIT-5044_PI` | `620-RIO-5012` | Sí — E/S remota real. |
| `620-SIG-000259` | `620-TE-5041A_TI` | `620-RIO-5012` | Sí — E/S remota real. |
| `620-SIG-000139` | `620-LV-5003A_LIC` | `620-RIO-5013` | Sí — E/S remota real. |

**Esto es la confirmación directa y con datos del proyecto real de exactamente el problema que describís**: la misma columna `RIO`, en el mismo proyecto, contiene indistintamente gabinetes de E/S remota (`620-RIO-50XX`) y gabinetes de control de motores (`620-PCC-5006`). Hoy nada en el dato distingue programáticamente uno de otro — solo el prefijo de texto del tag, que no está normalizado en ningún catálogo. La hoja `PLANOS` (catálogo de planos) también mezcla ambos bajo la misma columna `TABLERO`, y hasta el código alterno del cliente (`TABLERO_WSP`) es inconsistente (`620-PCC-5006` tiene como alterno `620-RIO-T102` — la palabra "RIO" aparece en el código alterno de un gabinete que NO es de E/S remota, probablemente porque `T1XX` es solo una serie de numeración de tableros del cliente, no una clasificación funcional).

### 5.1 Impacto real de evolucionar `RIO` → `GABINETE`

Relevado en el código actual (no estimado — grep exhaustivo sobre `001`-`010` congeladas, backend, frontend, tests):

**Base de datos (`001_initial_schema.sql`, congelada — cualquier cambio sería `012+`, ver numeración real verificada en la sección 26)**

- Tabla `nucleo.rio` (id, proyecto_id, tag_rio, descripcion, activo) — **sin ningún campo de tipo/clasificación hoy**. Esto es en sí mismo evidencia de que el modelo actual no distingue tipos de gabinete.
- Tabla `nucleo.rack` depende de `rio_id` (`FK_rack_rio`).
- Tabla `nucleo.punto_conexion` depende de `rio_id` (`FK_punto_conexion_rio`), como una de las 5 opciones XOR de dueño (`instrumento/equipo/caja/rio/modulo`).
- 2 índices (`UX_rio_proyecto_tag`, `UX_rack_rio_numero`) y 1 índice no filtrado (`IX_punto_conexion_rio_id`).
- **3 triggers** de integridad de ruta/canal referencian `rio_id` directamente en su lógica de validación (`TR_...` sobre `tramo_conexion`/`senal`, líneas ~1062, ~1332, ~1414 de `001_initial_schema.sql`): validan que el `rio_id` del punto de destino final de una ruta coincida con el `rio_id` real del rack del módulo/canal asignado a la señal. Renombrar la tabla/columna es mecánico (mismo tipo de dato, misma semántica), pero hay que tocar los 3 triggers.
- `003_user_audit.sql` agrega `created_by`/`updated_by` a `nucleo.rio` — se arrastra automáticamente si se recrea la tabla con otro nombre.

**Backend**

- `backend/src/routes/rios.ts` — router dedicado, CRUD completo.
- `backend/src/routes/racks.ts` — recibe/valida `rioId` como parámetro de filtro y de creación.
- `backend/src/routes/connectionPoints.ts` — `rioId` es una de las 5 opciones de `OWNER_FIELDS` en el XOR de `punto_conexion`.
- `backend/src/server.ts` — monta `riosRouter` en `/api/projects/:projectId/rios`.

**Frontend**

- Páginas dedicadas: `RiosListPage.tsx`, `RioDetailPage.tsx`.
- `api/rios.ts`, `api/racks.ts`.
- Hooks/formularios que ofrecen "RIO" como tipo de dueño: `useConnectionPointFormOptions.ts`, `usePhysicalTree.ts`, `connectionPointFormDefaults.ts`, `connectionPointLabel.ts`, `useRouteFormOptions.ts`, `ConnectionPointForm.tsx`.
- Navegación: `App.tsx` (ruteo), `AppLayout.tsx` (link de menú).

**Tests**

- `backend/tests/physical-hierarchy.api.test.ts` — CRUD de RIO/rack/slot/módulo/canal.
- `backend/tests/physical-connections.api.test.ts` — usa `rioId` como una de las opciones del XOR de punto de conexión.

**Conclusión de impacto**: el cambio es de **superficie amplia pero de riesgo bajo-medio** — es un rename estructurado (tabla + 2 columnas FK + 3 triggers + 1 router + 2 páginas + varios hooks + 2 test suites), no un cambio de cardinalidad ni de reglas de negocio existentes. El riesgo real no está en el rename en sí, sino en la **decisión de diseño de la jerarquía nueva** (sección 5.2), que si se hace mal obliga a un segundo rename.

### 5.2 Propuesta conceptual preliminar (solo para discusión — no es la migración final)

```
GABINETE
 ├─ tipo_gabinete_id → cat.cat_tipo_gabinete (RIO | CONTROL | COMUNICACION | ...)
 ├─ tag_gabinete (hoy tag_rio)
 ├─ descripcion
 └─ RACK (1:N, ya existe, solo cambia la FK)
       └─ SLOT (1:N, ya existe)
             └─ MODULO (1:N, ya existe, FK a cat.cat_modulo_io)
                   └─ CANAL (1:N, ya existe)
```

Esto **no** son tablas nuevas — es la misma jerarquía `rio→rack→slot→modulo→canal` que ya existe, con:
1. `nucleo.rio` renombrada a `nucleo.gabinete` (o se agrega `tipo_gabinete_id` a la tabla existente, sin rename — dos variantes a decidir, ver preguntas al final).
2. Un catálogo nuevo `cat.cat_tipo_gabinete`, mismo patrón que `cat.cat_tipo_equipo` (migración 007): lista cerrada, seedeada con al menos `RIO`/`CONTROL`/`COMUNICACION`.

Una pregunta de diseño abierta (no resuelta acá): ¿un gabinete de tipo `COMUNICACION` reemplaza conceptualmente a `nucleo.switch`, o son cosas distintas que coexisten (un switch *vive dentro de* un gabinete de comunicaciones)? La evidencia del Excel no lo resuelve — `COM`/`SENALES_COM` no tienen ninguna columna de "gabinete de comunicaciones", solo `SWITCH`/`PUERTO` directos. Queda como pregunta de negocio.

---

## 6. Señal vs. Asignación I/O vs. Conexionado — cuánto ya existe en SIEI

Verificado leyendo `nucleo.senal`, `nucleo.punto_conexion`, `nucleo.ruta_conexion`, `nucleo.tramo_conexion` en `001_initial_schema.sql`:

**La separación conceptual que pedís confirmar YA EXISTE, estructuralmente, en el modelo actual:**

1. **SEÑAL** (`nucleo.senal`) — el dato lógico/funcional: `tag_senal`, `clase_senal_id` (CONTROL/COM), `tipo_io_id` XOR `direccion_com_id` (constraint `CK_senal_tipo_io_direccion_excl`), `canal_id` (nullable — **solo** las CONTROL cableadas lo usan), alarmas/rango/enclavamiento inline. Dueño: `instrumento_id` XOR `equipo_id` (constraint `CK_senal_origen_xor`).
2. **ASIGNACIÓN I/O** = `nucleo.senal.canal_id` (para CONTROL) o `nucleo.enlace_com` (para COM, vía `puerto_id`) — dónde está conectada la señal en términos de gabinete/rack/slot/módulo/canal (CONTROL) o switch/puerto (COM). Ya son caminos separados, sin superposición: una señal CONTROL nunca toca `enlace_com`; una señal COM nunca toca `canal_id`.
3. **CONEXIONADO** = `nucleo.ruta_conexion` (1 por señal) → `nucleo.tramo_conexion` (N por ruta, ordenados por `numero_orden`) → cada tramo tiene `punto_origen_id`/`punto_destino_id` (ambos `nucleo.punto_conexion`) y `par_conductor_id` (`nucleo.cable`→`nucleo.par_conductor`). **Esto ya soporta multi-tramo** (instrumento→caja→gabinete) exactamente como pide el punto 8 del pedido — de hecho hay triggers dedicados (`TR_tramo_conexion_validar_secuencia`, `TR_tramo_conexion_validar_canal_ruta`, entre otros no listados acá por brevedad) que fuerzan que los tramos sean consecutivos, que el destino de un tramo sea el origen del siguiente, y que el punto final coincida con el `canal_id` real de la señal.

**Lo que falta/gap real (no implica que esté "mal", implica que el Excel es más detallado que el modelo hoy):**

- `punto_conexion` no distingue **bloque de bornera** (`BORNERA_BLOQUE_CAJA`) ni bornes de reserva (`B_NUM_RESERVA`) — hoy es un punto simple (`regleta`/`bornera`/`borne`/`lado`/`circuito`/`hilo`), no un rango ni un contador de capacidad libre.
- `punto_conexion.borne` es un campo de texto único; el Excel a veces usa un **rango/lista de bornes en un mismo tramo** (`BORNE_JB = "1,2,3"`, típico de RTD de 3 hilos con común compartido). El modelo actual no representa "un tramo ocupa 3 bornes a la vez" sin repetir filas.
- `punto_conexion.modulo_id` referencia el módulo, **no el canal** — no hay una FK directa `punto_conexion → canal`. La coherencia canal↔punto de destino se valida por trigger comparando `modulo_id`, pero no hay una restricción que ate el punto de conexión al canal exacto dentro de ese módulo (dos canales del mismo módulo podrían compartir, en teoría, el mismo `punto_conexion.modulo_id` sin conflicto de unicidad detectado a ese nivel).
- No existe el campo "tipo de dato de comunicación" (`TIPO_DATO` en la hoja `COM`: `BIT`/`REAL`/`DINT`/`WORD`/`UDINT`/`UINT`/`DWORD`) en `nucleo.senal` ni en `nucleo.enlace_com` — es un concepto real y bien poblado en el Excel (896/762 filas con valor) que hoy no tiene dónde vivir.

---

## 7. CONTROL vs. COM — confirmado con evidencia, incluyendo un antipatrón real

Se pidió explícitamente verificar que el modelo no mezcle AI/AO/DI/DO/RTD con IN/OUT. Resultado:

- **El Excel SÍ comete ese error**: la columna `MASTER_SENALES.TIPO_IO` (1031 filas) mezcla ambos dominios en el mismo campo:

  | Valor | Cantidad | Dominio |
  |---|---|---|
  | `IN` | 701 | COM (dirección) |
  | `DI` | 147 | CONTROL (tipo físico) |
  | `AI` | 61 | CONTROL |
  | `OUT` | 59 | COM |
  | `DO` | 50 | CONTROL |
  | `RTD` | 10 | CONTROL |
  | `AO` | 3 | CONTROL |

  Un solo campo, `TIPO_IO`, sirve para dos preguntas distintas según de qué hoja venga la fila (`HOJA_ORIGEN`). Es exactamente el antipatrón que pediste evitar.

- **El modelo actual de SIEI YA lo evita**, con una restricción explícita: `CK_senal_tipo_io_direccion_excl CHECK (NOT (tipo_io_id IS NOT NULL AND direccion_com_id IS NOT NULL))` — un registro de `nucleo.senal` no puede tener ambos a la vez. `tipo_io_id` (DI/DO/AI/AO/RTD, vía `cat.cat_tipo_io`) y `direccion_com_id` (vía `cat.cat_direccion_com`, que corresponde 1:1 al campo real `COM.ESTADO ∈ {IN, OUT}` del Excel) son columnas separadas.

- **Confirmado con datos reales**: una señal COM nunca ocupa `canal_id` (`nucleo.senal.canal_id` es `NULL` para toda señal `clase_senal_id='COM'`, ya que el canal solo tiene sentido físico para un módulo I/O; las COM usan `nucleo.enlace_com.puerto_id` en su lugar) — coincide exactamente con el hecho de que `COM`/`SENALES_COM` no tienen ninguna columna `CANAL`/`MODULO`/`SLOT`/`CHASIS`, solo `SWITCH`/`PUERTO`.

- **`TIPO_DATO`, si aparece, es un concepto separado — confirmado**: la hoja `COM` trae `TIPO_DATO` (`BIT`/`REAL`/`DINT`/`WORD`/`UDINT`/`UINT`/`DWORD`) además de `ESTADO` (`IN`/`OUT`, la dirección real). Son dos columnas distintas, nunca mezcladas entre sí en el Excel — el tipo de dato de una señal Modbus/EtherNet-IP y su dirección son ortogonales. Este campo hoy no existe en el modelo de SIEI (ver gap en sección 6).

- `TIPO_COM` (protocolo del enlace: `EthernetIP` 716, `Red eléctrica DLR Ethernet/IP` 30, `Red eléctrica Modbus TCP/IP` 24) mapea 1:1 a `cat.cat_tipo_com` / `nucleo.enlace_com.tipo_com_id`, ya existente.

---

## 8. `ID_SENAL` — cómo funciona realmente (evidencia de macro VBA)

Extraído literalmente del módulo `ID_SENAL_AUTO.bas` (macro `ACTUALIZAR_MASTER_SENALES`):

1. **Quién lo crea**: la macro, nunca una fórmula. Prefijo fijo `"620-SIG-"` + correlativo de 6 dígitos.
2. **Cuándo se asigna**: solo si `TAG_SENAL <> ""` y `ID_SENAL = ""` en esa fila. El correlativo se calcula como `MAX(número ya usado en SENALES, COM y MASTER_SENALES) + 1` — **una sola secuencia global**, compartida entre CONTROL y COM (no hay dos secuencias separadas por clase).
3. **Es permanente**: la macro solo reasigna un `ID_SENAL` existente si detecta que está **duplicado** (colisión entre hojas) — nunca por cambio de `TAG_SENAL`. No hay ninguna rama de código que regenere un ID por edición de tag.
4. **Cómo se conserva cuando cambia `TAG_SENAL`**: no requiere ninguna acción especial — como `TAG_SENAL` es un campo aparte (derivado por fórmula de `TAG_EQUIPO_INST & "_" & SENAL`) y `ID_SENAL` es un valor fijo tecleado/generado independiente, cambiar el tag no toca el ID. Esto es la confirmación de que **`TAG_SENAL` no es identidad** — es exactamente lo que pedías no asumir, y la evidencia dice que efectivamente no lo es.
5. **Relación con `nucleo.senal.id`**: hoy **no hay ninguna** — `nucleo.senal` no tiene una columna equivalente a `ID_SENAL` (código de negocio visible tipo `620-SIG-XXXXXX`), solo el `id BIGINT IDENTITY` interno. Es el mismo patrón que ya resolviste para instrumentos con `PnPID` (identidad externa persistente, columna propia, nunca PK) — pero para señales, **ese campo todavía no existe en el modelo**. Es una laguna real si el objetivo es preservar `620-SIG-XXXXXX` como referencia visible en drawings/reportes.
6. Hay una segunda macro (`VALIDAR_COM_CONTROL.bas`) con una lógica de generación de ID **casi idéntica** pero ligeramente distinta (usa `CLAVE_ANTERIOR = "ID620"`, sugiriendo que existió un esquema de ID anterior con ese prefijo, migrado en algún momento a `620-SIG-`). No quedó claro cuál de las dos macros es la vigente — ambas coexisten en el mismo archivo `.xlsm`. Pregunta para el usuario en la sección 10.
7. Auditoría/gobernanza real observada en la macro: purga de `MASTER_SENALES` contra IDs "permitidos" (los que existen en `SENALES_CONTROL`/`SENALES_COM` tras refrescar), eliminación de duplicados, verificación de cobertura 1:1 completa al final, y marca `ESTADO_REVISION = "PENDIENTE"` en toda fila nueva del master — un flujo de trabajo real de revisión de ingeniería que hoy no tiene equivalente en SIEI (`nucleo.senal.estado_revision_id` existe como columna, pero no hay ningún flujo que la setee automáticamente al crear una señal).

---

## 9. Conexionado físico — 5 ejemplos reales reconstruidos extremo a extremo

Todos los datos de esta sección son literales del archivo (fila y `ID_SENAL` citados para trazabilidad).

### 9.1 AI 4-20mA + HART, loop-powered, vía caja de paso

```
Instrumento:  620-PIT-5044  (transmisor de presión, PIEZORRESISTIVO)
   ↓ señal:   620-PIT-5044_PI   (ID_SENAL 620-SIG-000232)
   ↓ cable instrumento→caja:  620PIT5044-X01  (1-1p#16 AWG+SH)
   ↓ caja:    620-TBJ-5014   (plano 620-J-20036, bornera bloque 10, bornes "1,2")
   ↓ cable caja→gabinete:     620TBJ5014-X02  (1-8p#18 AWG+SH)
   ↓ gabinete: 620-RIO-5012 (CHASIS 1, SLOT-06, módulo 1756-IF8IH)
   ↓ bornera módulo: F9-F10-11-12, terminal T_MODULO "IN2;RTN2"
   ↓ canal:   2
Señal:  TIPO_SENAL = "4 a 20 mA + HART", CONEX_TIPO = LP (loop-powered)
Rango:  0–160 psi | Alarma H=105 | Alarma HH=110 | ESTADO_REVISION=PENDIENTE
```

### 9.2 RTD, loop-powered (transmisor de temperatura de 2 hilos), sin caja intermedia

```
Instrumento:  620-TE-5041A  (elemento de temperatura, tecnología VTS)
   ↓ señal:   620-TE-5041A_TI   (ID_SENAL 620-SIG-000259)
   ↓ cable:   620TE5041A-X01  (1-1Tr#18 AWG+SH, va directo — CAJA_EQUIPO=620-PPS-5005 (el propio motor/bomba), TAG_CAJA vacío: no hay caja de paso real, termina en el terminal local del equipo)
   ↓ gabinete: 620-RIO-5012 (CHASIS 1, SLOT-09, módulo 1756-IRT8I)
   ↓ bornera módulo: F1-F2-3-4, terminal "IN_0/A;IN_0/A;IN_0/RTD C"
   ↓ canal:   0
Señal:  TIPO_SENAL = "RESISTENCIA", CONEX_TIPO = LP
Rango:  ALARMA_HH/H/L/LL = "TBD" — todavía no ingenierizado (ESTADO_REVISION=PENDIENTE)
```

### 9.3 DI, 120 VDC, vía caja con tag provisional (proyecto en curso)

```
Instrumento:  620-HS-5084  (selector local/remoto, NEUMATICO)
   ↓ instrumento asociado: 620-HV-5084 (la válvula que controla)
   ↓ señal:   620-HV-5084_REM   (ID_SENAL 620-SIG-000070)
   ↓ cable instrumento→caja: 620HV5084-T01 (1-19c#14 AWG)
   ↓ caja:    620-TBC-XXX1   (tag provisional — "XXX1" indica que el tag definitivo aún no fue asignado; plano 620-J-200X6, bornes "1,2,3")
   ↓ cable caja→gabinete:     620TBCXXX1-T01 (mismo tipo de cable, mismo tag base — cable no diferenciado del de la caja en este caso)
   ↓ gabinete: 620-PCC-5006  ⚠ (gabinete de control de motor, NO un RIO real — ver sección 5)
   ↓ bornera módulo: F1-2, terminal "IN-0;L2-0"
   ↓ canal:   0
Señal:  TIPO_SENAL = "120 VDC"
```

### 9.4 DO, 120 VAC, comando directo sin caja de paso

```
Origen: 620-PPS-5005 (equipo — bomba/motor, no un instrumento propiamente dicho)
   ↓ señal:   620-PPS-5005_ST  ("comando arranque de motor", ID_SENAL 620-SIG-001038)
   ↓ cable:   620AFM5005-T01 (1-19c#14 AWG) — CAJA_EQUIPO=620-AFM-5005 (panel local del arrancador), TAG_CAJA vacío: no es una caja de paso, es el destino final físico
   ↓ gabinete: 620-PCC-5006  ⚠ (mismo gabinete de control de motor de 9.3)
   ↓ bornera módulo: F1-2, terminal "OUT-0;L1-0"
   ↓ canal:   0 (módulo 1756-OW16I, SLOT-10)
Señal:  TIPO_SENAL = "120 VAC" — sin TAG_INSTRUMENTO (el dueño es el equipo, no un instrumento)
```

### 9.5 AO 4-20mA + HART — control modulante de válvula

```
Instrumento:  620-LY-5003A  (posicionador/actuador de válvula)
   ↓ señal:   620-LV-5003A_LIC  ("control modulante de válvula", ID_SENAL 620-SIG-000139)
   ↓ gabinete: 620-RIO-5013 (CHASIS 1, SLOT-13, módulo 1756-OF8IH)
   ↓ canal:   0
Señal:  TIPO_SENAL = "4 a 20 mA + HART"
```

**Confirmado con los 5 ejemplos**: el "recorrido físico" real de una señal cableada tiene **0, 1 o 2 tramos de cable** según si hay o no caja de paso intermedia — nunca más de 2 en los datos observados. El modelo `ruta_conexion`→`tramo_conexion` de SIEI ya soporta N tramos arbitrarios, así que cubre este caso (y más) sin cambios estructurales.

---

## 10. Comparación con el modelo actual SIEI — resumen de brechas

| Campo/concepto del Excel | ¿Existe en SIEI hoy? | Dónde |
|---|---|---|
| Identidad de señal (`ID_SENAL`, `TAG_SENAL`) | Parcial | `nucleo.senal.id` (interno) + `tag_senal`; **falta** un código visible persistente tipo `620-SIG-XXXXXX` |
| Instrumento/equipo origen | Sí | `nucleo.senal.instrumento_id`/`equipo_id`, `nucleo.instrumento.*` |
| Clasificación CONTROL/COM sin mezclar tipo físico y dirección | Sí (mejor que el Excel) | `clase_senal_id`, `tipo_io_id` XOR `direccion_com_id` |
| `TIPO_DATO` de comunicación (BIT/REAL/DINT/...) | **No** | — |
| Gabinete (jerárquico, sin distinguir tipo) | Parcial | `nucleo.rio` (sin `tipo_gabinete`) |
| Rack/chasis/slot/módulo/canal | Sí | `nucleo.rack/slot/modulo/canal` |
| Modelo físico de módulo (ej. `1756-IA16I`) | Sí | `cat.cat_modulo_io` |
| Punto de conexión (bornera/borne) | Parcial | `nucleo.punto_conexion` — sin bloque de bornera, sin bornes múltiples por tramo, sin bornes de reserva |
| Cable + par conductor | Sí | `nucleo.cable`, `nucleo.par_conductor` |
| Ruta multi-tramo (instrumento→caja→gabinete) | **Sí, ya soportado** | `nucleo.ruta_conexion` + `nucleo.tramo_conexion` |
| Caja de conexiones | Parcial | `nucleo.caja` — sin plano/gancho asociado |
| Alarmas/rango/enclavamiento | Sí | Directamente en `nucleo.senal` |
| Posición normal/falla de válvula (`NC`/`NO`, `FL`/`FO`/`FC`) | **No** | Ni en `instrumento` ni en `senal` |
| Alimentación del instrumento (loop-powered vs. externa) | **No** | — |
| Flujo de revisión de ingeniería (`ESTADO_REVISION=PENDIENTE` automático) | Parcial | Columna existe (`estado_revision_id`), sin flujo que la setee |

---

## 11. Principio de negocio: una sola entidad SEÑAL (verificado)

El usuario fijó explícitamente este principio antes de continuar: **SEÑAL es una única entidad conceptual**, con dos clases/orígenes funcionales (CONTROL/cableada y COMUNICADA), no dos entidades independientes. Se verificó campo por campo contra `SENALES`, `SENALES_CONTROL`, `COM`, `SENALES_COM` y `MASTER_SENALES`.

### 11.1 Atributos comunes — verificado con datos reales

Intersección exacta de columnas entre `SENALES_CONTROL` (74 cols) y `SENALES_COM` (49 cols):

**Comunes, mismo significado confirmado con datos (39 campos)**: `ID_SENAL`, `TAG_SENAL`, `SENAL` (sufijo funcional corto, ej. `RDY`/`REM`/`ESP` — confirmado en ambas clases con los mismos valores), `DESTINO` (descripción funcional — confirmado semánticamente idéntico en ambas: `"PARADA DE EMERGENCIA ACTIVADA"` aparece igual en CONTROL y en COM), `TAG_INSTRUMENTO`, `TAG_INSTRUMENTO_ASOCIADO`, `TAG_EQUIPO_INST`, `TIPO_INSTRUMENTO`, `ID_INSTRUMENTO`, `PnPID`, `TAG_WSP`, `TECNOLOGIA`, `FUNCIONAMIENTO`, `CUERPO_INSTRUMENTO`, `SERVICIO`, `SISTEMA`, `NODO`, `LINEA`, `EQUIPO_ASOCIADO`, `P&ID`, `TIPO_SENAL`, `ENCLAVAMIENTO`, `ALARMA_HH/H/L/LL`, `RANGO_MIN/MAX`, `UNIDAD_INGENIERIA`, `VALOR_NORMAL`, `PRIORIDAD_ALARMA`, `RETARDO`, `OBSERVACION`, `OBSERVACION_REVISION`, `ESTADO_REVISION`, `COMPLETITUD`, `CLASE_ALARMA` (ver más abajo), `RIO`, `TIPO_CABLE`.

**Parecen iguales pero con matices reales**:
- `RIO`: mismo campo, mismo significado (tag del gabinete físico) — en los 770 registros de `SENALES_COM` siempre vale `620-PCC-5006` (el switch/PLC vive en el gabinete de control, no en un RIO propiamente dicho). No es un campo con significado distinto — es evidencia adicional a favor de `GABINETE` como concepto padre único (sección 5), no un problema de la entidad SEÑAL.
- `TIPO_CABLE`: mismo campo, mismo concepto ("tipo de cable"), pero el dominio de valores es distinto por clase — en CONTROL son cables de instrumentación (`"1-19c#14 AWG"`), en COM es cable de red (`"CABLE  S/UTP CAT. 6A"`, 770/770 filas idéntico). No hace falta separar el campo, solo saber que el catálogo de valores válidos difiere según la clase.
- `CLASE_ALARMA`: **roto en ambas clases por igual** — confirmado `0/488` en `SENALES_CONTROL` y `0/770` en `SENALES_COM`. No es una diferencia de significado entre clases; es el mismo bug de Power Query (busca `CLASE_ALARMA`, la columna real en `MASTER_SENALES` es `CAUSA_ALARMA`) afectando exactamente igual a las dos. Refuerza que ambas clases comparten el mismo pipeline de enriquecimiento — otra prueba a favor de la entidad única.

**Solo en CONTROL (36 campos)** — todos de asignación física/conexionado: `CHASIS`, `SLOT`, `MODELO`, `MODULO`, `MODULO_VISTA`, `MODULO_VISTA_ORDEN`, `DISPR`, `TB`, `CANAL`, `T_MODULO`, `BORNERA`, `N° CABLE`, `N_PAR_CABLE`, `TAG_CABLE`, `R_CABLE`, `PLANO_GANCHO(_DESCRIPCION)`, `CAJA_EQUIPO`, `TAG_CAJA`, `BORNERA_BLOQUE_CAJA`, `BORNE_JB`, `B_NUM_RESERVA`, `TB_CAJA`, `ORDEN_INST_CAJA`, `TAG_CABLE_INST`, `PLANO_(INTERIOR_)RIO(_DESCRIPCION)`, `PLANO_LAZO`, `CONEX_TIPO`, `Column50`/`Column51` (NC/NO, FL/FO/FC), `UBICACIÓN`, `OBSERVACIONES` (plural, distinta de `OBSERVACION` — vacía siempre, ver hallazgos previos).

**Solo en COM (11 campos)**: `SWITCH`, `PUERTO`, `TIPO_COM`, `TAG_PLC_VENDOR`, `PANEL`, `EQUIPO`, `DESCRIPCION_EQUIPO`, `ESTADO` (la dirección IN/OUT real), `TIPO_DATO`, `SERVICIO_ALT`, `UBICACION_GAB`.

`PLANO_LAZO` merece una nota: existe como columna en `MASTER_SENALES` (la tabla unificada) pero **nunca** tiene valor en una fila `HOJA_ORIGEN='SENALES_COM'` (190/269 poblado solo en CONTROL, 0/762 en COM) — confirma que aunque el esquema físico de `MASTER_SENALES` sea plano (todas las columnas para todas las filas), el *uso real* ya respeta la especialización por clase. Mismo patrón para `SWITCH`/`PUERTO`/`CANAL` (población exclusiva por clase de origen) — la única sorpresa es que `MASTER_SENALES.SWITCH` da **0/1031**, siempre vacío incluso en filas COM: el switch/puerto real se lee de `SENALES_COM` directamente, nunca se copia al master (columna placeholder sin uso, no un campo con datos perdidos).

### 11.2 Confirmado: la especialización debe vivir en columnas nulas de una sola entidad, no en tablas separadas

`MASTER_SENALES` — la propia "vista maestra unificada" que ya usa el usuario desde antes de SIEI — es evidencia directa de esto: es **una tabla plana única** con columnas comunes (los 16+ campos de ingeniería) y columnas especializadas por clase coexistiendo como *nullable* (`RIO`/`CHASIS`/`SLOT`/`CANAL`/`TAG_CAJA` para CONTROL; `SWITCH`/`PUERTO` para COM), diferenciadas por `HOJA_ORIGEN` (`'SENALES_CONTROL'` / `'SENALES_COM'`). Nunca fueron dos tablas.

**`nucleo.senal` ya implementa exactamente este patrón, hoy, sin cambios pendientes de este principio**:
- Identidad y atributos comunes en la tabla base: `tag_senal`, `descripcion`, `rango_min/max`, `alarma_hh/h/l/ll`, `valor_normal`, `unidad_ingenieria`, `retardo`, `enclavamiento`, `observacion`, `prioridad_alarma_id`, `estado_revision_id`.
- `clase_senal_id` (`CONTROL`/`COM`) explícito y obligatorio — igual que `HOJA_ORIGEN` en `MASTER_SENALES`, pero como FK a catálogo en vez de texto libre.
- Especialización por columnas nulas mutuamente excluyentes: `tipo_io_id` (CONTROL) XOR `direccion_com_id` (COM), forzado por `CK_senal_tipo_io_direccion_excl` — ningún antipatrón de mezclar DI/DO/AI/AO/RTD con IN/OUT, a diferencia del propio `MASTER_SENALES.TIPO_IO` del Excel (sección 7 del diagnóstico original).
- `canal_id` nullable — solo se usa cuando la señal es CONTROL cableada y ocupa un canal físico; una señal COM nunca lo toca (usa `nucleo.enlace_com.puerto_id` en su lugar, una tabla relacionada, no una tabla "hermana" de `senal`).

**Conclusión de la sección 7 del pedido**: sí, `nucleo.senal` ya funciona como la entidad común correcta. No hay que duplicar nada ni crear `senal_control`/`senal_com`. Lo que falta son campos puntuales (ver preguntas 12-15 abajo), no una restructuración.

### 11.3 Brechas reales de campos comunes (comparando contra `MASTER_SENALES`, no contra el bug)

De los 16 campos que la consulta de Power Query intenta traer desde `MASTER_SENALES` (`ENCLAVAMIENTO`, `ALARMA_HH/H/L/LL`, `RANGO_MIN/MAX`, `UNIDAD_INGENIERIA`, `VALOR_NORMAL`, `CLASE_ALARMA`/`CAUSA_ALARMA`, `PRIORIDAD_ALARMA`, `RETARDO`, `OBSERVACION_REVISION`, `OBSERVACION`, `ESTADO_REVISION`, `COMPLETITUD`), **13 ya existen en `nucleo.senal`**. Solo 3 son brechas reales:

- **`CAUSA_ALARMA`** (el campo real detrás del bug `CLASE_ALARMA`) — no modelado. Dato real en el Excel, aunque no confirmado con datos porque **`OBSERVACION` y `OBSERVACION_REVISION` están al 100% con el valor placeholder `"-"` en las 1031 filas de `MASTER_SENALES`** — igual que `COMPLETITUD` (100% `"-"`) y `ESTADO_REVISION` (100% `PENDIENTE`). Esto confirma algo importante: **esta capa de ingeniería del Excel todavía no tiene contenido real cargado para este proyecto** — es la misma fase "Señales y conexionado" recién arrancando que estamos diagnosticando, no datos históricos que haya que preservar con cuidado. Baja el riesgo de las decisiones de modelado de estos 3 campos.
- **`OBSERVACION_REVISION`** — hoy `nucleo.senal` solo tiene `observacion` (una), no dos.
- **`COMPLETITUD`** — no modelado.

### 11.4 `nombre_corto` vs. `SENAL` (sufijo funcional)

`nucleo.senal.nombre_corto` (`NVARCHAR(30)`) ya existe pero no hay evidencia documentada de si fue pensado para guardar exactamente el sufijo funcional corto del Excel (`SENAL`: `RDY`, `REM`, `ESP`, `RUN`, `FAL`, etc. — confirmado con los mismos valores en CONTROL y COM). Encaja en longitud y en propósito aparente. Pregunta 13 abajo.

### 11.5 TAG_SENAL / codigo_senal — sin necesidad de IDs separados por clase (confirmado)

La macro `ACTUALIZAR_MASTER_SENALES` (`ID_SENAL_AUTO.bas`, ver diagnóstico original sección 8) escanea **`SENALES`, `COM` y `MASTER_SENALES` juntas** para calcular el correlativo siguiente — una sola secuencia `620-SIG-NNNNNN` para las dos clases, nunca `CTRL-`/`COM-` separados. El Excel mismo ya demuestra que no hace falta partir el espacio de IDs por clase. Esto confirma la Pregunta 4 del diagnóstico original sin cambios de fondo (solo se refuerza la alternativa recomendada).

---

## 12. Decisiones de negocio que necesito que confirmes (actualizado con el principio de SEÑAL única)

Las preguntas 1-3 (RIO→GABINETE) y 6-7 (posición de válvula, alimentación) no suponían una separación CONTROL/COM y quedan sin cambios de fondo — se muestran igual por completitud. Las preguntas 4, 8 y 12 del diagnóstico original se reformularon con las alternativas explícitas que pediste. Se agregaron las preguntas 13-16.

### 1. RIO → GABINETE: ¿rename real o solo agregar tipo?

**Contexto encontrado en el Excel**: la misma columna `RIO` contiene indistintamente `620-RIO-5012/5013` (E/S remota real) y `620-PCC-5006` (gabinete de control de motores) — evidencia dura en sección 5. `nucleo.rio` hoy no tiene ningún campo de tipo/clasificación.

- **Alternativa A**: rename real de tabla/columnas (`nucleo.rio` → `nucleo.gabinete`, `rio_id` → `gabinete_id` en `rack` y `punto_conexion`) + 3 triggers a ajustar + 1 router + 2 páginas + varios hooks + 2 test suites (impacto completo relevado en sección 5.1).
- **Alternativa B**: dejar `nucleo.rio` con ese nombre interno y solo agregar `tipo_gabinete_id` — cambio mínimo, pero el nombre de tabla/endpoint queda semánticamente incorrecto para siempre.

**Recomendación técnica**: Alternativa A. El rename es mecánico (mismos tipos de dato, misma cardinalidad, sin triggers de lógica de negocio que reinventar) y esta fase de Señales/Gabinetes es exactamente el momento de hacerlo — postergarlo solo acumula más superficie (más FKs, más páginas) que tocar después.

**Impacto en el modelo**: migración nueva (008+), 1 tabla renombrada, 2 FKs, 3 triggers, `cat.cat_tipo_gabinete` nueva.

### 2. Catálogo de tipos de gabinete

**Contexto encontrado en el Excel**: solo se ven 2 tipos reales en los datos (`RIO`, `PCC`≈`CONTROL`); no hay evidencia directa de un gabinete de comunicaciones dedicado (el switch vive dentro del mismo `620-PCC-5006`).

- **Alternativa A**: lista cerrada `RIO` / `CONTROL` / `COMUNICACION` (mismo patrón que `cat_tipo_equipo`, migración 007).
- **Alternativa B**: lista abierta (catálogo de dominio abierto, cualquiera puede agregar un tipo nuevo).

**Recomendación técnica**: Alternativa A — lista cerrada, mismo criterio ya usado para `cat_tipo_equipo`. Agregar un tipo nuevo es una migración chica si aparece un caso real; abrir el dominio ahora sin evidencia de que haga falta es sobre-ingeniería.

**Impacto en el modelo**: 1 catálogo global nuevo, sembrado con 2-3 códigos.

### 3. Gabinete de comunicaciones vs. `nucleo.switch`

**Contexto encontrado en el Excel**: sin evidencia — los 770 registros de `SENALES_COM` de este proyecto tienen su switch dentro de `620-PCC-5006` (un gabinete de control), no en un gabinete de comunicaciones separado.

- **Alternativa A**: agregar `nucleo.switch.gabinete_id` (opcional) — un switch puede vivir dentro de cualquier gabinete, sin importar su tipo.
- **Alternativa B**: no vincularlos por ahora — dejarlo para cuando aparezca un proyecto con gabinetes de comunicaciones dedicados.

**Recomendación técnica**: Alternativa A, pero como columna *opcional* — no le cuesta nada al modelo tenerla lista, y evita otra migración cuando aparezca el primer proyecto con rack de comunicaciones separado.

**Impacto en el modelo**: 1 columna nueva nullable + 1 FK en `nucleo.switch`.

### 4. `codigo_senal` como identidad permanente — una sola secuencia para ambas clases

**Contexto encontrado en el Excel**: la macro `ACTUALIZAR_MASTER_SENALES` confirma con su propio código que `ID_SENAL` (`620-SIG-NNNNNN`) usa **una única secuencia global**, calculada escaneando `SENALES` + `COM` + `MASTER_SENALES` juntas — nunca separada por clase. `TAG_SENAL` es 100% derivado (`TAG_EQUIPO_INST & "_" & SENAL`) y no es identidad — el `ID_SENAL` nunca se regenera cuando cambia el TAG.

- **Alternativa A**: `nucleo.senal.codigo_senal` (`NVARCHAR`, único por proyecto, generado por el backend con una secuencia — mismo patrón que `PnPID` en instrumentos), **una sola secuencia para CONTROL y COM**.
- **Alternativa B**: dos secuencias/prefijos por clase (`CTRL-`/`COM-`) — el Excel no muestra ninguna necesidad real de esto; sería inventar una distinción que ni la fuente original tiene.

**Recomendación técnica**: Alternativa A, con firmeza — coherente con el principio de entidad única fijado en esta conversación y con la evidencia de la propia macro del usuario.

**Impacto en el modelo**: 1 columna nueva + 1 índice único filtrado (`WHERE activo=1`, mismo patrón que el resto de tags de SIEI) + lógica de generación en el backend (secuencia por proyecto, análoga a como se generaría cualquier otro correlativo).

### 5. Dos macros de generación de ID_SENAL coexistiendo

**Contexto encontrado en el Excel**: `ID_SENAL_AUTO.bas` (prefijo `620-SIG-`) y `VALIDAR_COM_CONTROL.bas` (con una constante `CLAVE_ANTERIOR = "ID620"`, sugiriendo un esquema de ID previo) coexisten en el mismo `.xlsm`, con lógica de generación casi idéntica pero no igual.

- **Alternativa A**: `620-SIG-` es la vigente; `ID620...` es un esquema legado que ya no se usa en ningún proyecto activo.
- **Alternativa B**: hay proyectos reales todavía con IDs `ID620...` que SIEI necesitaría poder importar/reconocer.

**Recomendación técnica**: no puedo recomendar sin tu confirmación — es puramente una pregunta de qué existe realmente en tus proyectos, no una decisión técnica.

**Impacto en el modelo**: si la respuesta es B, el futuro importador de señales necesitaría tolerar/mapear ambos formatos de código de origen; si es A, ninguno.

### 6. Posición normal/falla de válvula (`NC`/`NO`, `FL`/`FO`/`FC`)

**Contexto encontrado en el Excel**: columnas sin encabezado propio en `SENALES` (`Column50`/`Column51`), solo aparecen en filas de instrumentos tipo `HS`/`HV` (selectores/válvulas), nunca en filas de transmisores (AI/RTD). Son atributos constructivos de la válvula/actuador, no de una señal DI/DO en particular — una misma válvula con 4 señales DI distintas (REM, LOCAL, ABIERTO, CERRADO) comparte la misma posición normal/falla en las 4.

- **Alternativa A**: viven en `nucleo.instrumento` (o en `nucleo.equipo` si el dueño es un equipo) — mi lectura de los datos.
- **Alternativa B**: viven en `nucleo.senal`, repetidas en cada señal DI/DO de la misma válvula.

**Recomendación técnica**: Alternativa A — evita duplicar el mismo dato 4 veces por válvula y refleja que es un atributo físico del actuador, no de cada señal individual.

**Impacto en el modelo**: 2 columnas nuevas nullable en `nucleo.instrumento` (o `equipo`), con un catálogo cerrado chico para cada una si se quiere validar valores (`NC`/`NO`, `FL`/`FO`/`FC`).

### 7. Alimentación / loop-powered vs. externa

**Contexto encontrado en el Excel**: `CONEX_TIPO=LP` aparece consistentemente en transmisores AI/RTD de 4-20mA/HART y resistencia (loop-powered) — **columna exclusiva de `SENALES`/`SENALES_CONTROL`, no existe en `COM`**. Es decir, ya es un campo CONTROL-específico por naturaleza, no común.

- **Alternativa A**: vive en `nucleo.senal` (columna nueva, solo aplicable cuando `clase_senal_id='CONTROL'` y `tipo_io_id` es AI/RTD) — un instrumento con varias señales podría, en teoría, alimentar cada una distinto.
- **Alternativa B**: vive en `nucleo.instrumento` — si en la práctica un instrumento siempre alimenta todas sus señales igual.

**Recomendación técnica**: Alternativa A, pero sin certeza — no tengo en el Excel un caso real de un instrumento con dos señales con `CONEX_TIPO` distinto entre sí para confirmar cuál es la granularidad correcta.

**Impacto en el modelo**: 1 columna nueva nullable, en `senal` o en `instrumento` según tu respuesta.

### 8. `TIPO_DATO` de comunicación (`BIT`/`REAL`/`DINT`/etc.)

**Contexto encontrado en el Excel**: columna exclusiva de `COM`/`SENALES_COM` (716/770 poblada), ortogonal a `ESTADO` (la dirección real IN/OUT) — nunca mezcladas entre sí. Es un atributo de **la señal COM en sí** (qué tipo de dato representa ese registro/tag), no del enlace de comunicación físico (`nucleo.enlace_com` ya describe el medio/protocolo, no el contenido del dato).

- **Alternativa A**: columna nueva en `nucleo.senal` (nullable, poblada solo cuando `clase_senal_id='COM'`) — mismo patrón que `tipo_io_id` para CONTROL, junto a `direccion_com_id`.
- **Alternativa B**: en `nucleo.enlace_com` — pero `enlace_com` describe la conexión física (switch/puerto/protocolo), no el dato lógico que viaja por ella; varias señales pueden compartir un mismo `enlace_com` con tipos de dato distintos, así que ahí no calza 1:1.

**Recomendación técnica**: Alternativa A — coherente con dónde ya vive `tipo_io_id` (en `senal`, no en `canal` ni en `modulo`) y con el principio de esta conversación: la especialización por clase vive en columnas nulas de la propia señal.

**Impacto en el modelo**: 1 columna nueva nullable (`tipo_dato_com_id`, FK a un catálogo cerrado `cat.cat_tipo_dato_com` con los 7 valores reales: `BIT`, `REAL`, `DINT`, `WORD`, `UDINT`, `UINT`, `DWORD`) en `nucleo.senal`.

### 9. Bloque de bornera y bornes múltiples por tramo

**Contexto encontrado en el Excel**: `BORNERA_BLOQUE_CAJA` (numeración calculada del bloque dentro de una caja) y `BORNE_JB` (lista de bornes en un solo campo de texto, ej. `"1,2,3"` — un RTD de 3 hilos ocupa 3 bornes en un mismo tramo).

- **Alternativa A**: cerrar la brecha ahora — extender `nucleo.punto_conexion`/`tramo_conexion` para soportar múltiples bornes por tramo y numeración de bloque.
- **Alternativa B**: dejarlo pendiente para una iteración posterior — los 5 ejemplos reconstruidos (sección 9) funcionan hoy sin esto para AI/DI/DO de 2 hilos; solo el caso RTD de 3 hilos lo necesita con precisión.

**Recomendación técnica**: sin recomendación firme — depende de si RTD es una prioridad temprana de esta fase o puede esperar. Lo marco como decisión de alcance, no técnica.

**Impacto en el modelo**: si es Alternativa A, cambio de forma en `punto_conexion` (¿un borne por fila con un `punto_conexion` compartido, o un campo lista?) — ameritaría su propia discusión de diseño antes de tocar código.

### 10. `DISPR`

**Contexto encontrado en el Excel**: valores como `DISPR01`, `DISPR02`… uno por bloque de módulo dentro del chasis, en la misma fila que `SLOT`/`MODELO`/`MODULO`. Sin evidencia suficiente en el archivo para inferir su significado exacto (¿"dispositivo remoto"? ¿alias interno del fabricante del PLC para el módulo?).

**Recomendación técnica**: no puedo recomendar sin tu confirmación directa.

**Impacto en el modelo**: si es un identificador de negocio real (no solo un alias del dibujo), faltaría una columna en `nucleo.modulo`; si es puramente cosmético del dibujo CAD, no hace falta modelarlo.

### 11. `R_CABLE`

**Contexto encontrado en el Excel**: 8.2% de las filas, valores numéricos pequeños (2, 3…), sin patrón claro contra ningún otro campo. Posible "reserva de conductores del cable" pero no confirmado.

**Recomendación técnica**: no puedo recomendar sin tu confirmación directa.

**Impacto en el modelo**: si aplica, 1 columna nueva en `nucleo.cable` (capacidad de reserva) — dato menor.

### 12. Brechas reales de campos comunes en `nucleo.senal` (reformulada — ya no es solo "el bug")

**Contexto encontrado en el Excel**: de los 16 campos que `MASTER_SENALES` unifica para CONTROL y COM por igual, 13 ya están en `nucleo.senal`. Los 3 que faltan — `CAUSA_ALARMA`, `OBSERVACION_REVISION` (distinta de `OBSERVACION`), `COMPLETITUD` — están **100% sin datos reales todavía** en este proyecto (placeholder `"-"` en las 1031 filas), así que no hay riesgo de migrar datos reales, solo hay que decidir si se modelan ahora o se agregan cuando haya contenido real que lo justifique.

- **Alternativa A**: agregar las 3 columnas ahora (`causa_alarma`, `observacion_revision`, `completitud`), aunque hoy no tengan datos — quedan listas para cuando la ingeniería de señales avance.
- **Alternativa B**: agregar solo cuando haya un caso real con datos — evita columnas "fantasma" sin uso por un tiempo indefinido.

**Recomendación técnica**: Alternativa A para `causa_alarma` y `observacion_revision` (son directas, sin ambigüedad de diseño). Para `completitud`: ver pregunta 15 — probablemente no debería ser una columna real.

**Impacto en el modelo**: hasta 2-3 columnas nuevas nullable en `nucleo.senal`.

### 13. `nombre_corto` vs. `SENAL` (sufijo funcional)

**Contexto encontrado en el Excel**: `SENAL` (`RDY`, `REM`, `ESP`, `RUN`, `FAL`...) es el sufijo funcional corto, confirmado idéntico en semántica entre CONTROL y COM, y es la mitad derecha de la fórmula que arma `TAG_SENAL`. `nucleo.senal.nombre_corto` (`NVARCHAR(30)`) ya existe en el modelo pero no hay registro de si se pensó para este propósito exacto.

- **Alternativa A**: `nombre_corto` es exactamente este campo — no hace falta nada nuevo, solo confirmarlo y usarlo así en el futuro importador/formulario de señales.
- **Alternativa B**: son conceptos distintos y hace falta una columna nueva dedicada.

**Recomendación técnica**: Alternativa A — coincide en longitud y en propósito aparente; no crear un campo redundante sin evidencia de que `nombre_corto` signifique otra cosa.

**Impacto en el modelo**: ninguno si es A (reutilizar lo existente).

### 14. `OBSERVACION` vs. `OBSERVACION_REVISION`

**Contexto encontrado en el Excel**: dos columnas separadas en `MASTER_SENALES`, ambas 100% con el placeholder `"-"` — no hay ni un solo dato real todavía que distinga su uso previsto.

- **Alternativa A**: son dos conceptos reales (una nota de ingeniería general, otra específica del proceso de revisión/QA) y `nucleo.senal` necesita las dos columnas.
- **Alternativa B**: es redundancia del Excel (alguien agregó una segunda columna de observación en algún momento sin depurar la primera) y `nucleo.senal.observacion` (ya existe, una sola) alcanza.

**Recomendación técnica**: sin evidencia para decidir — ninguna fila tiene datos reales en ninguna de las dos. Pregunta puramente de tu experiencia de campo con este flujo.

**Impacto en el modelo**: 0 o 1 columna nueva según la respuesta.

### 15. `COMPLETITUD` — ¿columna real o campo calculado?

**Contexto encontrado en el Excel**: 100% de las 1031 filas tienen el mismo placeholder `"-"` — sugiere que nunca fue una columna que alguien completó a mano con un valor real, sino un campo pensado para reflejar "qué tan completa está la ingeniería de esta señal".

- **Alternativa A**: columna real en `nucleo.senal` (texto o enum), completada manualmente — igual que hoy en el Excel.
- **Alternativa B**: **no se almacena** — se calcula en el backend/frontend a partir de qué campos de ingeniería obligatorios ya están llenos (mismo criterio que SIEI ya aplica a otros campos derivados del Excel: `N_PAR_CABLE`, `BORNERA_BLOQUE_CAJA`, `MODULO_VISTA_ORDEN` — nunca se guardan, se calculan).

**Recomendación técnica**: Alternativa B — es exactamente el tipo de campo derivado que el resto de este diagnóstico ya identificó que no debe copiarse tal cual del Excel. Calculado, siempre está actualizado y nunca se desincroniza de los datos reales (a diferencia del `"-"` congelado que tiene hoy el Excel).

**Impacto en el modelo**: 0 columnas nuevas — lógica de presentación en el backend/frontend únicamente.

### 16. Confirmación de cierre del principio de SEÑAL única

**Contexto encontrado**: sección 11 completa de este documento.

- **Alternativa A**: confirmás que `nucleo.senal` como entidad única con especialización por columnas nulas (ya vigente) es la dirección correcta, y las únicas migraciones pendientes sobre `senal` son las brechas puntuales de las preguntas 4, 8 y 12 (más 13-15 si aplican) — nunca separar en tablas por clase.
- **Alternativa B**: hay algún caso real de tu experiencia de campo que este análisis no capturó y que sí justificaría una estructura distinta.

**Recomendación técnica**: Alternativa A, sin reservas — toda la evidencia (el propio `MASTER_SENALES` del usuario, la macro de IDs, el modelo ya vigente de SIEI) apunta en la misma dirección.

**Impacto en el modelo**: ninguno adicional — cierra la discusión conceptual antes de diseñar la migración real.

---

## 12.0 Decisiones ya tomadas por el usuario (esta ronda) — estado de las 16 preguntas

El usuario resolvió la mayoría de las preguntas de la sección 12 directamente, con instrucción explícita de **no implementar todavía**. Estado:

| # | Pregunta | Estado | Resolución |
|---|---|---|---|
| 1 | RIO → GABINETE: ¿rename real? | **RESUELTA** | Sí, rename real y completo (tabla, FKs, triggers, backend, frontend, tests) — no un cambio cosmético de frontend. Se documenta el impacto (ya en sección 5.1) antes de ejecutar. |
| 2 | Catálogo de tipos de gabinete | **RESUELTA** | `cat.cat_tipo_gabinete`, global/extensible, sembrado con `RIO`/`CONTROL`/`COMUNICACION`. No todos los proyectos usan todos los tipos. |
| 3 | Gabinete de comunicaciones vs. `switch` | **RESUELTA** | `switch.gabinete_id` **NULL** (opcional) — no todos los switches están dentro de un gabinete modelado. |
| 4 | `codigo_senal`: ¿una sola secuencia? | **PENDIENTE** (ver sección 13 — se reabre la necesidad misma del campo, no solo si es una o dos secuencias) |
| 5 | Dos macros de ID coexistiendo | **PENDIENTE** — sigue siendo un hecho de campo, ver sección 13 (IDs legacy) |
| 6 | Posición normal/falla de válvula | **RESUELTA (dirección)** | Vive en `nucleo.instrumento`, nunca se copia a instrumentos asociados. Falta el subdiagnóstico de valores reales y si amerita catálogo — ver sección 13.5 (fuera del alcance de señales/terminaciones, pendiente para cuando se diseñe la migración de instrumento). |
| 7 | Alimentación vs. loop-powered | **RESUELTA (separación conceptual)** | Son dos conceptos distintos: `ALIMENTACION_INSTRUMENTO` (característica del instrumento) ≠ `ES_LOOP_POWERED` (característica de la señal CONTROL/su conexionado). Verificado: **no existe hoy ningún campo `es_loop_powered` en el modelo** — se crea nuevo, no se reutiliza nada. `CONEX_TIPO=LP` mapea a `es_loop_powered=1` (confirmado con los 3 ejemplos AI/RTD de la sección 9, todos loop-powered de 4-20mA/HART o resistencia). |
| 8 | `TIPO_DATO_COM` | **RESUELTA** | `cat.cat_tipo_dato_com` + `senal.tipo_dato_com_id` nullable, solo aplica a COM, NO en `enlace_com`. |
| 9 | Bloque de bornera / bornes múltiples | **EN SUBDIAGNÓSTICO** — ver sección 14, todavía sin propuesta de columnas. |
| 10 | `DISPR` | **RESUELTA** | No modelar todavía. Queda documentado (sección 2.1, agrupo F) hasta tener evidencia. |
| 11 | `R_CABLE` | **RESUELTA** | Igual que `DISPR` — no modelar todavía. |
| 12 | Brechas de campos comunes (`CAUSA_ALARMA`, `OBSERVACION_REVISION`, `COMPLETITUD`) | **RESUELTA (cada una por separado)** | `causa_alarma`: **sí**, se agrega a `nucleo.senal` — el bug `CLASE_ALARMA`/`CAUSA_ALARMA` queda documentado como defecto del Excel legado (secciones 2.1 y 11.1), nunca reproducido en SIEI. `observacion_revision`: **no**, por ahora — si en el futuro existe un mecanismo de revisión/aprobación de señales, la observación de esa revisión pertenece a ESE mecanismo, no a `nucleo.senal`. `completitud`: **derivada**, nunca persistida — se calcula en backend/frontend con reglas de campos requeridos, cuando ese cálculo se implemente. |
| 13 | `nombre_corto` = `SENAL` | **RESUELTA Y VERIFICADA** | Confirmado en el código real: `nombre_corto` (`NVARCHAR(30)`, ya existe en `nucleo.senal`) es hoy un campo libre, opcional, sin ninguna regla de negocio ni UNIQUE — cero uso actual que choque con adoptarlo como el sufijo funcional (`RDY`/`REM`/`LI`/`FA`/etc.). No se crea columna nueva. |
| 14 | `OBSERVACION` vs. `OBSERVACION_REVISION` | **RESUELTA** | Ver fila 12 — no se agrega `observacion_revision` a `senal`; queda reservada para un futuro mecanismo de revisión/auditoría de señales. |
| 15 | `COMPLETITUD` | **RESUELTA** | Derivada, no persistida (confirmado, ver fila 12). |
| 16 | Confirmación de cierre del principio de SEÑAL única | **RESUELTA** | Confirmado por el usuario: `nucleo.senal` única, con especialización CONTROL/COM por columnas nulas — arquitectura a mantener sin cambios. |

Quedan genuinamente abiertas: **identidad de señal (`tag_senal`/`codigo_senal`, preguntas 4-5, resuelto en la sección 13)** y **terminaciones/bornes múltiples (pregunta 9, sección 14)**.

---

## 13. Identidad de señal: ¿es `tag_senal` realmente necesario? (evidencia decisiva, no intuición)

El usuario pidió reevaluar `tag_senal`/`codigo_senal` en vez de darlos por necesarios solo porque el Excel los usaba para resolver limitaciones propias de Excel (cruzar hojas, Power Query, macros) — limitaciones que SIEI no tiene, porque ya cuenta con PK/FK relacionales (`nucleo.senal.id`).

### 13.1 Qué depende hoy de `tag_senal` en SIEI (no en el Excel)

`tag_senal` **ya está implementado en SIEI** (no es hipotético): `nucleo.senal.tag_senal NVARCHAR(80) NOT NULL`, con `UX_senal_proyecto_tag` (único filtrado `WHERE activo=1`) — mismo patrón que `tag_instrumento`. Relevado en código real:

- **Backend** (`signals.ts`): `tagSenal` está en `REQUIRED_ON_CREATE` — hoy es obligatorio crear una señal sin él. Se usa para el `ORDER BY` del listado y para el chequeo de unicidad por proyecto.
- **Frontend**: `SignalForm.tsx` lo pide como campo de texto libre obligatorio (`TAG *`, sin ningún botón de "generar automático" ni derivación — hoy un ingeniero lo tipea a mano). `RouteFormPage.tsx`, `RouteDetailPage.tsx`, `RoutesListPage.tsx` lo usan **únicamente como etiqueta de visualización** en selects/breadcrumbs/columnas — nunca como clave de búsqueda o join (todo eso ya pasa por `senalId`/`id`).
- **Tests**: ~15 payloads en `signals.api.test.ts` y `physical-connections.api.test.ts` lo incluyen como campo obligatorio de creación — mecánico de actualizar si deja de serlo, no hay lógica de negocio real atada a su valor.
- **Lazos, COM, causa-efecto, entregables**: **ninguna dependencia real.** `nucleo.lazo` no referencia `tag_senal`. La Matriz Causa-Efecto es un módulo diferido, no existe todavía. El LDI (`generateExcel.ts`, `LdiSnapshotRow`) es sobre instrumentos, nunca incluye `tag_senal`.

**Conclusión**: `tag_senal` no tiene ninguna dependencia funcional profunda hoy — es un campo obligatorio de creación + una etiqueta de visualización. Quitarle la obligatoriedad es un cambio de bajo riesgo, acotado a `signals.ts` (mover fuera de `REQUIRED_ON_CREATE`, ajustar el índice único a filtrado también por `IS NOT NULL`), `SignalForm.tsx` (quitar el `*`) y los ~15 payloads de test.

### 13.2 ¿Puede derivarse siempre para CONTROL? — Sí, con una excepción medible

Verificado con las 269 señales CONTROL reales del proyecto: **269/269 tienen `TAG_SENAL` (100%)**, y la fórmula real del Excel (`=TAG_EQUIPO_INST & "_" & SENAL`) reproduce el valor exacto en **267/269 casos (99.3%)**. Los 2 casos que no coinciden son deriva real de datos (alguien editó `SENAL` después de que `TAG_SENAL` quedara fijado como valor, o viceversa):

| Fila | `TAG_SENAL` real | Reconstruido (`TAG_EQUIPO_INST & "_" & SENAL`) | Diagnóstico |
|---|---|---|---|
| 165 | `620-HV-5078_ZIO` | `620-HV-5078_ZIC` | `SENAL` dice `ZIC`, pero `TAG_SENAL` quedó congelado en `ZIO` — inconsistencia real del dato fuente, no un caso que la fórmula no pueda cubrir. |
| 235 | `620-HV-XXX2_HYO` | `620-HV-XXX2_HYC` | Mismo patrón. |

**Conclusión CONTROL**: sí, derivable de forma determinista en el 100% de los casos reales (`instrumento_u_equipo.tag & "_" & senal.nombre_corto`) — los 2 "mismatches" no son limitaciones de la fórmula, son evidencia de que guardar `tag_senal` como valor independiente permite que se desincronice silenciosamente del origen real. Es un argumento **a favor** de derivarlo siempre en vez de almacenarlo.

### 13.3 ¿Puede derivarse siempre para COM? — No. Evidencia decisiva:

De los **762 señales COM reales** del proyecto (con `ID_SENAL` propio, confirmadas por la macro como señales reales):

- Solo **46 (6%)** tienen `TAG_SENAL`/`SENAL` — y esas 46 SÍ siguen la misma convención `TAG_EQUIPO_INST & "_" & SENAL` al 100% (0 mismatches), aunque tecleada a mano (la hoja `COM` no tiene fórmula ahí, a diferencia de `SENALES`).
- **716 (94%) NO TIENEN `TAG_SENAL` NI `SENAL` EN ABSOLUTO** — son registros/palabras crudas de un controlador (PLC, variador, grupo electrógeno), identificadas únicamente por `ID_SENAL` + `TAG_EQUIPO_INST` (el controlador dueño) + `DESTINO` (texto libre). Ejemplos reales tal cual aparecen en el archivo:

  | `ID_SENAL` | `TAG_EQUIPO_INST` | `DESTINO` | `TAG_SENAL` |
  |---|---|---|---|
  | `620-SIG-000315` | `620-CPC-5003/5004` | `PALABRA DE ESTADO 1 (NOTA 4)` | *(vacío)* |
  | `620-SIG-000317` | `620-CPC-5003/5004` | `PALABRA DE ALARMAS 1 (NOTA 4)` | *(vacío)* |
  | `620-SIG-000319` | `620-CPC-5003/5004` | `HEARTBEAT DEL CONTROLADOR DEL GRUPO ELECTRÓGENO` | *(vacío)* |

**Conclusión COM (decisiva)**: `tag_senal` **no existe en el 94% de los casos reales** — ni derivado ni tecleado. No es una brecha de la fórmula: es que la mayoría de señales COM de este proyecto **nunca tuvieron un tag como concepto de ingeniería** — se identifican por su controlador dueño + una descripción libre. Forzar `tag_senal NOT NULL` para modelarlas hoy obligaría a inventar tags artificiales que no existen en ningún documento de ingeniería real.

### 13.4 Respuestas directas a las 10 preguntas del usuario

1. **¿`tag_senal` es realmente necesario dentro de SIEI?** No como campo obligatorio universal. Es real y útil para CONTROL (100% derivable) y para una minoría de COM (6%, también derivable), pero **inexistente como concepto** para el 94% restante de COM.
2. **¿Qué funcionalidad actual depende de él?** Ninguna funcional profunda — obligatoriedad de creación (`signals.ts`) + etiqueta de visualización (3 páginas de rutas). Nada de lazos, COM, causa-efecto, asignación I/O ni conexionado depende de su valor para funcionar.
3. **¿Qué se rompería si dejara de ser obligatorio?** Nada estructural. Cambios mecánicos: `REQUIRED_ON_CREATE` en `signals.ts`, el índice único (agregar `AND tag_senal IS NOT NULL` al filtro), el `*` de obligatorio en `SignalForm.tsx`, y ~15 payloads de test que hoy siempre lo mandan.
4. **¿Puede derivarse siempre para CONTROL?** Sí, 100% de los casos reales (con 2 casos de deriva de datos que la derivación en tiempo real evitaría).
5. **¿Puede derivarse siempre para COM?** No — 94% de los casos reales no tienen de dónde derivarlo (no existe `SENAL`/sufijo funcional en el origen).
6. **¿Qué casos no pueden reconstruirse?** Los 716 registros crudos de controlador (palabras de estado/alarma, heartbeats, etc.) — identificados solo por equipo dueño + descripción libre, sin ningún tag de ingeniería real detrás.
7. **¿`ID_SENAL`/`codigo_senal` tiene valor de ingeniería fuera de resolver limitaciones del Excel?** No se encontró evidencia de que sí — su único rol documentado (macro `ID_SENAL_AUTO.bas`) es servir de clave de cruce entre hojas/consultas, exactamente la limitación que SIEI no tiene gracias a `nucleo.senal.id`.
8. **¿Conviene conservar los `620-SIG-XXXXXX` existentes solo como referencia legacy?** Si en el futuro se importan señales desde este Excel real, sí — como dato de trazabilidad de origen (de dónde vino cada señal importada), nunca como identidad activa ni recalculado.
9. **¿Para nuevas señales podemos depender únicamente de `senal.id`?** Sí — no se encontró ninguna necesidad de ingeniería real (fuera de resolver las hojas de Excel) que exija generar un nuevo `620-SIG-XXXXXX` para una señal creada directamente en SIEI.
10. **¿Impacto de eliminar la obligatoriedad de `tag_senal`?** Bajo y acotado (ver 13.1) — ningún cambio de esquema en otras tablas, ningún trigger a tocar, ninguna dependencia de `lazo`/`enlace_com`/`entregables`.

### 13.5 Recomendación técnica final (identidad de señal)

- **`tag_senal`**: **Alternativa B del pedido original** — se conserva la columna, pasa a **nullable**, deja de ser obligatoria en creación. Se puede seguir tecleando a mano cuando el ingeniero quiera un tag legible (igual que hoy para CONTROL), y quedará vacía quel cuando no aplique (la mayoría de COM). El índice único pasa a filtrado también por `IS NOT NULL` (mismo patrón ya usado en todo el resto del modelo — ver migración 011 recién aplicada a `revision_entregable_fila.instrumento_id` como precedente directo).
- **`codigo_senal` (`620-SIG-XXXXXX`)**: **Alternativa A/B combinadas** — no se genera automáticamente para señales nuevas (Alternativa A: `senal.id` alcanza). Se agrega igualmente la columna, **nullable**, exclusivamente para preservar el valor legacy tal cual si en el futuro se importan señales desde este Excel u otros similares (Alternativa B) — nunca recalculado, nunca renumerado, sin nueva secuencia propia de SIEI. Si aparecen IDs con el formato legado `ID620...` (macro `VALIDAR_COM_CONTROL.bas`), se preservan igual de literales, sin normalizar a `620-SIG-`.
- **`TAG_SENAL` para reportes/exportaciones futuras**: se puede **derivar en tiempo de generación** (`instrumento_u_equipo.tag & "_" & senal.nombre_corto`) para el ~100% de CONTROL y el 6% de COM que tienen `nombre_corto`; para el resto de COM, un reporte futuro debería mostrar `TAG_EQUIPO_INST` (o el nombre del enlace/controlador) + `descripcion` en su lugar — nunca inventar un tag que no existe.

---

## 14. Subdiagnóstico de terminaciones (bornes múltiples) — sin proponer migración todavía

Cruce de `TB`, `BORNERA`, `T_MODULO`, `TB_CAJA`, `BORNE_JB`, `BORNERA_BLOQUE_CAJA` contra `punto_conexion`/`tramo_conexion`/`par_conductor`/`cable`/`canal` actuales.

### 14.1 Qué representa cada campo (confirmado con datos reales)

| Campo Excel | Lado | Qué es realmente |
|---|---|---|
| `TB` | Módulo (gabinete) | Bloque de terminales del módulo I/O (ej. `TB-01`) — 1 por módulo, no varía por canal. |
| `BORNERA` | Módulo (gabinete) | El par de terminales exacto de ESE canal dentro del `TB`, formato `F<n>-<n+1>` (ej. `F1-2`) — **siempre exactamente 2 números**, confirmado sobre las 488 filas: nunca se vio un `BORNERA` con más de un guion/rango. |
| `T_MODULO` | Módulo (gabinete) | Etiqueta física impresa por el fabricante del PLC en esos 2 terminales (ej. `IN-0;L2-0`) — descriptiva, no es un identificador adicional. |
| `TB_CAJA` | Caja de paso | Bloque de terminales dentro de la caja (siempre vale `"TB"` en los datos vistos — poco informativo, posiblemente un solo bloque físico por caja en este proyecto). |
| `BORNERA_BLOQUE_CAJA` | Caja de paso | **100% derivado** — numeración secuencial calculada (`COUNTIFS`+`SUMIFS`) del bloque dentro de la caja. No se guarda tal cual (ya identificado en el diagnóstico original). |
| `BORNE_JB` | Caja de paso | El/los borne(s) específico(s) que ocupa ESTA señal dentro de `TB_CAJA` — **acá es donde aparece la variabilidad real**: 1 a N números en una lista de texto separada por comas. |

### 14.2 Evidencia real de la variabilidad de `BORNE_JB`

Sobre las 269 señales CONTROL reales, distribución de cantidad de bornes ocupados en la caja:

| Cantidad de bornes | Casos | Ejemplo real |
|---|---|---|
| 2 | 146 | AI `620-PIT-5058_PI` → `BORNE_JB="1,2"` (loop de 2 hilos) |
| 3 | 82 | DI `620-HV-5084_REM` → `BORNE_JB="1,2,3"` |
| 4 | 27 | DO `620-HV-5084_HYC` → `BORNE_JB="15,16,17,18"` |
| 5 | 23 | DO `620-HV-5084_HYO` → `BORNE_JB="10,11,12,13,14"` |

**Importante — todavía no está confirmado qué significa exactamente cada caso**: `BORNERA` (lado módulo) es **siempre** un par de 2 terminales, sin excepción, incluso cuando `BORNE_JB` (lado caja) tiene 4 o 5 — lo que sugiere que `BORNE_JB` no es necesariamente "hilos de esta única señal" sino, en algunos casos, **el rango completo de bornes reservado en el bloque de la caja para el grupo de señales relacionadas de la misma válvula/instrumento** (ej. las 4 señales DI/DO de `620-HV-5084` podrían compartir un bloque contiguo de bornes en la caja, y `BORNE_JB` de cada fila lista el sub-rango que le toca a esa señal específica, no necesariamente "un hilo físico por número"). El caso de 2 bornes (AI loop-powered, 146 casos) sí es inequívoco: 2 hilos = 2 bornes = 1 señal. Los casos de 3/4/5 necesitan tu confirmación de campo antes de asumir "N hilos físicos por señal" — **no hay evidencia en el archivo que distinga "bornes propios de esta señal" de "rango de bornes del bloque compartido".**

### 14.3 Qué ya existe en el modelo y dónde no alcanza

- `nucleo.punto_conexion` ya tiene `regleta`/`bornera`/`borne`/`lado`/`circuito`/`hilo` — pero `borne` es **un campo de texto único**, no una colección. Hoy no hay forma de decir "este tramo termina en los bornes 1, 2 y 3 a la vez" sin, o (a) meter `"1,2,3"` como texto plano (justo el antipatrón que el usuario pidió no reproducir), o (b) crear 3 filas de `punto_conexion` para lo que conceptualmente es un solo punto físico de terminación.
- `nucleo.tramo_conexion` conecta `punto_origen_id`→`punto_destino_id` **1 a 1** — un tramo no puede terminar en 3 puntos de conexión distintos con el modelo actual sin ambigüedad de cuál es "el" destino.
- `nucleo.par_conductor` ya modela conductores individuales dentro de un cable (`numero_par`) — esta pieza SÍ alcanza tal cual para el lado "cuántos conductores hay disponibles en el cable"; el gap es del lado "a qué borne físico termina cada uno".

### 14.4 Alternativas conceptuales (sin elegir todavía — pido tu confirmación antes de diseñar la migración)

- **Alternativa A — `punto_conexion` pasa a representar UN borne físico individual, siempre.** Un tramo con 3 hilos se modela con 3 filas de `tramo_conexion` (una por conductor/borne), todas compartiendo el mismo `par_conductor`... salvo que cada hilo use un conductor distinto del cable, en cuyo caso también serían 3 `par_conductor` distintos. Requiere relajar `CK_tramo_conexion_puntos_distintos` para permitir que varios tramos de la misma ruta compartan `numero_orden` (son "paralelos", no secuenciales) — cambio de semántica en la validación de rutas.
- **Alternativa B — nueva tabla `punto_conexion_borne` (o similar), hija de `punto_conexion`, uno-a-muchos.** `punto_conexion` sigue representando "el bloque de terminación" (ej. la caja o el módulo), y una tabla nueva lista los bornes individuales ocupados dentro de ese bloque para una ruta/tramo dado. Mantiene `tramo_conexion` 1 origen→1 destino sin tocar su semántica actual, y evita duplicar filas de `punto_conexion` cuando en realidad es un solo bloque físico compartido.
- **Alternativa C — dejarlo como texto por ahora** (`BORNE_JB`-equivalente como campo libre en `tramo_conexion` o `punto_conexion`), documentado explícitamente como deuda técnica, y resolverlo cuando el primer caso real de generación de diagramas de conexionado lo exija. Es lo más rápido, pero reproduce parcialmente el antipatrón que pediste evitar.

**Recomendación técnica**: Alternativa B — es la que menos toca lo que ya funciona (no altera la semántica de `tramo_conexion` ni sus triggers de validación de secuencia) y modela el hecho real de que "varios bornes pueden pertenecer al mismo bloque de terminación" sin forzar una fila de `punto_conexion` completa por cada uno. Pero antes de comprometerla necesito que confirmes el punto abierto de la sección 14.2 (¿"bornes de esta señal" o "rango del bloque compartido"?), porque cambia qué tabla referencia a qué.

**No propongo columnas ni SQL todavía** — es display conceptual, a la espera de tu confirmación.

---

## 15. Propuesta conceptual final (sin implementar) — GABINETES / SEÑALES / TERMINACIONES

### A. GABINETES

- `nucleo.rio` → `nucleo.gabinete` (rename real de tabla).
- `nucleo.rio.rio_id` → columnas renombradas en `rack`/`punto_conexion` a `gabinete_id`.
- Nueva `cat.cat_tipo_gabinete` (`RIO`/`CONTROL`/`COMUNICACION`), `nucleo.gabinete.tipo_gabinete_id NOT NULL FK`.
- `nucleo.switch.gabinete_id BIGINT NULL FK` (opcional).
- 3 triggers a reescribir (mismos nombres, misma lógica, columnas renombradas).
- Backend: `rios.ts`→`gabinetes.ts` (o mantener archivo y solo renombrar router/rutas — a decidir en el diseño), `racks.ts`, `connectionPoints.ts`.
- Frontend: `RiosListPage.tsx`/`RioDetailPage.tsx`→`GabinetesListPage.tsx`/`GabineteDetailPage.tsx`, `api/rios.ts`→`api/gabinetes.ts`, hooks de formularios de punto de conexión/rutas.
- Tests: `physical-hierarchy.api.test.ts`, `physical-connections.api.test.ts`.

### B. SEÑALES

- `nucleo.senal` se mantiene como entidad única (sin cambios de arquitectura).
- Campos nuevos a agregar: `causa_alarma NVARCHAR`, `tipo_dato_com_id BIGINT NULL FK` (+ `cat.cat_tipo_dato_com` nueva), `es_loop_powered BIT NULL`.
- `tag_senal` pasa a `NULL`-able (índice único ajustado a filtrado `WHERE tag_senal IS NOT NULL AND activo=1`).
- `codigo_senal NVARCHAR NULL` nueva (legacy/importación únicamente, índice único filtrado `WHERE codigo_senal IS NOT NULL`).
- `nombre_corto` se reutiliza tal cual (sin cambio de esquema) para el sufijo funcional.
- `NC`/`NO`/`FL`/`FO`/`FC` y `alimentacion_instrumento` van en `nucleo.instrumento` (fuera de esta migración de señales en sentido estricto, pero relacionado — a confirmar si va en la misma migración o en una de instrumentos).
- Backend: `signals.ts` (quitar `tagSenal` de `REQUIRED_ON_CREATE`, agregar los campos nuevos), frontend `SignalForm.tsx`.

### C. TERMINACIONES

- Pendiente de tu confirmación (sección 14.4) antes de listar columnas/tablas concretas.
- Alcance previsto (si se confirma Alternativa B): 1 tabla nueva hija de `punto_conexion`, sin tocar `tramo_conexion`/`par_conductor`/`canal`.

### ¿Conviene dividir las migraciones?

**Sí, en 2, no en 1**:

- ~~`008_gabinetes_senales.sql`~~ / ~~`009_terminaciones.sql`~~ — **superseded, ver sección 26** (revisado con la numeración real del repositorio — `008`-`011` ya existen, aplicados y en uso por trabajo de esta misma sesión).

---

## 16. Aclaración fundamental: `SENALES` es una hoja de trabajo para CAD, no el modelo de datos

El usuario aclaró el propósito histórico real: `SENALES` se construyó para poder generar, vía Power Query, una tabla plana que alimentara el dibujo del **plano de conexionado en AutoCAD** — no para ser en sí misma una tabla maestra. El flujo real era `INSTRUMENTOS/EQUIPOS → SENALES → GABINETE/MÓDULO/CANAL → CAJAS/CABLES/BORNERAS → PLANOS → Power Query → tabla plana → AutoCAD`.

Esto **confirma y refuerza** (no contradice) todo lo ya diagnosticado: la razón por la que `SENALES` mezcla 5+ conceptos en una fila es exactamente esa necesidad de tabla plana para CAD — nunca fue pensada como diseño relacional. La arquitectura correcta para SIEI es la inversa: **datos normalizados → relaciones → vista/query de conexionado → exportación para CAD**, con la vista reconstruyendo lo que antes vivía "a mano" en la hoja. Esto se desarrolla en la sección 20 (`vw_conexionado`).

### 16.1 Reclasificación de campos de `SENALES` por entidad de origen real

Con este marco, cada bloque de columnas de `SENALES` se reclasifica por su **entidad dueña real** (no por dónde aparece en la hoja):

**1. Datos que son realmente de SEÑAL** (pertenecen a `nucleo.senal`, ya confirmado en secciones 11-13): `ID_SENAL`/`codigo_senal` (legacy), `TAG_SENAL` (derivable, ya no obligatorio), `SENAL`/`nombre_corto`, `DESTINO`/`descripcion`, `TIPO_SENAL`, `MODULO_VISTA`/`tipo_io_id`, `CONEX_TIPO`/`es_loop_powered`, `ENCLAVAMIENTO`, `ALARMA_HH/H/L/LL`, `RANGO_MIN/MAX`, `UNIDAD_INGENIERIA`, `VALOR_NORMAL`, `CAUSA_ALARMA`, `PRIORIDAD_ALARMA`, `RETARDO`, `OBSERVACION`, `ESTADO_REVISION`, `ESTADO`/`TIPO_DATO` (COM), `SWITCH`/`PUERTO` (vía `enlace_com`, relación, no columna directa).

**2. Datos que vienen de INSTRUMENTO** (viven en `nucleo.instrumento`, se obtienen por `senal.instrumento_id → instrumento`, **NUNCA se duplican en `senal`**): `TAG_INSTRUMENTO`, `TIPO_INSTRUMENTO`, `SERVICIO`, `SISTEMA`, `NODO`, `TECNOLOGIA`, `FUNCIONAMIENTO`, `CUERPO_INSTRUMENTO`, `ID_INSTRUMENTO`, `PnPID`, `TAG_WSP`, `LINEA`, `EQUIPO_ASOCIADO` (el tag de texto, ya modelado como `equipo_asociado_tag`), `P&ID` (ya `plano_pnid`), `CONEX_TIPO`-de-instrumento cuando aplica a válvulas (ver punto 11 más abajo — NC/NO/FL/FO/FC, que son del instrumento, no de la señal). Confirmado: ninguno de estos aparece con un valor propio distinto por señal cuando el mismo instrumento tiene varias señales — son copias repetidas del mismo dato del instrumento en cada fila (verificable: las 4 señales DI/DO de `620-HV-5084` comparten idénticos `TIPO_INSTRUMENTO`, `SERVICIO`, `SISTEMA`, etc. en las 4 filas).

**3. Datos que vienen de INSTRUMENTO ASOCIADO**: `TAG_INSTRUMENTO_ASOCIADO` — no es un atributo de la señal ni una columna nueva; es una relación entre instrumentos que ya existe (`instrumento.instrumento_asociado_id`). Una futura vista de conexionado la resuelve con un segundo JOIN: `instrumento.instrumento_asociado_id → instrumento` (self-join), no con una columna en `senal`.

**4. Datos que vienen de EQUIPO** (cuando el dueño es un equipo, no un instrumento): mismo patrón que (2) pero vía `senal.equipo_id → nucleo.equipo` — `EQUIPO`, `DESCRIPCION_EQUIPO`, `PANEL`, `SISTEMA`, `NODO`, `P&ID` del equipo. Confirmado en `COM`: filas con `EQUIPO='620-CPC-5003/5004'` repiten el mismo `PANEL`/`SISTEMA` en todas sus señales.

**5. `TAG_EQUIPO_INST` — confirmado como campo derivado, nunca dato maestro.** El usuario documentó su propio motivo de negocio: necesitaba una sola columna para "el dueño real de la señal" independientemente de si era instrumento o equipo, para simplificar fórmulas/Power Query/CAD. En SIEI el equivalente exacto ya existe estructuralmente como el XOR `senal.instrumento_id`/`senal.equipo_id` (con `CK_senal_origen_xor`, que ya impide que ambos o ninguno estén poblados). El valor de texto se reconstruye en la futura vista: `COALESCE(instrumento.tag_instrumento, equipo.tag_equipo)`. **Clasificación: DERIVADO / VISTA — no se crea ninguna columna `tag_equipo_inst` en `nucleo.senal`.**

---

## 17. Auditoría de CAJAS — `nucleo.caja` actual vs. datos reales del Excel

### 17.1 `nucleo.caja` hoy

```
nucleo.caja: id, proyecto_id, tag_caja, descripcion, activo, created_at, updated_at
```

Mínimo: solo identidad + descripción libre. Nada de terminación, plano ni relación con gabinete/instrumento.

### 17.2 Campos de caja en el Excel, clasificados

| Campo Excel | % poblado (de 269 filas con señal real) | Clasificación | Dónde va |
|---|---|---|---|
| `CAJA_EQUIPO` | 100% (269) | **DERIVADO/VISTA** — es un destino genérico, no siempre una caja (ver 17.3) | No se modela como campo propio; se resuelve a `caja_id` **o** `equipo_id` en `punto_conexion`, según corresponda |
| `TAG_CAJA` | 66.5% (179 de 269) | **DATO MAESTRO** | `nucleo.caja.tag_caja` (ya existe) |
| `TB_CAJA` | 66.5% (179) — pero **100% de esas 179 vale literalmente `"TB"`**, sin ninguna variación real en todo el archivo | **ARTEFACTO DE EXCEL** (constante sin información) o, si el usuario confirma que puede variar en otros proyectos, campo real de baja prioridad | No modelar por ahora — cero evidencia de variabilidad |
| `BORNERA_BLOQUE_CAJA` | 66.5% (179) | **DERIVADO** — confirmado con fórmula (`COUNTIFS`+`SUMIFS`), numera el bloque dentro de la caja | No se almacena; se calcula igual que `MODULO_VISTA_ORDEN` |
| `BORNE_JB` | 66.5% (179) | **PENDIENTE (sección 21/22 — terminaciones)** | `punto_conexion`/tabla de bornes futura, no resuelto todavía |
| `B_NUM_RESERVA` | 4.5% (12 de 269) | **DATO MAESTRO, de capacidad** — bornes de reserva/spare disponibles en el bloque | Candidato a `nucleo.caja` (o a la futura tabla de bloque de bornera) — bajo volumen, baja prioridad |
| `ORDEN_INST_CAJA` | 66.5% (179) | **DERIVADO** — confirmado con fórmula (numera instrumentos dentro de la misma caja) | No se almacena — se deriva del orden real de inserción/consulta |
| `TAG_CABLE_INST` | 70.3% (189 de 269) | Ya cubierto — pertenece a CABLES/TRAMOS (sección 18), es el cable del segundo tramo (instrumento↔caja), no un atributo de la caja en sí |

**Brecha real**: `nucleo.caja` no tiene ningún campo de **plano asociado** (ver sección 19 — `PLANO_GANCHO`, el plano del extremo de campo, está indexado por `CAJA_EQUIPO`/`TAG_CAJA` en el Excel) ni de **ubicación física** (`UBICACIÓN`, casi vacía en los datos pero existente como concepto). Ambas se resuelven mejor como relación a la futura entidad `PLANO` (sección 19) que como columnas de texto en `caja`.

### 17.3 `CAJA_EQUIPO` vs. `TAG_CAJA` — confirmado con evidencia exacta, la distinción es real y ya resoluble con el modelo actual

Verificado con las 269 señales reales:

- **179 filas (66.5%)**: `TAG_CAJA` poblado — el destino ES una caja de conexiones real (`620-TBC-XXX1`, `620-TBJ-5014`, etc.), y **siempre y sin excepción** trae también `TB_CAJA`/`BORNE_JB`/`BORNERA_BLOQUE_CAJA` (179/179 en las 3).
- **90 filas (33.5%)**: `CAJA_EQUIPO` poblado (ej. `620-AFM-5005`, `620-AFL-5001`) pero **`TAG_CAJA` vacío** — el cable de home-run termina directo en el panel local de un equipo (arrancador de motor, VFD), sin caja de paso intermedia. De estas 90, solo 10 traen `TB_CAJA`/`BORNE_JB`/`BORNERA_BLOQUE_CAJA` — probablemente porque ese equipo puntual sí expone su propio bloque de terminales etiquetado igual que una caja (excepción real, minoritaria, no central).

**Esto significa que la distinción `CAJA_EQUIPO` (genérico) vs. `TAG_CAJA` (caja real confirmada) NO requiere ningún cambio de modelo — ya está resuelta por el diseño XOR existente de `nucleo.punto_conexion`** (`instrumento_id`/`equipo_id`/`caja_id`/`rio_id`/`modulo_id`, mutuamente excluyentes). El "destino genérico" del Excel (`CAJA_EQUIPO`) se resuelve en el futuro importador/formulario de señales así:

```
si TAG_CAJA coincide con el patrón de una caja real (o el usuario la selecciona explícitamente como caja)
    → punto_conexion.caja_id = esa caja
si no, y CAJA_EQUIPO coincide con un equipo existente
    → punto_conexion.equipo_id = ese equipo
```

**No se propone ninguna columna nueva para esto — es lógica de resolución en el backend, no una brecha de esquema.**

---

## 18. Datos de CABLES/TRAMOS — confirmación, sin cambios respecto al diagnóstico original

Ya cubierto en las secciones 2.1 y 9 del diagnóstico original: `TAG_CABLE`/`TAG_CABLE_INST` (dos tramos, DERIVADOS por fórmula en `TAG_CABLE`, manual en `TAG_CABLE_INST`), `TIPO_CABLE`/`TIPO_CABLE_INST` (`nucleo.cable.tipo_cable`), `N° CABLE`/`N_PAR_CABLE` (DERIVADO, `nucleo.par_conductor.numero_par`). `nucleo.cable`/`nucleo.par_conductor`/`nucleo.tramo_conexion` ya cubren esto — sin brechas nuevas encontradas en esta ronda.

---

## 19. Auditoría completa de la hoja `PLANOS`

### 19.1 Columnas, una por una

| Columna | Significado | Ejemplo real | Tipo |
|---|---|---|---|
| `ITEM` | Correlativo interno de la hoja (1, 2, 3… con saltos — fila 8 es ITEM 8, fila 9 es ITEM 9, pero antes hay un salto de 6→8) | `1`, `8`, `15` | Posicional, sin valor de negocio |
| `DESCRIPCION` | Título completo del plano, formato libre pero consistente: `"E&C - <ÁREA> - DIAGRAMAS DE CONEXIONADO - <TABLERO O ""TABLERO X""> - HOJA N"` | `"E&C - ESTACIÓN BOOSTER - DIAGRAMAS DE CONEXIONADO - 620-RIO-5012 - HOJA 1"` | Texto descriptivo |
| `CODIGO` | El **código de plano real**, formato `620-J-NNNNN` (disciplina J = Instrumentación/Eléctrico en la nomenclatura del proyecto) | `620-J-20017` | Código, es la clave que referencian otras hojas |
| `TABLERO` | El tag del gabinete o caja al que pertenece ese plano — **mezcla RIO, PCC (gabinetes) y TBC/TBJ (cajas)** bajo la misma columna | `620-RIO-5012`, `620-TBC-XXX1` | Referencia a GABINETE o CAJA (ambos) |
| `TABLERO_WSP` | Código alterno/cliente del mismo tablero — mismo patrón que `TAG_WSP` de instrumentos | `620-RIO-T103`, `620-TBJ- 20X44` | Identificador alterno |
| `PLANO_CONEX_INTERIOR` | Un SEGUNDO código de plano, del diagrama de conexionado **interior** del gabinete — **solo presente en filas cuyo `TABLERO` es un RIO real, nunca en filas de caja (TBC/TBJ)** | `620-J-2023` | Código, referencia cruzada a otro plano |
| `ESTAD0` *(sic, con cero)* | Estado de revisión del plano — valores reales: `B` (16), `A` (6), `INI` (5), `ANULADO` (1) | `B` | Estado — sugiere una progresión `INI → A → B → …`, con `ANULADO` como estado terminal |

### 19.2 Qué la referencia, y por qué fórmula/relación

Confirmado con las fórmulas reales de `SENALES` (sección 2, ya documentado): `DESCRIPCION_PLANO_INTERIOR` e `DESCRIPCION_PLANO_RIO` hacen `INDEX/MATCH` contra `PLANOS!$C:$C` (la columna `CODIGO`) usando `PLANO_INTERIOR_RIO` y `PLANO_RIO` respectivamente como clave de búsqueda; `PLANO_GANCHO_DESCRIPCION` hace lo mismo con `PLANO_GANCHO`. Es decir: **`PLANOS!CODIGO` es la clave única del catálogo**, consultada desde 3 puntos distintos de `SENALES` — los 3 son en realidad "qué plano de conexionado corresponde a este segmento físico" (interior del gabinete, conexionado general del gabinete, y el "gancho"/extremo de campo).

**Hallazgo importante — `PLANO_LAZO` y `P&ID` NO están en este catálogo**: verificado directamente, 0 de 189 valores de `PLANO_LAZO` y 0 de 189 valores de `P&ID` de `SENALES` coinciden con ningún `CODIGO` de la hoja `PLANOS`. Confirma que son **series de planos completamente distintas**, cuyo catálogo fuente ni siquiera vive en este archivo — `P&ID` ya tiene su propio circuito en SIEI (`instrumento.plano_pnid`, migración 004); `PLANO_LAZO` es hoy solo texto libre en `instrumento`/`lazo`, sin catálogo propio en ningún Excel de referencia disponible.

### 19.3 Tipos reales de plano encontrados en todo el diagnóstico (no solo esta hoja)

| Tipo real | Evidencia | ¿Tiene catálogo propio hoy en el Excel? |
|---|---|---|
| **Conexionado** (de gabinete o caja) | Hoja `PLANOS` completa — 41 filas, exclusivamente esto | Sí — es literalmente el propósito único de esta hoja |
| **Interior de gabinete** | `PLANO_CONEX_INTERIOR` en `PLANOS`, y `PLANO_INTERIOR_RIO` en `SENALES` | Sí, mismo catálogo (`PLANOS!CODIGO`), solo aplica a gabinetes RIO |
| **"Gancho"** (extremo de campo / diagrama de conexionado del instrumento-equipo) | `PLANO_GANCHO`/`PLANO_GANCHO_DESCRIPCION` en `SENALES` | Sí, mismo catálogo `PLANOS!CODIGO` |
| **Lazo** | `PLANO_LAZO` en `SENALES`, `instrumento`, `nucleo.lazo.codigo_documento` | No — texto libre, sin catálogo fuente en este archivo |
| **P&ID** | `instrumento.plano_pnid` | Ya resuelto por el módulo de importación P&ID (migración 004) — **fuera del alcance de esta unificación**, tiene su propio ciclo de vida (viene de Plant3D, no de un catálogo manual) |
| **Layout/Ubicación** | Mencionado por el usuario como necesidad futura; en `SEN` (01_MASTER_INSTRUMENTOS) existe `PLANO_UBICACION` como columna, sin catálogo propio tampoco | No — a incorporar sin datos reales todavía |

---

## 20. Propuesta conceptual: entidad `nucleo.plano`

### 20.1 Diseño propuesto (conceptual, no final) — CORREGIDO

**Corrección importante de esta ronda**: la versión anterior de este diseño ponía un `codigo_wsp` dentro de `nucleo.plano`, confundiendo `PLANOS.TABLERO_WSP` (un identificador del **elemento físico** documentado por el plano — gabinete o caja) con un atributo del **plano mismo**. Son cosas distintas: `PLANOS.CODIGO` es del plano; `PLANOS.TABLERO`/`TABLERO_WSP` son del gabinete/caja que ese plano documenta. Corregido:

```
nucleo.plano
├── id
├── proyecto_id           (por proyecto, nunca catálogo global — ver 31.3)
├── codigo_plano          (ej. "620-J-20017")  ← PLANOS.CODIGO
├── codigo_anterior  NULL (nomenclatura anterior DEL MISMO PLANO, si existe evidencia — ver 31.1; NO viene de TABLERO_WSP)
├── descripcion
├── tipo_plano_id         → cat.cat_tipo_plano
├── estado                (ACTIVO/ANULADO — ver 31.2, NUNCA la revisión A/B/INI)
└── activo, timestamps, created_by/updated_by
```

`gabinete.tag_anterior` y `caja.tag_anterior` (si `TABLERO_WSP` se confirma como tal) viven en **sus propias tablas**, nunca en `plano` — ver sección 31.1.

`cat.cat_tipo_plano` — candidatos confirmados con evidencia real (ver hallazgo de LAYOUT en 31.4, que corrige la ronda anterior): `CONEXIONADO`, `INTERIOR_GABINETE`, `GANCHO`/`EXTREMO_CAMPO`, `LAYOUT` (sí hay evidencia real, corregido), y espacio para `LAZO`/`UBICACION` cuando haya datos poblados. **`P&ID` no entra en este catálogo** — sigue siendo su propio circuito ya resuelto (migración 004).

### 20.2 Cardinalidad real entidad↔plano — relaciones tipadas, no tabla genérica

Confirmado con evidencia que la cardinalidad varía por tipo de entidad:

- **GABINETE**: **1 plano interior** + **N planos de conexionado** (un RIO real tiene 6 hojas de conexionado, todas del mismo `TABLERO`) + posible **plano de layout** (hallazgo nuevo, sección 31.4).
- **CAJA**: **N planos de conexionado** (mismo patrón), pero **nunca** plano interior (confirmado: ninguna fila de tipo caja tiene `PLANO_CONEX_INTERIOR`).
- **LAZO**: 1:1 (`nucleo.lazo.codigo_documento`, sin cambios — ver sección 22).

**Corregido según indicación explícita del usuario: NADA de tabla genérica `entidad_plano` con `tipo_entidad`+`entidad_id`** (pierde FKs reales, permite referencias inválidas sin control del motor). En su lugar, **relaciones tipadas por dominio, cada una con su propia FK real**:

```
nucleo.gabinete_plano
├── id
├── proyecto_id
├── gabinete_id  → nucleo.gabinete (FK compuesta con proyecto_id)
├── plano_id     → nucleo.plano   (FK compuesta con proyecto_id)
├── rol          (CONEXIONADO | INTERIOR | LAYOUT — reutiliza o referencia cat_tipo_plano)
└── UNIQUE (gabinete_id, plano_id)

nucleo.caja_plano
├── id
├── proyecto_id
├── caja_id      → nucleo.caja (FK compuesta con proyecto_id)
├── plano_id     → nucleo.plano (FK compuesta con proyecto_id)
├── rol          (CONEXIONADO — únicamente, según evidencia: nunca INTERIOR ni LAYOUT en caja)
└── UNIQUE (caja_id, plano_id)
```

Esto soporta el caso real de 6 planos de conexionado para un mismo gabinete (6 filas en `gabinete_plano`, mismo `gabinete_id`, distinto `plano_id`) sin perder ninguna FK real — cada relación queda protegida por el motor, a diferencia de una tabla genérica.

---

## 21. `PLANO` vs. `ENTREGABLE` (migración 006) — análisis y recomendación

### 21.1 Qué es `entregable`/`revision_entregable` hoy, revisado con precisión

Confirmado revisando `006_entregables_base.sql` y `CLAUDE.md`: `entregable` es un documento **generado por SIEI** desde una plantilla propia (`plantilla_entregable`, blob binario) combinada con datos vivos del Master, congelado en cada `revision_entregable` (snapshot JSON + archivo `.xlsx` generado por SIEI mismo, con hash SHA-256). Todo el ciclo — plantilla, criterios de orden, generación del binario — asume que **SIEI es quien produce el contenido**.

`entregable.numero_documento` sí es lo bastante flexible en su forma (`componente_etapa`/`_proyecto`/`_cliente` son todos `NULL`-ables, solo `componente_tipo` y `componente_correlativo` son obligatorios) como para poder representar, en teoría, un código simple como `620-J-20017` (dejando etapa/proyecto/cliente vacíos) — la forma no es un impedimento.

### 21.2 Por qué `PLANO` no debería apoyarse en `entregable` tal cual

La diferencia real no es de numeración, es de **quién genera el contenido**: un plano CAD lo dibuja un proyectista en AutoCAD, fuera de SIEI — SIEI nunca genera su contenido desde una plantilla propia. Reutilizar `entregable`/`revision_entregable` obligaría a cargar con columnas irrelevantes para un plano (`plantilla_id NOT NULL` en una revisión `EMITIDA`, `configuracion_orden_id`, `criterios_aplicados_json` — todos conceptos exclusivos de "documento generado desde datos + plantilla") o a dejarlas sistemáticamente vacías/forzadas, acoplando dos dominios con ciclos de vida distintos a través de una sola tabla.

### 21.3 Alternativas

- **Alternativa A**: `PLANO` como entidad propia, completamente independiente de `entregable` — un catálogo de documentos vivos (código + descripción + tipo + estado), sin mecanismo de revisión/archivo propio por ahora. Si en el futuro hace falta versionar el PDF/DWG real, se agrega un mecanismo específico (`revision_plano`/`plano_archivo`) que **replica el patrón** de inmutabilidad de `revision_entregable_archivo` (mismo espíritu: nunca se edita un archivo ya emitido) pero en su propia tabla — nunca reutilizando la tabla de LDI.
- **Alternativa B**: `PLANO` como un `tipo_entregable` más (`PLANO_CONEXIONADO`, `PLANO_LAZO`, etc.), reutilizando toda la maquinaria de `entregable`/`revision_entregable`/`plantilla_entregable`.
- **Alternativa C**: híbrida — `PLANO` es su propia entidad (como A) para el catálogo/identidad documental, pero cuando SIEI necesite adjuntar el archivo real (PDF/DWG subido, no generado), usa una tabla de archivo propia con el mismo patrón de inmutabilidad que `revision_entregable_archivo`, sin ningún vínculo a `entregable`.

**Recomendación técnica**: **Alternativa A (evolucionando a C si aparece la necesidad de archivo)**. `entregable` está diseñado y ya probado en producción específicamente para "SIEI genera esto desde una plantilla" — forzar un plano CAD (que SIEI nunca genera) dentro de esa maquinaria es acoplar por conveniencia de nomenclatura, no por necesidad real. Un catálogo de planos simple, propio, es más barato de mantener y no arrastra columnas NOT NULL que no aplican.

**Impacto en el modelo**: 1 tabla nueva (`nucleo.plano`), 1 catálogo (`cat.cat_tipo_plano`), sin tocar `entregable`/`revision_entregable` en absoluto.

---

## 22. Planos de conexionado, de lazo, y futuro layout/ubicación

- **Conexionado**: cubierto en la sección 20 — `nucleo.plano` con `tipo_plano_id='CONEXIONADO'`, relación 1:N con `gabinete`/`caja`.
- **Lazo**: `nucleo.lazo.codigo_documento` (`NVARCHAR(100)`, texto libre) es hoy el único lugar. **Recomendación**: no cambiarlo todavía a una FK — no hay evidencia en ningún Excel de referencia de un catálogo real de planos de lazo (0 coincidencias contra `PLANOS!CODIGO`, confirmado en 19.2). Cuando exista un caso real con datos, migrar `codigo_documento` a `plano_id` (FK a `nucleo.plano` con `tipo_plano_id='LAZO'`) es un cambio de columna simple y no bloqueante hoy.
- **Layout/Ubicación**: sin datos reales todavía (confirmado — ni en `02_MASTER_IO_620` ni evidencia poblada en `SEN`/`01_MASTER_INSTRUMENTOS` más allá de la columna `PLANO_UBICACION` vacía). El diseño de `cat.cat_tipo_plano` como catálogo abierto/extensible (no cerrado a 3 valores) ya deja espacio para agregar `LAYOUT`/`UBICACION` sin migración estructural — solo un `INSERT` en el catálogo el día que haya datos reales que lo justifiquen.

---

## 23. Propuesta conceptual de futura vista `vw_conexionado` (esquema lógico, sin implementar)

Reconstrucción del esquema lógico de la tabla plana que necesitaría un futuro exportador a CAD, con la tabla fuente y relación real de cada grupo:

| Grupo | Tabla fuente | Relación usada | ¿Derivado? |
|---|---|---|---|
| Señal | `nucleo.senal` | directa | — |
| Instrumento/equipo dueño | `nucleo.instrumento` / `nucleo.equipo` | `senal.instrumento_id` XOR `senal.equipo_id` | `TAG_EQUIPO_INST` = `COALESCE(instrumento.tag_instrumento, equipo.tag_equipo)` — derivado en la vista |
| Instrumento asociado | `nucleo.instrumento` (self-join) | `instrumento.instrumento_asociado_id → instrumento` | — |
| Datos del instrumento | `nucleo.instrumento` | mismo JOIN que "dueño" | — |
| Gabinete | `nucleo.gabinete` (post-rename) | `canal → modulo → slot → rack → gabinete` | — |
| Rack/chasis | `nucleo.rack` | igual | — |
| Slot | `nucleo.slot` | igual | — |
| Módulo | `nucleo.modulo` + `cat.cat_modulo_io` | igual | — |
| Canal | `nucleo.canal` | `senal.canal_id` | — |
| Caja | `nucleo.caja` **o** `nucleo.equipo` | `punto_conexion.caja_id` / `.equipo_id` del tramo final (ver 17.3) | resolución CAJA_EQUIPO→caja_id/equipo_id ya es de por sí una decisión tomada al importar, no una fórmula de la vista |
| Cables | `nucleo.cable` + `nucleo.par_conductor` | vía `tramo_conexion.par_conductor_id`, uno por tramo | `TAG_CABLE`/`N_PAR_CABLE`-equivalentes ya no derivados en la vista — son datos reales de `cable` |
| Terminaciones | `nucleo.punto_conexion` (+ futura tabla de bornes, sección 21 pendiente) | `tramo_conexion.punto_origen_id`/`.punto_destino_id` | pendiente el diseño de bornes múltiples |
| Planos | `nucleo.plano` | relación 1:N (gabinete/caja) y 1:1 (lazo) — sección 20 | — |

Esta vista demuestra que el modelo normalizado puede reproducir el 100% de la información que el Excel necesitaba para CAD, sin necesidad de una tabla plana persistida — se recalcula bajo demanda.

---

## 24. Clasificación completa de campos derivados/artefactos (consolidado)

| Campo | Clasificación | Nota |
|---|---|---|
| `TAG_EQUIPO_INST` | D. DERIVADO / VISTA | `COALESCE(instrumento.tag, equipo.tag)` |
| `TAG_SENAL` | C/D. Derivable, ya no obligatorio | Ver sección 13 |
| `TAG_CABLE` | C. DERIVADO | Fórmula confirmada |
| `TAG_CAJA` | C. DERIVADO (a partir de `CAJA_EQUIPO`), pero **el resultado sí es dato maestro** una vez resuelto | Ver 17.3 |
| `N_PAR_CABLE` | C. DERIVADO | `COUNTIF` acumulativo |
| `BORNERA_BLOQUE_CAJA` | C. DERIVADO | `COUNTIFS`+`SUMIFS` |
| `MODULO_VISTA_ORDEN` | C. DERIVADO | Fórmula `LET` |
| `ORDEN_INST_CAJA` | C. DERIVADO | Fórmula `LET`/`MAXIFS`, confirmado en esta ronda |
| `DESCRIPCION_PLANO_INTERIOR`/`_RIO`, `PLANO_GANCHO_DESCRIPCION` | D. VISTA/EXPORTACION | `INDEX/MATCH` contra `PLANOS`, se resuelve con JOIN a `nucleo.plano` |
| `TB_CAJA` | E. ARTEFACTO DE EXCEL | 100% constante (`"TB"`), sin variación real |
| `DISPR` | F. SIGNIFICADO NO CONFIRMADO | Sin cambios — no modelar |
| `R_CABLE` | F. SIGNIFICADO NO CONFIRMADO | Sin cambios — no modelar |
| `Column50`/`Column51` (NC/NO, FL/FO/FC) | A. DATO MAESTRO (de instrumento) | Ver pregunta pendiente sobre catálogo, sección 12 pregunta 6 |
| `CONEX_TIPO` | A. DATO MAESTRO (de señal, `es_loop_powered`) | Ver sección 12.0 fila 7 |
| `CAUSA_ALARMA` | A. DATO MAESTRO (de señal) | Se agrega a `nucleo.senal` |
| `COMPLETITUD` | D. VISTA/EXPORTACION (calculado) | Nunca persistido |
| `OBSERVACION_REVISION` | E/F. No se modela ahora | Reservado a futuro mecanismo de revisión de señales |

---

## 25. Brechas reales del modelo actual (consolidado tras esta ronda)

1. `nucleo.rio` sin distinción de tipo (RIO→GABINETE, ya resuelto conceptualmente, pendiente de ejecutar).
2. `nucleo.senal` sin `causa_alarma`, `tipo_dato_com_id`, `es_loop_powered`, `codigo_senal` (nullable, legacy).
3. `nucleo.senal.tag_senal` obligatorio hoy — debe volverse opcional.
4. `nucleo.caja` sin relación a plano ni a gabinete contenedor (¿una caja pertenece físicamente a/cerca de un gabinete? — sin evidencia explorada todavía, posible pregunta nueva).
5. `nucleo.punto_conexion`/`tramo_conexion` sin soporte de bornes múltiples por tramo (pendiente, sección 21/22, no resolver todavía).
6. No existe `nucleo.plano` ni `cat.cat_tipo_plano` — catálogo de documentos de conexionado/interior/lazo hoy vive solo en el Excel.
7. `nucleo.instrumento` sin campos de posición normal/falla (`NC`/`NO`, `FL`/`FO`/`FC`) ni alimentación (`ALIMENTACION_INSTRUMENTO`).
8. `nucleo.switch` sin `gabinete_id` opcional.

---

## 26. Nueva propuesta de división de migraciones — numeración real verificada

**Corrección importante**: las propuestas anteriores de este documento (secciones 15 y la primera versión de esta sección 26) asumían `008`/`009`/`010`/`011` libres por conversación previa, sin verificar el repositorio. **Verificado ahora con `ls database/migrations/` y `git log` reales**: `008` a `011` **ya existen, ya están aplicados a la base de dev, y ya tienen trabajo real encima** (008 = auto-resolución de deriva PnPID; 009 = eliminación definitiva de revisiones; 010 = fila de carátula fija; 011 = `revision_entregable_fila.instrumento_id` opcional, usado para poder borrar definitivamente instrumentos — todo de esta misma sesión, sin commitear todavía pero ya aplicado y en uso). **El próximo número real y disponible es `012`.**

Con CAJAS y PLANOS incorporados, la separación lógica correcta por dependencias y riesgo, renumerada:

- **`012_gabinetes.sql`** — rename `nucleo.rio`→`nucleo.gabinete`, `cat.cat_tipo_gabinete`, `switch.gabinete_id` opcional, 3 triggers reescritos. Es la base física de la que depende `punto_conexion`/`rack` — conviene aislarla primero, sin mezclar con señales.
- **`013_senales.sql`** — columnas nuevas de `nucleo.senal` (`causa_alarma`, `tipo_dato_com_id` + `cat.cat_tipo_dato_com`, `es_loop_powered`, `codigo_senal` nullable, `tag_senal` pasa a nullable) + `instrumento.posicion_normal_id`/`posicion_falla_id` (o columnas de texto, según la pregunta 6 de la sección 27) + `instrumento.alimentacion_instrumento_id`. Independiente de `012` en términos de FKs — podría ir antes o después, pero mantenerla separada reduce el tamaño y el riesgo de cada migración.
- **`014_planos.sql`** — `nucleo.plano` + `cat.cat_tipo_plano`, relaciones 1:N con `gabinete`/`caja` y 1:1 con `lazo` (si se decide cambiar `codigo_documento` a FK — opcional, se puede diferir a una migración posterior sin bloquear ésta). **Depende de `012`** si la relación gabinete↔plano se modela como FK directa (necesita que `nucleo.gabinete` ya exista con ese nombre).
- **`015_terminaciones.sql`** — bornes múltiples, **todavía sin diseño**, pendiente de tu confirmación sobre el significado real de `BORNE_JB` de 3/4/5 posiciones (sección 25 y sección 21 de la ronda anterior). No depende de ninguna de las 3 anteriores — puede ir en cualquier momento después de resolver esa pregunta.

Todas pequeñas y coherentes, cada una revertible/auditable por separado. Única dependencia real: `012` antes que `014` (si se usa FK directa gabinete↔plano).

---

## 27. Preguntas de negocio nuevas de esta ronda

**17. ¿Una caja pertenece/vive dentro de un gabinete?** — **RESUELTA por el usuario esta ronda: NO.** `caja.gabinete_id` no se crea. Son entidades físicas independientes; su relación real es a través de `ruta_conexion`/`tramo_conexion`/`punto_conexion` (una señal puede pasar instrumento→caja→gabinete sin que eso implique pertenencia estructural). Si en otro proyecto aparece un caso real de gabinete contenedor, se evalúa entonces — no ahora.

**18. `TABLERO_WSP` (identificador del gabinete/caja, no del plano) — RESUELTA la clasificación del campo, sigue abierta la confirmación de fondo.** Corregido esta ronda: no es un atributo de `plano`, es un atributo del elemento físico (`gabinete.tag_anterior` o `caja.tag_anterior`, según a cuál se refiera `PLANOS.TABLERO` en cada fila). Ver análisis completo en la sección 31.1 — sigue como pregunta de negocio real (sección 31.5) si es sucesión temporal o código de activo en paralelo.

**19. `ESTAD0` del plano — RESUELTA con análisis fila por fila, ver sección 31.2.** Confirmado: mezcla dos conceptos (revisión documental `INI→A→B` + estado documental `ANULADO`). No se diseña catálogo — se documenta la dirección conceptual (`plano.estado` simple, `revision_plano.revision` como texto libre a futuro, nunca implementado todavía).

**20. ¿`nucleo.plano` es global por proyecto o puede compartirse entre proyectos?** — **RESUELTA por el usuario esta ronda: `nucleo.plano.proyecto_id` obligatorio**, mismo patrón de aislamiento multiproyecto que el resto de `nucleo` (FK compuesta en `gabinete_plano`/`caja_plano`, nunca relación cruzada entre proyectos).

**21. Confirmación de alcance de las migraciones (sección 26)** — **RESUELTA, con numeración corregida**: el usuario aprobó separar Gabinetes/Señales/Planos/Terminaciones en 4 migraciones independientes — ver numeración real verificada en la sección 31.6 (`012`-`015`, no `008`-`010` como se había propuesto antes de verificar el repositorio).

---

## 28. Principio WSP: identificador anterior real vs. artefacto sin valor futuro

El usuario pidió eliminar "WSP" como nomenclatura del modelo (nada de `tag_wsp`/`tablero_wsp`/`codigo_wsp`), pero conservar la información real si un campo histórico representa genuinamente el identificador anterior de la misma entidad — mismo patrón ya usado con `instrumento.tag_anterior`.

**Inventario completo**: solo existen 2 conceptos WSP en todo el workbook (verificado con búsqueda exhaustiva de "WSP" en los encabezados de las 13 hojas) — `TAG_WSP` (aparece repetido en `SENALES`, `SENALES_CONTROL`, `SENALES_COM`, `COM`, `SEN`, `MASTER_INSTRUMENTOS` — siempre la misma copia del dato del instrumento) y `TABLERO_WSP` (solo en `PLANOS`). No hay `plano_wsp`, `cable_wsp` ni ningún otro.

### 28.1 `TAG_WSP` (instrumento) — Clasificación: **A. IDENTIFICADOR ANTERIOR REAL — ya resuelto y en producción**

Esto no es una decisión nueva: ya está **implementado y aplicado** en el importador P&ID real (`backend/src/lib/pnidImport/headers.ts`), como decisión de una sesión anterior de este mismo proyecto — el reporte Plant3D real históricamente traía la columna con el encabezado literal `"Tag WSP"`, y se aprobó el contrato de renombrarla a `"Tag Anterior"` en el reporte de origen, mapeando directo a `instrumento.tag_anterior` (columna que ya existe desde la migración 004, congelada). Cumple las 4 verificaciones pedidas: (1) se refiere al mismo instrumento — confirmado, viaja siempre junto al resto de sus atributos; (2) es realmente una nomenclatura anterior — confirmado por la decisión de negocio ya tomada y en uso; (3) no es de otra disciplina/cliente — es la nomenclatura previa del mismo instrumento en el mismo proyecto; (4) no representa otra entidad — confirmado. **No requiere ninguna acción nueva** — ya no queda ningún `tag_wsp` en el modelo, y nunca lo hubo.

### 28.2 `TABLERO_WSP` (gabinete) — Clasificación: **C. SIGNIFICADO NO CONFIRMADO (presunción razonable de A, sin poder probarlo con los datos)**

Evidencia a favor de que sea `gabinete.tag_anterior` (Caso A):
- Mismo patrón estructural que `TAG_WSP` de instrumentos: una columna "alterna" junto a la columna "actual" (`TABLERO`), un valor constante por entidad física (no varía entre las hojas/planos del mismo gabinete — confirmado: las 6 hojas de `620-RIO-5012` comparten el mismo `TABLERO_WSP='620-RIO-T103'` en las 6 filas).
- Incluso el prefijo `RIO-T1XX` sugiere una serie de numeración de una era/convención anterior distinta a la actual.

Evidencia que genera duda real (por eso no lo marco como A confirmado):
- **`620-PCC-5006` (un gabinete de control de motores, NO un RIO) tiene como `TABLERO_WSP` el valor `620-RIO-T102`** — el prefijo "RIO" aparece en el código alterno de un gabinete que hoy NO es de tipo RIO. Esto es compatible con dos lecturas distintas: (a) la convención WSP anterior simplemente no distinguía tipos de gabinete y usaba una serie `T1XX` genérica para todos los tableros por igual (lo cual **sí sería** compatible con "tag anterior del mismo gabinete", solo que de una era con menos granularidad semántica); o (b) `TABLERO_WSP` es en realidad una referencia a otra clasificación del cliente (ej. un código de activo/planta) que no tiene relación de sucesión temporal con `TABLERO`, sino que coexisten en paralelo.
- No hay en el Excel ninguna fecha, versión o metadato que permita distinguir entre (a) y (b) — a diferencia del caso `CLASE_ALARMA`/`CAUSA_ALARMA`, donde sí pude probar con datos (0% vs. 100% de población) que uno estaba roto. Acá ambas lecturas son igualmente compatibles con los datos disponibles.

**No fuerzo el mapeo.** Documentado como `C` — pido tu confirmación directa: ¿`TABLERO_WSP` es la nomenclatura que tenía el mismo gabinete físico antes de la numeración actual (→ `gabinete.tag_anterior`), o es un código de activo/planta del cliente que coexiste en paralelo con el tag de ingeniería y no representa una sucesión temporal (→ no se modela, o se documenta aparte si hace falta en el futuro)?

### 28.3 Extensión del principio a `PLANO`

Si se confirma el patrón para gabinetes, el mismo razonamiento aplicaría a un futuro `codigo_anterior` en `nucleo.plano` — pero **no hay ningún campo candidato hoy**: no existe una columna "código alterno de plano" en la hoja `PLANOS` (solo `CODIGO`, sin par WSP/legacy). Se deja el campo `codigo_anterior NULL` en el diseño conceptual de la sección 20 por si aparece evidencia real en otro proyecto, sin ningún dato que migrar hoy.

---

## 29. Resumen consolidado — respuesta a los 35 puntos pedidos

1. **Datos propios de SEÑAL**: ver sección 16.1 punto 1 y sección 10 del pedido anterior — `nombre_corto`, `descripcion`, `clase_senal_id`, `tipo_io_id`, `direccion_com_id`, `tipo_dato_com_id` (nuevo), `canal_id`, `enclavamiento`, `alarma_hh/h/l/ll`, `rango_min/max`, `unidad_ingenieria`, `valor_normal`, `causa_alarma` (nuevo), `prioridad_alarma_id`, `retardo`, `observacion`, `estado_revision_id`, `es_loop_powered` (nuevo), `tag_senal` (nullable), `codigo_senal` (nuevo, nullable, legacy).
2. **Datos recuperables desde INSTRUMENTO**: `TAG_INSTRUMENTO`, `TIPO_INSTRUMENTO`, `SERVICIO`, `SISTEMA`, `NODO`, `TECNOLOGIA`, `FUNCIONAMIENTO`, `CUERPO_INSTRUMENTO`, `ID_INSTRUMENTO`, `PnPID`, `LINEA`, `EQUIPO_ASOCIADO`, `P&ID` — todos vía `senal.instrumento_id → nucleo.instrumento`, cero duplicación (sección 16.1 punto 2).
3. **Datos recuperables desde INSTRUMENTO ASOCIADO**: `TAG_INSTRUMENTO_ASOCIADO` — vía `instrumento.instrumento_asociado_id → instrumento` (self-join), nunca columna en `senal` (sección 16.1 punto 3).
4. **Datos recuperables desde EQUIPO**: mismo patrón que (2) pero vía `senal.equipo_id → nucleo.equipo` — `EQUIPO`, `DESCRIPCION_EQUIPO`, `PANEL`, `SISTEMA`, `NODO` (sección 16.1 punto 4).
5. **`TAG_EQUIPO_INST`**: DERIVADO/VISTA — `COALESCE(instrumento.tag_instrumento, equipo.tag_equipo)`, nunca columna maestra (secciones 4, 16.1 punto 5, 38).
6. **Identidad real de una señal**: `nucleo.senal.id` (sección 13, confirmado).
7. **Tratamiento definitivo de `tag_senal`**: nullable, no obligatorio, no gobierna relaciones, derivable en vista para CONTROL (100% de los casos reales) y para el 6% de COM que tiene `nombre_corto`; nunca inventado para el 94% de COM restante (sección 13.5).
8. **Tratamiento definitivo de `ID_SENAL` legacy**: `codigo_senal NULL`, sin FK, no generado para señales nuevas, nunca renumerado, preservado literal al importar, no mostrado como dato principal (sección 13.5, reglas explícitas de esta ronda en el punto 9 del pedido).
9. **Datos propios de GABINETE**: `tag_gabinete` (ex `tag_rio`), `descripcion`, `tipo_gabinete_id` (nuevo), `tag_anterior` (nuevo, pendiente confirmación — sección 28.2).
10. **Tratamiento de `gabinete.tag_anterior`**: columna a agregar en el diseño, pero el mapeo desde `TABLERO_WSP` queda como pregunta abierta (Caso C, sección 28.2) — no forzado.
11. **Datos de RACK/SLOT/MODULO/CANAL**: sin cambios — ya modelados (`nucleo.rack.numero_rack`, `nucleo.slot.numero_slot`, `nucleo.modulo.catalogo_modulo_id`, `nucleo.canal.numero_canal`), confirmado sin brechas en esta ronda.
12. **Datos propios de CAJA**: `tag_caja` (ya existe), `descripcion` (ya existe) — brecha real: relación a plano (sección 19/20), sin brecha en `TB_CAJA` (artefacto constante, no modelar) ni en los campos derivados (sección 17.2).
13. **`CAJA_EQUIPO` vs. `TAG_CAJA`**: confirmado con evidencia exacta (179 casos reales de caja vs. 90 casos de destino directo a equipo) — se resuelve con el XOR ya existente de `punto_conexion` (`caja_id`/`equipo_id`), sin necesidad de columna nueva (sección 17.3).
14. **Datos propios de CABLE**: `tag_cable`, `tipo_cable`, `capacidad_conductores` (ya existen) — sin brechas nuevas (sección 18).
15. **Datos derivados de cable**: `N_PAR_CABLE` (posición calculada), `TAG_CABLE` (concatenación calculada) — ninguno se almacena tal cual, ya resuelto por `nucleo.par_conductor.numero_par` (sección 18).
16. **Brecha pendiente de TERMINACIONES**: sigue abierta — `BORNE_JB` de 3/4/5 posiciones sin semántica confirmada (¿hilos propios de la señal o rango del bloque compartido?), 3 alternativas de diseño sin elegir (sección 21 de la ronda anterior / sección 25 de ésta). **No se diseña todavía.**
17. **Auditoría completa de la hoja `PLANOS`**: ver sección 19.1 (tabla columna por columna) y sección 28.2 (análisis reforzado de `TABLERO_WSP`).
18. **Tipos reales de plano encontrados**: `CONEXIONADO`, `INTERIOR_GABINETE`, `LAZO` (sin catálogo propio en este archivo), `LAYOUT`/`UBICACION` (sin datos todavía) — sección 19.3.
19. **Tratamiento de `codigo_plano`/`codigo_anterior`**: `codigo_plano` = dato maestro real (`PLANOS!CODIGO`); `codigo_anterior` se deja NULL-able en el diseño por consistencia con el principio general, sin ningún campo candidato real hoy (sección 28.3).
20. **`TABLERO_WSP` como posible `tag_anterior`**: NO confirmado — evidencia mixta (el caso `620-PCC-5006`→`620-RIO-T102` genera duda razonable), queda como pregunta de negocio explícita (sección 28.2, pregunta nueva en sección 30).
21. **Propuesta conceptual de entidad `PLANO`**: sección 20.1 — `nucleo.plano` + `cat.cat_tipo_plano`.
22. **Relaciones PLANO↔GABINETE**: 1 gabinete : 0-1 plano interior, 1 gabinete : N planos de conexionado (confirmado con evidencia real, un RIO con 6 hojas) — sección 20.2.
23. **Relaciones PLANO↔LAZO**: 1:1 (sección 20.2, 22) — hoy solo texto libre en `nucleo.lazo.codigo_documento`, sin evidencia de catálogo propio.
24. **Relaciones PLANO↔CAJA**: 1 caja : 0-1 plano de conexionado propio, nunca plano interior (confirmado, sección 20.2).
25. **Relaciones PLANO↔INSTRUMENTO**: sin datos reales todavía (plano de ubicación/layout) — se deja el catálogo abierto para cuando existan (sección 22).
26. **Incorporación futura de LAYOUT/UBICACION**: el diseño de `cat.cat_tipo_plano` como catálogo abierto ya lo permite sin migración estructural nueva (sección 22).
27. **Comparación PLANO vs. ENTREGABLE**: son conceptos distintos — `entregable` asume que SIEI genera el contenido desde una plantilla propia; un plano CAD lo genera un proyectista externo y SIEI solo lo cataloga/referencia (sección 21.1-21.2).
28. **Propuesta de relación PLANO↔ENTREGABLE/REVISION**: sin relación directa por ahora (Alternativa A, sección 21.3) — si en el futuro hace falta versionar el archivo real (PDF/DWG), se replica el patrón de inmutabilidad de `revision_entregable_archivo` en una tabla propia de `plano`, nunca reutilizando la tabla de LDI.
29. **Clasificación completa de campos A-H**: ver sección 24 (tabla consolidada) — extendida ahora con `G`/`H` para los campos WSP: `TAG_WSP` → **G** (identificador anterior real, ya resuelto como `tag_anterior`); `TABLERO_WSP` → **C**, pendiente de confirmar entre G y "otra clasificación distinta" (sección 28.2).
30. **Propuesta conceptual de `vw_conexionado`**: sección 23 (tabla completa por grupo, tabla fuente y relación).
31. **Fuente y relación de cada campo de la vista**: misma tabla de la sección 23.
32. **Brechas reales del modelo actual**: sección 25 (consolidado), ahora con el ítem 4 (relación caja↔plano) resuelto conceptualmente en la sección 20-22.
33. **Campos que NO debemos modelar todavía**: `DISPR`, `R_CABLE`, `TB_CAJA` (artefacto constante), bornes múltiples de `BORNE_JB` (secciones 24-25).
34. **Propuesta de división de futuras migraciones con numeración real**: sección 26, corregida — `012_gabinetes`, `013_senales`, `014_planos`, `015_terminaciones` (el número libre real es `012`, no `008` — verificado con `ls database/migrations/` y `git log`).
35. **Preguntas de negocio pendientes**: ver sección 30 a continuación (consolidada, con la pregunta nueva de `TABLERO_WSP` incorporada).

---

## 30. Preguntas de negocio pendientes (consolidado final)

Las preguntas de identidad de señal (secciones 12.0/13) y las 5 de la ronda anterior (sección 27) siguen todas vigentes. Se agrega una:

**22. `TABLERO_WSP`: ¿sucesión temporal del mismo gabinete, o código de activo/planta del cliente en paralelo?**
*Contexto:* `620-PCC-5006` (gabinete de control) tiene `TABLERO_WSP=620-RIO-T102` — el prefijo "RIO" en el código alterno de un gabinete que no es RIO genera ambigüedad real (sección 28.2).
- **Alternativa A**: es la nomenclatura previa del mismo gabinete físico (convención WSP anterior, con menos granularidad de tipos) → mapea a `gabinete.tag_anterior`.
- **Alternativa B**: es un código de activo/planta del cliente, vigente en paralelo, sin relación de sucesión temporal → no se modela como `tag_anterior`; se documenta aparte solo si en el futuro hace falta.

*Recomendación técnica:* no puedo recomendar con confianza — la evidencia es compatible con ambas lecturas. Pido tu confirmación directa de campo (¿la numeración `T1XX` es de una etapa de ingeniería anterior de este mismo proyecto, o es la nomenclatura de activos de planta del cliente que sigue usándose hoy en paralelo?).

*Impacto en el modelo:* si A, `gabinete.tag_anterior NULL` se puebla con este dato al importar; si B, la columna existe igual (por si otro proyecto sí tiene un caso A real) pero queda vacía para este proyecto.

---

## 31. Correcciones de esta ronda (revisión del usuario sobre el diagnóstico anterior)

### 31.1 `tag_anterior`/`codigo_anterior` generalizado — sin mezclar entidades

Corrección aceptada del error de la ronda anterior: `PLANOS.TABLERO_WSP` **no es** un atributo del plano — es un atributo del **elemento físico que el plano documenta** (`PLANOS.TABLERO`, que a su vez puede ser un gabinete o una caja). El principio se generaliza así, cada entidad con su propio par, nunca cruzado:

| Entidad | Identificador vigente | Identificador anterior | Origen del dato histórico |
|---|---|---|---|
| `nucleo.instrumento` | `tag_instrumento` | `tag_anterior` *(ya existe, migración 004)* | `Tag Anterior` (antes `"Tag WSP"`) del reporte P&ID — **Caso A, ya resuelto y en producción** |
| `nucleo.gabinete` *(futuro, ex-`rio`)* | `tag_gabinete` | `tag_anterior` *(nuevo)* | `PLANOS.TABLERO_WSP`, **cuando `PLANOS.TABLERO` de esa fila es un gabinete** (`RIO-`/`PCC-`) — **Caso C, pendiente confirmación (sección 31.5)** |
| `nucleo.caja` | `tag_caja` | `tag_anterior` *(nuevo)* | `PLANOS.TABLERO_WSP`, **cuando `PLANOS.TABLERO` de esa fila es una caja** (`TBC-`/`TBJ-`) — mismo caso C, misma pregunta abierta |
| `nucleo.plano` *(futuro)* | `codigo_plano` | `codigo_anterior` *(nuevo)* | **Sin campo candidato en este Excel** — `PLANOS` no tiene una columna de código alterno/histórico del plano mismo, solo del tablero que documenta. Columna diseñada por consistencia, queda vacía hasta que aparezca evidencia real en otro proyecto |

**Ninguna entidad termina con nomenclatura `wsp` en el modelo** — confirmado: `codigo_wsp` (que había quedado en el diseño de `nucleo.plano` de la ronda anterior) se retira; no se propone `gabinete.tag_wsp` ni `caja.tag_wsp` en ningún punto.

**Todos los `*_anterior` son nullable, y no se asume que deban estar poblados** — para instrumentos ya se observa esto en producción (`tag_anterior` vacío en instrumentos que nunca tuvieron una nomenclatura previa); lo mismo aplicaría a `gabinete`/`caja`/`plano`.

### 31.2 `ESTAD0` — análisis fila por fila (confirma que el Excel mezcla dos conceptos)

Se listaron las 33 filas reales de `PLANOS` agrupadas por `TABLERO`, para ver la progresión de `ESTAD0` dentro de un mismo elemento físico:

| `TABLERO` | Hojas/planos y su `ESTAD0` | Lectura |
|---|---|---|
| `620-RIO-5012` | Hojas 1-6, todas `B` | Un tablero ya completamente resuelto: todas sus hojas llegaron a la misma revisión. |
| `620-RIO-5013` | Hojas 1-4 en `B`; **hoja 5 en `ANULADO`** | La hoja 5 fue descartada — no siguió la progresión `A→B`, fue **anulada directamente**, en cualquier punto de su ciclo. |
| `620-PCC-5006` | Hoja 4 en `INI`; hojas 1, 2, 3 en `A` | **Evidencia decisiva**: dentro del MISMO tablero, hojas distintas están en distinto estado — hoja 4 todavía no alcanzó ni la primera revisión letrada, mientras 1-3 ya están en `A`. Esto confirma que `INI`/`A`/`B` son pasos de una **progresión secuencial de revisión** (`INI` = antes de la primera revisión formal, luego `A`, luego `B`…), no un estado fijo del tablero completo. |
| Tableros con tag provisional (`620-TBJ-XXX3`, `620-TBC-XXX1`, `620-TBJ-XXX1`, `620-TBC-50X4`) | Todos en `INI` | Confirma el patrón: mientras el elemento físico documentado todavía usa un tag provisional (`XXX`), su plano tampoco pasó de `INI`. |
| Resto de tableros ya con tag definitivo (`TBJ-5014/5015/5016`, `TBC-5015/5016/5017`) | Mezcla de `A`/`B` | Consistente con progresión de revisión normal. |

**Conclusión, respondiendo explícitamente lo pedido**:
- **`A` y `B` sí representan revisiones** (una progresión secuencial, confirmada por el caso `620-PCC-5006` donde conviven distintas hojas en distinta revisión).
- **`INI`** representa una etapa **anterior a la primera revisión formal** — no es una revisión en sí, es "todavía no llegó a Rev A" (coincide siempre con tableros de tag aún provisional).
- **`ANULADO`** es un **estado documental**, ortogonal a la revisión — puede ocurrir sin que el documento haya llegado a ninguna revisión en particular (no se observó en qué revisión estaba la hoja 5 de `620-RIO-5013` antes de anularse, pero conceptualmente el anulado interrumpe la progresión en cualquier punto, no la continúa).
- **Sí, el Excel mezcla dos conceptos en una sola columna**: progresión de revisión (`INI→A→B→…`) y estado documental (`ACTIVO` implícito / `ANULADO`).

**Dirección conceptual (sin diseñar todavía, tal como se pidió)**: separar en `plano.estado` (simple: `ACTIVO`/`ANULADO`, quizás ni siquiera catálogo — 2 valores) y, cuando exista necesidad real de historial, una futura `revision_plano.revision` — **texto libre, no catálogo enumerado**, exactamente el mismo patrón que ya usa `nucleo.revision_entregable.codigo_revision` (`NVARCHAR(10)`, admite `"A"`, `"B"`, `"0"`, `"1"`, sin lista cerrada) — evita inventar un catálogo rígido para algo que en la práctica ya es texto libre secuencial en el resto de SIEI. **No se implementa `revision_plano` en esta ronda.**

### 31.3 `nucleo.plano` es por proyecto — confirmado

Aceptado y aplicado en el diseño de la sección 20.1 (`proyecto_id` obligatorio) y en las relaciones tipadas de la sección 20.2 (`gabinete_plano`/`caja_plano` con FK compuesta `(gabinete_id/caja_id/plano_id, proyecto_id)`, mismo patrón de aislamiento multiproyecto que el resto de `nucleo` — nunca relación cruzada entre proyectos).

### 31.4 Corrección: sí existe evidencia real de planos de LAYOUT (contradice la ronda anterior)

Revisando `PLANOS` fila por fila para el análisis de `ESTAD0` (31.2) se encontraron **5 filas que la ronda anterior pasó por alto** — todas con `DESCRIPCION` iniciando en `"PE -"` en vez de `"E&C -"`, y título explícito `"LAYOUT..."`:

| `ITEM` | `DESCRIPCION` | `CODIGO` | `TABLERO` | `ESTAD0` |
|---|---|---|---|---|
| 27 | `PE - SERVICIOS AUXILIARES - LAYOUT TABLEROS TBC 3` | `620-J-20039` *(coincide con el código de un plano de conexionado distinto — posible error de tipeo en el Excel, a confirmar)* | *(vacío)* | *(vacío)* |
| 31 | `PE - SALA N°7 - LAYOUT DE GABINETE DE CONTROL` | `620-J-20022` | `620-PCC-5006` | *(vacío)* |
| 33 | `PE - ESTACIÓN BOOSTER - LAYOUT DE GABINETE RIO 1` | *(vacío)* | `620-RIO-5012` | *(vacío)* |
| 14 | `PE - SERVICIOS AUXILIARES - LAYOUT DE GABINETE RIO 2` | *(vacío)* | `620-RIO-5013` | *(vacío)* |
| 34 | `PE - ESTACIÓN BOOSTER - LAYOUT TABLEROS TBC 1/2` | *(vacío)* | `620-TBC-5016/5017` | *(vacío)* |

**Corrección explícita**: la sección 19.3 de la ronda anterior afirmó "sin datos reales todavía" para `LAYOUT` — **incorrecto**, hay 5 casos reales. Sí pertenecen a `TABLERO` (gabinetes y hasta una caja combinada, `TBC-5016/5017`), confirmando que `LAYOUT` es un tipo real de plano de gabinete/caja, no solo una categoría hipotética a futuro. Nota aparte: 3 de los 5 no tienen `CODIGO` propio (posiblemente el layout general del área todavía no tiene número de plano asignado formalmente) y ninguno tiene `ESTAD0` — otra pista de que son documentos de una naturaleza distinta a los diagramas de conexionado (quizás gestionados por otra disciplina, dado el prefijo `PE` en vez de `E&C`). **`cat.cat_tipo_plano` debe incluir `LAYOUT` desde el diseño inicial**, no como "espacio reservado para el futuro" — ya hay datos reales de este proyecto.

### 31.5 Preguntas que siguen genuinamente abiertas (consolidado final)

1. **`TABLERO_WSP` → `gabinete.tag_anterior`/`caja.tag_anterior`**: ¿sucesión temporal real del mismo elemento físico, o código de activo/planta del cliente en paralelo? (sección 28.2, sin resolver — la corrección de esta ronda solo arregla A QUÉ ENTIDAD pertenece el campo, no resuelve si es realmente "anterior").
2. **Bornes múltiples (`BORNE_JB` de 3/4/5 posiciones)**: sigue sin diseño, sección 21 (ronda anterior)/25.
3. **`DISPR`**, **`R_CABLE`**: sin modelar, significado no confirmado.
4. **Posición normal/falla de válvula** (`NC`/`NO`/`FL`/`FO`/`FC`) y **alimentación del instrumento vs. loop-powered**: confirmado que van en `instrumento`/`senal` respectivamente (secciones 12.0 filas 6-7), pero falta el catálogo de valores reales si se decide validar contra lista cerrada — no bloqueante.
5. **`OBSERVACION` vs. `OBSERVACION_REVISION`**: sin datos reales para decidir (sección 12.0 fila 14) — **no aplica ya**, el usuario resolvió en el mensaje de esta ronda (punto 12 de su pedido anterior) que `observacion_revision` no se agrega ahora.
6. **`ORDEN_INST_CAJA` como posible error de tipeo del `CODIGO` del ítem 27** (sección 31.4) — mínimo, no bloqueante, solo una curiosidad de calidad de datos a no reproducir.

Todo lo demás de rondas anteriores (catálogo de tipos de gabinete, `switch.gabinete_id`, `TIPO_DATO_COM`, `causa_alarma`, `completitud` derivada, etc.) sigue **RESUELTO**, sin cambios en esta ronda.

### 31.6 Numeración real de migraciones — re-verificada en esta ronda

Re-ejecutado `ls database/migrations/` y `git log`/`git status` en este mismo turno (no se asumió nada de la conversación previa): la última migración real en el repositorio es **`011_revision_fila_instrumento_opcional.sql`** (sin commitear todavía — aparece `??` en `git status` — pero ya aplicada a la base de dev y documentada en `CLAUDE.md`). **El próximo número disponible es `012`.**

División aprobada por el usuario, con la numeración correcta:

- **`012_gabinetes.sql`** — `nucleo.rio`→`nucleo.gabinete`, `cat.cat_tipo_gabinete`, `gabinete.tag_anterior`, `switch.gabinete_id` opcional.
- **`013_senales.sql`** — `tag_senal` nullable, `codigo_senal` nullable (legacy), `causa_alarma`, `tipo_dato_com_id`+`cat.cat_tipo_dato_com`, `es_loop_powered`.
- **`014_planos.sql`** — `nucleo.plano`, `cat.cat_tipo_plano`, `codigo_anterior`, `nucleo.gabinete_plano`, `nucleo.caja_plano`, `caja.tag_anterior` si se confirma la pregunta abierta de la sección 31.5. Depende de `012` (necesita `nucleo.gabinete` ya creada).
- **`015_terminaciones.sql`** — solo cuando se resuelva la semántica de `BORNE_JB`. Sin dependencias de las anteriores.

---

## 32. Cierre de decisiones (esta ronda) y diseño técnico exacto de `012_gabinetes.sql`

**Diagnóstico aprobado. Cierres aplicados a este documento**: `TABLERO_WSP` → `gabinete.tag_anterior`/`caja.tag_anterior` según corresponda (sin más pregunta abierta — un caso donde el valor histórico no pueda asociarse inequívocamente a la misma entidad se trata como excepción puntual de dato/importación, nunca como motivo para cambiar el modelo); `plano.codigo_anterior` se mantiene en el diseño pero queda `NULL` para todo lo que se importe de este Excel (sin evidencia de código anterior del plano mismo); `ESTAD0` documentado como hallazgo, sin `estado_plano_id`/`revision`/`revision_plano` en `014_planos`; catálogo inicial de `cat.cat_tipo_plano` = `CONEXIONADO`, `INTERIOR_GABINETE`, `GANCHO`, `LAYOUT` (con evidencia real cada uno) — `LAZO` queda documentado como candidato pero **no se inserta en el catálogo inicial** (no hay todavía ningún plano de lazo real gestionado por este dominio, a diferencia de los otros 4; se agrega cuando se integre de verdad, evitando un valor de catálogo sin ningún uso); `UBICACION` igual, fuera del catálogo inicial. `P&ID` confirmado fuera de este dominio.

### 32.1 Hallazgo previo al diseño: `nucleo.rio` no tiene ningún dato real hoy

Antes de diseñar la clasificación de gabinetes existentes (punto 8 del pedido), se consultó la tabla real:

```sql
SELECT r.id, r.proyecto_id, p.codigo_proyecto, r.tag_rio, r.descripcion, r.activo
FROM nucleo.rio r JOIN nucleo.proyecto p ON p.id = r.proyecto_id;
```

**Resultado: 28 filas, TODAS de fixtures de test** (`RIO-TEST-001` y `RIO-<timestamp>-<random>`, descripción literal `"RIO de prueba"`, todas en `TEST-001` — proyecto_id 1 — y 27 de las 28 ya `activo=0`). **El proyecto real 22043 (proyecto_id 50050) tiene 0 filas en `nucleo.rio`.** No existe ningún `620-PCC-5006` ni ningún gabinete real cargado en SIEI hoy — el dominio de Gabinetes nunca se usó con datos reales, solo con datos del Excel (que nunca se importó) y fixtures de prueba.

**Consecuencia para el diseño**: la "clasificación inicial de gabinetes existentes" pedida en el punto 8 no tiene ningún caso real que resolver — el backfill de `tipo_gabinete_id` para las 28 filas existentes se hace con el valor `RIO` por defecto, documentado explícitamente como **sin impacto en producción** (no hay ninguna fila real que pudiera clasificarse incorrectamente). Cuando en el futuro se importen gabinetes reales de un proyecto real, la clasificación deberá hacerse con la evidencia real de ESE proyecto (como se hizo en este diagnóstico para `620-PCC-5006` vs. `620-RIO-5012/5013`), nunca por el nombre de la tabla.

### 32.2 Preservación de identidad (punto 7)

`sp_rename` de tabla/columna en SQL Server **nunca** toca `id`, ni reinserta filas, ni cambia ningún otro valor — es un cambio de metadato del catálogo del motor (nombre del objeto/columna), no una operación de datos. Después del rename: mismo `id`, mismo `proyecto_id`, mismo `tag_gabinete` (ex `tag_rio`, mismo valor de texto, solo la columna cambia de nombre), misma `descripcion`, mismo `activo`, mismos `created_at`/`updated_at`/`created_by`/`updated_by` — ninguna fila se recrea, ningún FK que apunte a estos `id` (`rack.gabinete_id` ex `rio_id`, `punto_conexion.gabinete_id` ex `rio_id`) se ve afectado, porque los valores de `id` a los que apuntan no cambian, solo el nombre de la columna que los contiene.

### 32.3 `gabinete.tag_anterior` — nullable, sin índice único (recomendación con razón)

**Recomendación: nullable, sin índice único, ni siquiera filtrado.** Razón: hay un precedente idéntico ya en producción — `instrumento.tag_anterior` (migración 004) es `NVARCHAR(50) NULL` **sin ningún índice de unicidad**, verificado directamente en `004_pnid_import.sql`. La unicidad real y obligatoria sigue siendo `(proyecto_id, tag_gabinete)` — `tag_anterior` explícitamente "no participa en identidad interna" (principio ya fijado por el usuario), por lo que no hay ninguna operación del sistema que necesite que sea único: no se usa para resolver relaciones, no se usa como clave de búsqueda, es puramente informativo/trazabilidad. Forzar unicidad ahí solo agregaría fricción para el caso real de datos legados desprolijos (dos gabinetes distintos que por error de historia compartan el mismo tag antiguo) sin ningún beneficio funcional.

### 32.4 Constraints, índices y triggers — inventario exacto de cambios

| Tipo | Nombre actual | Nombre futuro | Motivo |
|---|---|---|---|
| Tabla | `nucleo.rio` | `nucleo.gabinete` | Rename conceptual aprobado |
| Columna | `rio.tag_rio` | `gabinete.tag_gabinete` | Consistencia de nombre con la tabla |
| Columna | `rack.rio_id` | `rack.gabinete_id` | Consistencia |
| Columna | `punto_conexion.rio_id` | `punto_conexion.gabinete_id` | Consistencia |
| PK | `PK_rio` | `PK_gabinete` | Convención de nombre de SIEI (constraint lleva el nombre de su tabla) |
| UNIQUE | `UQ_rio_id_proyecto` | `UQ_gabinete_id_proyecto` | Ídem |
| DEFAULT | `DF_rio_activo` | `DF_gabinete_activo` | Ídem |
| DEFAULT | `DF_rio_created_at` | `DF_gabinete_created_at` | Ídem |
| FK | `FK_rio_proyecto` | `FK_gabinete_proyecto` | Ídem |
| FK (migración 003) | `FK_rio_created_by` | `FK_gabinete_created_by` | Ídem |
| FK (migración 003) | `FK_rio_updated_by` | `FK_gabinete_updated_by` | Ídem |
| FK | `FK_rack_rio` | `FK_rack_gabinete` | Ídem |
| FK | `FK_punto_conexion_rio` | `FK_punto_conexion_gabinete` | Ídem |
| Índice único filtrado | `UX_rio_proyecto_tag` | `UX_gabinete_proyecto_tag` | Ídem |
| Índice único filtrado | `UX_rack_rio_numero` | `UX_rack_gabinete_numero` | Ídem |
| Índice simple | `IX_punto_conexion_rio_id` | `IX_punto_conexion_gabinete_id` | Ídem |
| CHECK | `CK_punto_conexion_pertenencia_xor` | *(mismo nombre, cuerpo actualizado)* | El texto del CHECK menciona `rio_id` literalmente — se **DROP + CREATE** explícito en vez de confiar en que el rename de columna reescriba el texto del constraint (SIEI ya usa este patrón explícito en la migración 009, nunca depende de comportamiento implícito del motor para constraints con lógica) |
| Trigger | `TR_senal_validar_canal_ruta` | *(mismo nombre, cuerpo actualizado)* | Referencia `rk.rio_id` en un JOIN a `nucleo.rack`/`nucleo.rio` — se actualiza a `gabinete_id`/`nucleo.gabinete`, **la lógica funcional no cambia** |
| Trigger | `TR_tramo_conexion_validar_canal_ruta` | *(mismo nombre, cuerpo actualizado)* | Misma razón — referencia `pd.rio_id`/`rk.rio_id` |
| Trigger | `TR_tramo_conexion_validar_secuencia` | *(mismo nombre, cuerpo actualizado)* | Referencia `p.rio_id IS NULL` en la validación de que el último tramo termine en gabinete o módulo |
| Nueva tabla | — | `cat.cat_tipo_gabinete` | Catálogo cerrado, mismo patrón que `cat.cat_tipo_equipo` (migración 007) |
| Nueva columna | — | `gabinete.tag_anterior NVARCHAR(50) NULL` | Ver 32.3 |
| Nueva columna | — | `gabinete.tipo_gabinete_id BIGINT NOT NULL FK` | Ver 32.1 para el backfill |
| Nueva columna | — | `switch.gabinete_id BIGINT NULL FK` | Relación opcional aprobada |

### 32.5 Diseño técnico exacto (DRAFT — no creado como archivo, no ejecutado)

```sql
/* =============================================================================
   012_gabinetes.sql — SIEI  [DRAFT — NO APLICADO, NO CREADO COMO ARCHIVO TODAVIA]
   RIO -> GABINETE: generalizacion real (no solo cambio de texto en frontend).
   RIO pasa a ser un TIPO de gabinete, no el concepto padre.

   CONTEXTO / DECISION DE NEGOCIO:
   Ver docs/DIAGNOSTICO_SENALES_GABINETES.md secciones 5, 26, 31.6, 32 para
   la evidencia completa (instrumentos reales con RIO cableados a un
   "620-PCC-5006" que en realidad es un gabinete de control de motores,
   no una E/S remota).
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
   0. VERIFICACION DE PRECONDICION
   ============================================================================ */
IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'rio'
)
BEGIN
    THROW 55970, 'La migracion 012 requiere que 001_initial_schema.sql se haya aplicado antes (falta nucleo.rio).', 1;
END
GO

/* ============================================================================
   1. cat.cat_tipo_gabinete (mismo patron que cat.cat_tipo_equipo, migracion 007)
   ============================================================================ */
CREATE TABLE cat.cat_tipo_gabinete (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(20)         NOT NULL,
    nombre          NVARCHAR(100)        NOT NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_gabinete_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_gabinete PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_gabinete_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_gabinete (codigo, nombre) VALUES
    (N'RIO', N'E/S Remota'),
    (N'CONTROL', N'Control'),
    (N'COMUNICACION', N'Comunicaciones');
GO

/* ============================================================================
   2. RENAME: tabla, columna, constraints, indices
   ============================================================================ */
EXEC sp_rename N'nucleo.rio', N'gabinete';
GO
EXEC sp_rename N'nucleo.gabinete.tag_rio', N'tag_gabinete', N'COLUMN';
GO
EXEC sp_rename N'nucleo.PK_rio', N'PK_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.UQ_rio_id_proyecto', N'UQ_gabinete_id_proyecto', N'OBJECT';
GO
EXEC sp_rename N'nucleo.DF_rio_activo', N'DF_gabinete_activo', N'OBJECT';
GO
EXEC sp_rename N'nucleo.DF_rio_created_at', N'DF_gabinete_created_at', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_proyecto', N'FK_gabinete_proyecto', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_created_by', N'FK_gabinete_created_by', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_updated_by', N'FK_gabinete_updated_by', N'OBJECT';
GO
EXEC sp_rename N'nucleo.UX_rio_proyecto_tag', N'UX_gabinete_proyecto_tag', N'INDEX';
GO

/* ============================================================================
   3. gabinete.tag_anterior (nullable, sin indice unico -- ver 32.3)
   ============================================================================ */
ALTER TABLE nucleo.gabinete ADD tag_anterior NVARCHAR(50) NULL;
GO

/* ============================================================================
   4. gabinete.tipo_gabinete_id -- NULL primero, backfill, luego NOT NULL
      (ver 32.1: las 28 filas existentes son 100% fixtures de test, sin
      impacto real en produccion)
   ============================================================================ */
ALTER TABLE nucleo.gabinete ADD tipo_gabinete_id BIGINT NULL;
GO
UPDATE nucleo.gabinete
SET tipo_gabinete_id = (SELECT id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO');
GO
ALTER TABLE nucleo.gabinete ALTER COLUMN tipo_gabinete_id BIGINT NOT NULL;
GO
ALTER TABLE nucleo.gabinete ADD CONSTRAINT FK_gabinete_tipo_gabinete
    FOREIGN KEY (tipo_gabinete_id) REFERENCES cat.cat_tipo_gabinete (id);
GO

/* ============================================================================
   5. rack: rio_id -> gabinete_id
   ============================================================================ */
EXEC sp_rename N'nucleo.rack.rio_id', N'gabinete_id', N'COLUMN';
GO
EXEC sp_rename N'nucleo.FK_rack_rio', N'FK_rack_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.UX_rack_rio_numero', N'UX_rack_gabinete_numero', N'OBJECT';
GO

/* ============================================================================
   6. punto_conexion: rio_id -> gabinete_id, + CK reescrito explicitamente
   ============================================================================ */
EXEC sp_rename N'nucleo.punto_conexion.rio_id', N'gabinete_id', N'COLUMN';
GO
EXEC sp_rename N'nucleo.FK_punto_conexion_rio', N'FK_punto_conexion_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.IX_punto_conexion_rio_id', N'IX_punto_conexion_gabinete_id', N'OBJECT';
GO

ALTER TABLE nucleo.punto_conexion DROP CONSTRAINT CK_punto_conexion_pertenencia_xor;
GO
ALTER TABLE nucleo.punto_conexion ADD CONSTRAINT CK_punto_conexion_pertenencia_xor CHECK (
    (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN caja_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN gabinete_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN modulo_id IS NULL THEN 0 ELSE 1 END) = 1
);
GO

/* ============================================================================
   7. switch.gabinete_id -- relacion opcional (un switch puede o no estar
      dentro de un gabinete modelado)
   ============================================================================ */
ALTER TABLE nucleo.switch ADD gabinete_id BIGINT NULL;
GO
ALTER TABLE nucleo.switch ADD CONSTRAINT FK_switch_gabinete
    FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id);
GO

/* ============================================================================
   8. Triggers -- DROP + CREATE explicito (mismo patron que la migracion 009),
      SOLO renombrando rio_id->gabinete_id y nucleo.rio->nucleo.gabinete.
      La logica funcional NO cambia.
   ============================================================================ */

-- 8.1 TR_senal_validar_canal_ruta
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_senal_validar_canal_ruta')
BEGIN THROW 55971, 'Falta TR_senal_validar_canal_ruta (revisar 001_initial_schema.sql).', 1; END
GO
DROP TRIGGER nucleo.TR_senal_validar_canal_ruta;
GO
-- CREATE TRIGGER nucleo.TR_senal_validar_canal_ruta ... [cuerpo identico al
-- de 001_initial_schema.sql, reemplazando unicamente:
--   rk.rio_id -> rk.gabinete_id
--   JOIN nucleo.rio rk -> JOIN nucleo.gabinete rk  (si aplica el alias)
-- Se transcribe completo en el momento de implementar, no acortado aqui
-- para evitar un error de copia manual en este documento.]
GO

-- 8.2 TR_tramo_conexion_validar_canal_ruta -- mismo patron (DROP + CREATE,
-- solo pd.rio_id/rk.rio_id -> gabinete_id)
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_tramo_conexion_validar_canal_ruta')
BEGIN THROW 55972, 'Falta TR_tramo_conexion_validar_canal_ruta.', 1; END
GO
DROP TRIGGER nucleo.TR_tramo_conexion_validar_canal_ruta;
GO
-- CREATE TRIGGER ... [idem, se transcribe completo al implementar]
GO

-- 8.3 TR_tramo_conexion_validar_secuencia -- mismo patron (solo
-- p.rio_id IS NULL -> p.gabinete_id IS NULL)
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_tramo_conexion_validar_secuencia')
BEGIN THROW 55973, 'Falta TR_tramo_conexion_validar_secuencia.', 1; END
GO
DROP TRIGGER nucleo.TR_tramo_conexion_validar_secuencia;
GO
-- CREATE TRIGGER ... [idem, se transcribe completo al implementar]
GO
```

**Nota deliberada**: los 3 `CREATE TRIGGER` se dejan como comentario-placeholder en este draft — copiar sus ~40-80 líneas cada uno textualmente en este documento (solo para cambiar 2-3 palabras) es más riesgo de error de transcripción manual que valor agregado en esta etapa de revisión conceptual. Al implementar de verdad, se parte del cuerpo real de `001_initial_schema.sql` (ya citado completo en la sección 5 de este diagnóstico) y se aplican únicamente los reemplazos textuales `rio_id`→`gabinete_id` y `nucleo.rio`→`nucleo.gabinete` — cero cambio de lógica.

### 32.6 Backend — impacto de diseño (no implementado)

| Archivo actual | Cambio propuesto |
|---|---|
| `backend/src/routes/rios.ts` | Renombrar a `gabinetes.ts`; `riosRouter`→`gabinetesRouter`; todas las columnas SQL `rio_id`/`tag_rio` actualizadas; agregar `tipoGabineteId` (requerido en creación, FK validada contra `cat.cat_tipo_gabinete`) y `tagAnterior` (opcional) al `SELECT`/`INSERT`/`UPDATE`/serialización. |
| `backend/src/server.ts` | `app.use('/api/projects/:projectId/rios', riosRouter)` → `.../gabinetes`, import actualizado. |
| `backend/src/routes/racks.ts` | Todo `rioId`/`rio_id` → `gabineteId`/`gabinete_id` (parámetro de filtro `?rioId=` → `?gabineteId=`, columnas SQL, validación de `invalid_reference`). |
| `backend/src/routes/connectionPoints.ts` | `OWNER_FIELDS` cambia `'rioId'`→`'gabineteId'`; el mapa `rioId: 'rio_id'` → `gabineteId: 'gabinete_id'`; mensajes de error XOR actualizados; `FK_punto_conexion_rio: 'rioId'` → `FK_punto_conexion_gabinete: 'gabineteId'`. |
| Nuevo: `backend/src/routes/tiposGabinete.ts` | Catálogo de solo lectura, mismo patrón que `tiposEquipo.ts` (migración 007) — `GET /api/catalogs/tipos-gabinete`. |
| `backend/src/server.ts` | Montar el router nuevo, mismo patrón que `tipos-equipo`. |

### 32.7 Frontend — impacto de diseño (no implementado)

| Archivo actual | Cambio propuesto |
|---|---|
| `frontend/src/pages/RiosListPage.tsx` | Renombrar a `GabinetesListPage.tsx` — agregar columna **TIPO** (con badge/label del catálogo) y **TAG ANTERIOR** (solo si no vacío, mismo criterio visual que `tagAnterior` de instrumentos) a la tabla. |
| `frontend/src/pages/RioDetailPage.tsx` | Renombrar a `GabineteDetailPage.tsx` — formulario agrega selector de **TIPO** (obligatorio) y campo **TAG ANTERIOR** (opcional). |
| `frontend/src/api/rios.ts` | Renombrar a `api/gabinetes.ts`, funciones `listGabinetes`/`getGabinete`/`createGabinete`/etc., payloads con `tipoGabineteId`/`tagAnterior`. |
| `frontend/src/api/racks.ts` | `rioId` → `gabineteId` en filtros/creación. |
| `frontend/src/api/types.ts` | `Rio`/`RioInput` → `Gabinete`/`GabineteInput` (+ `tipoGabineteId`, `tipoGabineteCodigo`, `tipoGabineteNombre` resueltos por join, `tagAnterior`), `Rack.rioId`→`gabineteId`. |
| `frontend/src/components/useConnectionPointFormOptions.ts`, `usePhysicalTree.ts`, `connectionPointFormDefaults.ts`, `connectionPointLabel.ts`, `useRouteFormOptions.ts`, `ConnectionPointForm.tsx` | Todo literal `rio`/`Rio`/`rioId` → `gabinete`/`Gabinete`/`gabineteId` — el árbol físico (`usePhysicalTree`) pasa a mostrar Gabinete→Rack→Slot→Módulo→Canal, con el tipo de gabinete visible como agrupador o etiqueta. |
| `frontend/src/App.tsx` | Ruta `/projects/:projectId/rios` → `/gabinetes`, `/rios/:rioId` → `/gabinetes/:gabineteId`, imports actualizados. |
| `frontend/src/components/AppLayout.tsx` | Link de navegación `"RIOs"` → `"Gabinetes"`. |
| Nuevo: `frontend/src/api/tiposGabinete.ts` | Cliente del catálogo nuevo, mismo patrón que `tiposEquipo.ts`. |

La UI del formulario/detalle debe poder mostrar los 4 campos pedidos: **TAG**, **DESCRIPCIÓN**, **TIPO**, **TAG ANTERIOR** (este último oculto/guionado si es `null`, igual que ya se hace con `tagAnterior` en la ficha de instrumento).

### 32.8 Tests — plan exacto (no implementado)

**Suites a actualizar**: `backend/tests/physical-hierarchy.api.test.ts` (todo el bloque de CRUD de RIO pasa a Gabinete, agregar `tipoGabineteId` a cada creación), `backend/tests/physical-connections.api.test.ts` (el caso que usa `rioId` como opción del XOR de `punto_conexion` pasa a `gabineteId`).

**Casos nuevos mínimos a agregar** (todos con evidencia de por qué, según lo pedido):

1. Crear gabinete tipo `RIO` — 201, `tipoGabineteCodigo` en la respuesta = `RIO`.
2. Crear gabinete tipo `CONTROL` — 201, mismo tag pattern que un RIO pero clasificado distinto (reproduce el caso real `620-PCC-5006`).
3. Crear gabinete tipo `COMUNICACION` — 201.
4. Crear gabinete sin `tipoGabineteId` — 400 (obligatorio, a diferencia de `equipo.tipo_equipo_id` que sí quedó opcional en la migración 007 — acá se decide obligatorio porque no hay datos reales que retrocompatibilizar, ver 32.1).
5. TAG único por proyecto — 409 al repetir `tag_gabinete` en el mismo proyecto (comportamiento heredado, ya probado hoy como `rio`, solo renombrar el caso).
6. Mismo TAG permitido en otro proyecto — 201 (aislamiento multiproyecto, ya probado hoy).
7. `rack` pertenece a un `gabinete` — crear rack con `gabineteId`, verificar `FK_rack_gabinete`.
8. `punto_conexion` puede pertenecer a un `gabinete` (antes `rioId` en el XOR) — 201, mismo test ya existente en `physical-connections.api.test.ts`, solo renombrado.
9. `switch` puede tener `gabineteId = null` — 201 (caso hoy mayoritario, ningún switch de comunicaciones real vinculado a un gabinete modelado).
10. `switch` puede pertenecer a un `gabinete` — 201, verificar `FK_switch_gabinete`.
11. Protección cross-project — crear `rack`/`punto_conexion`/`switch` con `gabineteId` de OTRO proyecto → 400 `invalid_reference` (mismo patrón que ya prueban `racks.ts`/`connectionPoints.ts` hoy con `rioId`).
12. **Preservación de IDs tras la migración** — smoke test SQL nuevo (`0XX_smoke_rio_a_gabinete.sql`, número real a determinar al implementar): antes de la migración, capturar `id`/`tag_rio` de una fila real; después, verificar que `nucleo.gabinete` tiene la misma fila con el mismo `id` y `tag_gabinete` igual al `tag_rio` original — confirma que el rename no reinsertó datos.
13. Trigger de secuencia/canal-ruta siguen funcionando igual — reejecutar los casos ya existentes de `physical-connections.api.test.ts` que dependen de `TR_tramo_conexion_validar_secuencia`/`TR_senal_validar_canal_ruta`/`TR_tramo_conexion_validar_canal_ruta` sin ningún cambio de expectativa — si algo se rompe, confirma un error de transcripción en el rename de los triggers.

### 32.9 `013_senales.sql` y `014_planos.sql` — solo etiquetadas, sin diseño SQL todavía

Confirmado y documentado, **sin preparar su DDL en esta ronda** (pendiente de aprobar primero `012`):
- `013_senales.sql` = columnas nuevas de `nucleo.senal` (`tag_senal` nullable, `codigo_senal` nullable, `causa_alarma`, `tipo_dato_com_id`+catálogo, `es_loop_powered`).
- `014_planos.sql` = `nucleo.plano`, `cat.cat_tipo_plano` (4 valores iniciales, sección 32 arriba), `nucleo.gabinete_plano`, `nucleo.caja_plano`, `caja.tag_anterior`. Depende de `012` (necesita `nucleo.gabinete` ya creada).
- `015_terminaciones.sql` = bloqueada hasta resolver `BORNE_JB`.

---

### 33. Estado de implementación (actualizado tras la aprobación de `012_gabinetes`)

**`012_gabinetes` está implementada y aplicada en SIEI_DEV.** `nucleo.rio` ahora es `nucleo.gabinete`, con `tipo_gabinete_id` obligatorio (catálogo `RIO`/`CONTROL`/`COMUNICACION`) y `tag_anterior` opcional; `rack`/`punto_conexion` migraron su `rio_id` a `gabinete_id`; `switch.gabinete_id` es nuevo y opcional. El endpoint es `/api/projects/:projectId/gabinetes` (`/rios` ya no existe, no se dejó como alias — no se encontró ninguna dependencia real que lo requiriera). El frontend tiene una pantalla `Gabinetes` (antes `RIOs`) con selector de tipo obligatorio y campo "Tag anterior" opcional. El detalle técnico completo (antes/después, antes/después de conteo de filas, decisiones de sintaxis `sp_rename`, etc.) está en el reporte final entregado al usuario, no repetido aquí.

Los casos de prueba de la sección 32.8 (los 13 numerados) están implementados: 1–11 como pruebas de API (`physical-hierarchy.api.test.ts`, `physical-connections.api.test.ts`, `comm-links.api.test.ts`), 12 como `database/tests/024_smoke_gabinete_migracion.sql` (preservación de IDs + restricciones a nivel de motor), 13 reutilizando `database/tests/007_smoke_secuencia_ruta.sql` ya actualizado.

**`014_planos.sql` y `015_terminaciones.sql` siguen sin diseño SQL** — la sección 32.9 arriba sigue vigente para esas dos. `013_senales.sql` sí tiene diseño técnico exacto ahora — ver sección 34. **Sigue sin implementarse ninguna de las tres.**

---

## 34. DISEÑO TÉCNICO EXACTO DE `013_senales.sql` (propuesto, NO implementado)

Verificación de repositorio antes de diseñar (re-hecha, no asumida del diagnóstico anterior): `git status` limpio, `git log -3` = `a33aba6` (011) → `019780e` (012) → `640b96d`, `ls database/migrations` confirma `013` como siguiente número libre. `ls database/tests` confirma `024` como el último smoke test — **el siguiente número libre para tests es `025`**, no `013` (`013_smoke_com_ruta.sql` ya existe con otro propósito; las dos numeraciones — migraciones y smoke tests — son independientes, ya establecido desde la fase de `012`).

### 34.1 Estado real de `nucleo.senal` en SIEI_DEV (no fixtures del diagnóstico anterior, consulta directa)

194 filas totales, **1 activa / 193 inactivas** (residuo acumulado de correr repetidamente `test:signals`/`test:connections`/`test:comm-links`/`test:loops` durante toda esta sesión — mismo patrón de crecimiento por soft-delete ya documentado para `nucleo.gabinete`). 98 CONTROL / 96 COM. **100% tienen `tag_senal`** porque hoy es `NOT NULL` — no hay excepción real que observar en la base, la evidencia de que COM normalmente no tiene tag viene del Excel, no de SIEI (ver 34.2). Todos los tags son fixtures con patrón `LT-<timestamp>-<random>`, `COM-<timestamp>-<random>`, `COM-EQ-...`, `LT-CONN-...` — **ninguno es un tag real de ingeniería**. Por dueño: 164 instrumento / 30 equipo. Por canal: 34 con canal / 160 sin canal. **Las 194 filas están en `TEST-001`; el proyecto real `22043` tiene 0 filas en `nucleo.senal`.** Igual que con `nucleo.rio` antes de la migración 012: **100% fixtures de test, cero dato real** — el cambio de nullability/índices de `013` no tiene ningún riesgo de dato real que migrar o perder.

### 34.2 Esquema actual completo relevante (`001_initial_schema.sql`, líneas 489-539, sin tocar por 013 salvo lo indicado)

```sql
CREATE TABLE nucleo.senal (
    id, proyecto_id, instrumento_id, equipo_id, instrumento_agrupador_id,
    clase_senal_id BIGINT NOT NULL,
    tipo_io_id, direccion_com_id, tipo_interfaz_id, canal_id,
    estado_revision_id, prioridad_alarma_id,
    tag_senal NVARCHAR(80) NOT NULL,          -- <- 013 lo vuelve NULL
    nombre_corto NVARCHAR(30) NULL,           -- ya existe, sin cambio
    descripcion NVARCHAR(300) NULL,
    rango_min/rango_max FLOAT NULL,
    alarma_hh/h/l/ll FLOAT NULL,
    valor_normal NVARCHAR(50) NULL,
    unidad_ingenieria NVARCHAR(20) NULL,
    retardo NVARCHAR(50) NULL,
    enclavamiento NVARCHAR(300) NULL,
    observacion NVARCHAR(500) NULL,
    activo, created_at, updated_at (+ created_by/updated_by de 003)
    -- FKs: proyecto, instrumento, equipo, instrumento_agrupador, canal,
    --      clase_senal, tipo_io, direccion_com, tipo_interfaz,
    --      estado_revision, prioridad_alarma
    -- CK_senal_origen_xor: instrumento_id XOR equipo_id
    -- CK_senal_tipo_io_direccion_excl: NOT (tipo_io_id Y direccion_com_id juntos)
);
CREATE UNIQUE INDEX UX_senal_proyecto_tag ON nucleo.senal (proyecto_id, tag_senal) WHERE activo = 1;  -- <- 013 lo reemplaza
CREATE UNIQUE INDEX UX_senal_canal_id ON nucleo.senal (canal_id) WHERE canal_id IS NOT NULL AND activo = 1;
TR_senal_validar_clase (AFTER INSERT, UPDATE)  -- <- 013 lo EXTIENDE, no crea uno nuevo
TR_senal_desactivar_ruta, TR_senal_validar_canal_ruta, TR_ruta_conexion_validar_clase_senal  -- sin cambio, no referencian tag_senal/columnas nuevas
```

**Tabla campo Excel → campo SIEI actual** (punto 22 — qué YA existe, qué falta de verdad):

| Campo Excel (`MASTER_SENALES`/`SENALES_CONTROL`/`SENALES_COM`) | Campo actual SIEI | Existe | Necesita cambio |
|---|---|---|---|
| `ENCLAVAMIENTO` | `senal.enclavamiento` | Sí | No |
| `ALARMA_HH`/`H`/`L`/`LL` | `senal.alarma_hh/h/l/ll` | Sí | No |
| `RANGO_MIN`/`RANGO_MAX` | `senal.rango_min/rango_max` | Sí | No |
| `UNIDAD_INGENIERIA` | `senal.unidad_ingenieria` | Sí | No |
| `VALOR_NORMAL` | `senal.valor_normal` | Sí | No |
| `PRIORIDAD_ALARMA` | `senal.prioridad_alarma_id` (FK a catálogo) | Sí | No |
| `RETARDO` | `senal.retardo` | Sí | No |
| `OBSERVACION` | `senal.observacion` | Sí | No |
| `ESTADO_REVISION` | `senal.estado_revision_id` (FK a catálogo) | Sí | No |
| `SENAL` (sufijo corto: PI/REM/HYC/…) | `senal.nombre_corto` | Sí | No — máx. real 3 car., NVARCHAR(30) ya sobra |
| `TAG_SENAL` | `senal.tag_senal` | Sí | **Sí — nullable + índice** |
| `OBSERVACION_REVISION` | *(sin mapeo)* | No | Fuera de alcance de 013 — 0% con contenido real distinto de `"-"` en todo el archivo; no hay evidencia de qué se diferenciaría de `observacion`, se documenta como pendiente, no se inventa una columna |
| `COMPLETITUD` | *(sin mapeo)* | No | Fuera de alcance — no es un dato de ingeniería, es un indicador de avance del propio Excel; no aplica en SIEI |
| `ID_SENAL` | *(sin mapeo)* | No | **Sí — nueva columna `codigo_senal`** |
| `TIPO_DATO` (solo `SENALES_COM`) | *(sin mapeo)* | No | **Sí — nueva columna `tipo_dato_com_id` + catálogo** |
| `CAUSA_ALARMA` | *(sin mapeo)* | No | **Ver 34.3 — corrección de premisa, no se implementa como se pidió literalmente** |
| `CONEX_TIPO` (solo `SENALES_CONTROL`) | *(sin mapeo)* | No | Parcialmente — ver 34.6. Solo el valor `LP` aporta algo derivable (`es_loop_powered`); `BOT_S`/`BOT_D` es un concepto distinto, no se modela en 013 |

### 34.3 `causa_alarma` — hallazgo sobre el Excel y decisión final (RESUELTO)

**Hallazgo que cambia el punto 11 del pedido.** Se inspeccionó la celda real de `MASTER_SENALES.CAUSA_ALARMA` (no solo su tasa de población, que ya se sabía 100% desde el diagnóstico anterior) — su **fórmula real** es:

```
=OR($C2="AI",$C2="DI",$C2="RTD",$C2="IN")
```

Es decir: **`CAUSA_ALARMA` es un valor booleano calculado** ("¿el tipo de I/O de esta fila es AI, DI, RTD o IN?"), confirmado sobre 1031 filas (`bool` en el 100% de los casos, `True`×919 / `False`×112). **No es una descripción textual de la causa de una alarma** (algo como "Alta presión en línea" o "Falla de comunicación con PLC") — ese campo, con ese significado, **no existe en ninguna hoja del workbook** (se buscó explícitamente cualquier columna con "ALARMA" o "CAUSA" en su nombre en las 13 hojas; las únicas son `ALARMA_HH/H/L/LL`, `CLASE_ALARMA`/`CAUSA_ALARMA` — el mismo booleano con dos nombres distintos entre hojas, ya documentado como bug de Power Query — y `PRIORIDAD_ALARMA`).

**Decisión del usuario (cierra la pregunta abierta de la ronda anterior):** a pesar de que el Excel actual solo tiene una fórmula booleana derivada de `TIPO_IO` bajo ese nombre, en SIEI `causa_alarma` será un **atributo independiente de la señal, desacoplado deliberadamente de esa fórmula** — no una importación literal de la columna del Excel, sino un campo propio de SIEI que podrá refinarse más adelante sin bloquear 013.

```sql
ALTER TABLE nucleo.senal ADD causa_alarma BIT NULL;
```

Semántica: `NULL` = no definido, `0` = no, `1` = sí. **Sin FK, sin catálogo, sin `CHECK` relacionado con `tipo_io_id`, sin trigger de derivación, sin generación automática** — es un campo plano, exactamente como `es_loop_powered` en su forma (`BIT NULL`), pero **sin ninguna restricción de exclusividad por clase**: a diferencia de `tipo_dato_com_id` (exclusivo COM) y `es_loop_powered` (exclusivo CONTROL), `causa_alarma` puede tener valor tanto en señales CONTROL como COM — no se agrega ninguna cláusula a `TR_senal_validar_clase` para este campo. Para señales existentes: `causa_alarma = NULL`, sin backfill (ni siquiera derivado de `tipo_io_id`, aunque técnicamente se podría — se decide no hacerlo porque el campo ya no representa ese concepto).

### 34.4 `tag_senal` → NULLABLE

```sql
ALTER TABLE nucleo.senal ALTER COLUMN tag_senal NVARCHAR(80) NULL;
```
Motivo: 269/269 CONTROL tienen `TAG_SENAL` derivable (100%) pero 762 COM solo 46 (6%) — la mayoría son registros PLC sin tag de ingeniería real (`PALABRA DE ALARMAS 1`, `HEARTBEAT`, etc., ya documentado en rondas anteriores). Impacto en datos existentes: ninguno — las 194 filas de SIEI_DEV son fixtures con tag no vacío, `ALTER COLUMN ... NULL` no reescribe valores, solo relaja la restricción.

### 34.5 Índice de `tag_senal`

Actual: `UX_senal_proyecto_tag ON nucleo.senal (proyecto_id, tag_senal) WHERE activo = 1`. Con `tag_senal` nullable, SQL Server trata cada `NULL` como distinto en un índice único filtrado **siempre que el filtro no lo excluya explícitamente** — pero el filtro actual (`WHERE activo = 1`) sí dejaría que dos filas activas con `tag_senal = NULL` colisionaran si no se agrega la exclusión (comportamiento distinto al de una `UNIQUE CONSTRAINT` plana, que solo tolera un `NULL`; un índice único **filtrado** de SQL Server excluye directamente las filas que no cumplen el predicado, así que agregar `AND tag_senal IS NOT NULL` al predicado saca a TODAS las filas con `tag_senal = NULL` de la comprobación de unicidad, sin importar cuántas sean — verificado ya con el mismo patrón exacto en `UX_gabinete_...`/`UX_revision_entregable_fila_instrumento` de migraciones anteriores).

```sql
DROP INDEX UX_senal_proyecto_tag ON nucleo.senal;
CREATE UNIQUE INDEX UX_senal_proyecto_tag
    ON nucleo.senal (proyecto_id, tag_senal)
    WHERE tag_senal IS NOT NULL AND activo = 1;
```
Múltiples `NULL` (activos o no) conviven libremente — exactamente el mismo mecanismo ya probado en `024_smoke_gabinete_migracion.sql` CASO 6 y en `023_smoke_...` CASO 2 para `revision_entregable_fila.instrumento_id`.

### 34.6 `codigo_senal` — diseño y política (RESUELTO: sin UNIQUE)

```sql
ALTER TABLE nucleo.senal ADD codigo_senal NVARCHAR(20) NULL;
```
`NVARCHAR(20)`, no `NVARCHAR(50)` ni `MAX`: evidencia real — 1031/1031 valores de `ID_SENAL` en `MASTER_SENALES` (unión exacta de `SENALES_CONTROL` 269 + `SENALES_COM` 762) tienen longitud **uniforme de 14 caracteres**, formato `###-SIG-######` (prefijo de proyecto + `-SIG-` + 6 dígitos). 20 deja margen para un prefijo de proyecto más largo que "620" sin ser un `NVARCHAR(50)` desperdiciado como el resto de tags. Es exclusivamente una **referencia legacy/importada**, nunca identidad de SIEI: nullable, sin PK, sin FK, sin generación automática, sin secuencia propia, nunca recalculado ni renumerado — un valor importado se preserva literal; para señales nuevas creadas en SIEI, `codigo_senal = NULL` siempre.

**Duplicados en el dataset analizado: cero.** `ID_SENAL` no tiene duplicados dentro de `SENALES_CONTROL` (269 únicos), ni dentro de `SENALES_COM` (762 únicos), ni overlap entre ambas hojas (`MASTER_SENALES` es literalmente su unión, 269+762=1031 exacto). Formato 100% consistente, sin variantes de mayúscula/espacio.

**Decisión del usuario: NO UNIQUE.** Esa evidencia proviene de un único dataset/proyecto — bastaría un segundo Excel legacy con un duplicado real de `ID_SENAL` (no observado aquí, pero tampoco descartable con una sola muestra) para que un índice único bloquee una importación legítima. Se prefiere no arriesgar eso por una garantía que ningún requisito de negocio pidió explícitamente. En su lugar, un índice **no único, filtrado**, que sí aporta valor real de consulta (`WHERE codigo_senal = ?` para ubicar una señal por su referencia legacy al importar, sin escanear toda la tabla) sin imponer ninguna restricción:

```sql
CREATE INDEX IX_senal_proyecto_codigo
    ON nucleo.senal (proyecto_id, codigo_senal)
    WHERE codigo_senal IS NOT NULL;
```
Filtrado (no incluye las filas con `codigo_senal IS NULL`, que serán la mayoría — toda señal nueva creada en SIEI) para no desperdiciar espacio de índice en el caso más común. No se filtra además por `activo = 1` como en los índices `UX_*`: al no ser un índice de unicidad, no hay razón para excluir inactivas de una búsqueda por código legacy (una señal desactivada conserva su referencia legacy igual que su historial).

### 34.6b Cuatro identidades distintas, una sola real (confirmado, sin cambios de diseño — documentación explícita)

Tras 013, `nucleo.senal` tiene cuatro campos que podrían confundirse con "el identificador de la señal". Solo uno lo es:

| Campo | Rol | ¿Sustituye a `senal.id`? |
|---|---|---|
| `senal.id` | **Identidad interna real.** Toda relación de SIEI (`ruta_conexion.senal_id`, FKs, etc.) usa esto. | — |
| `tag_senal` | Identificador de **ingeniería**, opcional (013). Legible para humanos, puede repetirse `NULL`, puede cambiar. | No |
| `codigo_senal` | Referencia **legacy/importada**, opcional. Solo existe si vino de una carga externa. | No |
| `nombre_corto` | Nombre/sufijo **funcional** (PI, REM, HYC…), opcional, ya existente desde antes de 013. | No |

Ninguno de los tres últimos participa en ningún FK ni en el `CK_senal_origen_xor`; son atributos descriptivos, nunca claves.

### 34.7 `cat.cat_tipo_dato_com` — catálogo nuevo

Confirmado contra `SENALES_COM.TIPO_DATO` (716/770 filas pobladas, 54 en blanco): **exactamente 7 valores, sin variantes de mayúscula/espacio, sin errores de escritura** — `BIT` (519), `REAL` (89), `DINT` (28), `WORD` (28), `UDINT` (24), `UINT` (16), `DWORD` (12). Mismo patrón que `cat.cat_tipo_io`/`cat.cat_direccion_com` (id, codigo NVARCHAR(30), descripcion NVARCHAR(200), created_at, updated_at — sin `activo`, sin trigger propio):

```sql
CREATE TABLE cat.cat_tipo_dato_com (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_dato_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_dato_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_dato_com_codigo UNIQUE (codigo)
);

INSERT INTO cat.cat_tipo_dato_com (codigo, descripcion) VALUES
    (N'BIT',   N'Un bit (booleano)'),
    (N'WORD',  N'Palabra sin signo de 16 bits'),
    (N'DWORD', N'Palabra sin signo de 32 bits'),
    (N'UINT',  N'Entero sin signo de 16 bits'),
    (N'UDINT', N'Entero sin signo de 32 bits'),
    (N'DINT',  N'Entero con signo de 32 bits'),
    (N'REAL',  N'Punto flotante de 32 bits');
```
Lista **cerrada** (evidencia real lo confirma, sin ambigüedad) — mismo criterio que `cat_clase_senal`/`cat_direccion_com`, no el de dominio abierto de `cat_tipo_com`/`cat_tipo_medio_com`.

### 34.8 `tipo_dato_com_id`

```sql
ALTER TABLE nucleo.senal ADD tipo_dato_com_id BIGINT NULL;
ALTER TABLE nucleo.senal ADD CONSTRAINT FK_senal_tipo_dato_com FOREIGN KEY (tipo_dato_com_id) REFERENCES cat.cat_tipo_dato_com (id);
```

### 34.9 `tipo_dato_com` exclusivo de COM — extender `TR_senal_validar_clase`, no crear trigger nuevo

Confirmado: `TR_senal_validar_clase` (líneas 1171-1220 de `001_initial_schema.sql`) ya es el trigger que decide qué combinaciones son válidas según `cat_clase_senal.codigo` — es el lugar correcto para extender, no uno nuevo. Cambios exactos propuestos (diff conceptual, cuerpo existente sin reescritura salvo lo señalado):

1. Guarda de entrada (línea 1176): agregar las dos columnas nuevas para que el trigger también dispare cuando solo cambian ellas:
   ```sql
   IF NOT (UPDATE(clase_senal_id) OR UPDATE(tipo_io_id) OR UPDATE(canal_id) OR UPDATE(direccion_com_id)
           OR UPDATE(tipo_dato_com_id) OR UPDATE(es_loop_powered)) RETURN;
   ```
2. Primer bloque (COM prohibido — línea 1178-1186): agregar `es_loop_powered` a la lista de campos que COM no puede tener:
   ```sql
   WHERE c.codigo = N'COM' AND (i.tipo_io_id IS NOT NULL OR i.canal_id IS NOT NULL OR i.es_loop_powered IS NOT NULL)
   ```
   mismo `THROW 51008`, mensaje ampliado: `'Una senal COM no puede tener tipo_io_id, canal_id ni es_loop_powered.'`
3. Segundo bloque (CONTROL prohibido — línea 1188-1196): agregar `tipo_dato_com_id`:
   ```sql
   WHERE c.codigo = N'CONTROL' AND (i.direccion_com_id IS NOT NULL OR i.tipo_dato_com_id IS NOT NULL)
   ```
   mismo `THROW 51009`, mensaje ampliado: `'Una senal CONTROL no puede tener direccion_com_id ni tipo_dato_com_id.'`
4. Tercer bloque (COM con ruta activa) — sin cambio, no involucra estas columnas.

Además, un `CHECK` simple (no necesita JOIN a catálogo, mismo patrón que `CK_senal_tipo_io_direccion_excl`) como defensa adicional a nivel de fila:
```sql
ALTER TABLE nucleo.senal ADD CONSTRAINT CK_senal_tipo_dato_com_loop_excl
    CHECK (NOT (tipo_dato_com_id IS NOT NULL AND es_loop_powered IS NOT NULL));
```
No se hace obligatorio para toda señal COM (54/770 sin `TIPO_DATO` en el dataset real — dato incompleto real, no se debe bloquear la creación de una señal COM sin ese valor).

### 34.10 `es_loop_powered`

```sql
ALTER TABLE nucleo.senal ADD es_loop_powered BIT NULL;
```
`instrumento.alimentacion_instrumento` (fuente de alimentación general del instrumento) **no existe hoy** en `nucleo.instrumento` — es una columna distinta, futura, de Instrumentos, fuera de 013 (ver 34.13). `es_loop_powered` describe específicamente el conexionado de la señal CONTROL. No se restringe a `AI` únicamente: la evidencia (34.11) muestra `LP` siempre en filas con módulo tipo entrada (transmisores PI/LI/ZI/LIC), pero no hay una regla de negocio inequívoca que excluya, por ejemplo, un `RTD` loop-powered — se deja `BIT NULL` sin `CHECK` de tipo_io, exactamente como se pidió.

### 34.11 Análisis completo de `CONEX_TIPO`

Columna solo en `SENALES_CONTROL`, 100/488 filas pobladas (20%). **Tres valores reales, ningún otro**:

| Valor | Frecuencia | Relación con módulo (`T_MODULO`) | Relación con `SENAL` (nombre corto) | Significado |
|---|---|---|---|---|
| `LP` | 61 | Siempre `IN*`/`IOUT*` (canal de entrada) | `PI`, `LI`, `ZI`, `LIC` — transmisores | **Confirmado: loop-powered** → deriva `es_loop_powered = 1` en importación futura |
| `BOT_S` | 31 | Siempre `OUT-*` (canal de salida) | `HYO`/`HYC`/`HY` — mando de válvula (open/close) | **Confirmado: estación de botonera SIMPLE** (un solo pulsador) — concepto de hardware de la estación de mando, no relacionado con alimentación |
| `BOT_D` | 8 | Siempre `OUT-*` (canal de salida) | `HYO`/`HYC` — mando de válvula (open/close) | **Confirmado: estación de botonera DOBLE** (par abrir/cerrar) — mismo concepto que `BOT_S`, variante de hardware |

**Confirma la sospecha del punto 15: `CONEX_TIPO` mezcla dos conceptos distintos.** `LP` es la única fuente real de `es_loop_powered` — se documenta como **derivación de importación** (una futura carga de `SENALES_CONTROL` traduce `CONEX_TIPO = 'LP'` → `es_loop_powered = 1`; ausencia o cualquier otro valor → se deja `NULL`, nunca se infiere `0` porque ausencia de `LP` no prueba "no es loop-powered", solo que no se marcó).

**Decisión del usuario (RESUELTO): `BOT_S`/`BOT_D` quedan explícitamente FUERA de 013.** No se sabe todavía si corresponden a `instrumento`, a `senal`, a un dominio de "estación de botonera" propio, o a otra cosa — no se crea columna, catálogo, FK ni `CHECK` para ellos. Quedan documentados como **deuda de modelado pendiente**, sin fecha ni migración asignada. Regla explícita, sin ambigüedad: `CONEX_TIPO = 'LP'` puede interpretarse en una futura importación como `es_loop_powered = 1`, pero **`BOT_S`/`BOT_D` nunca deben convertirse en `es_loop_powered`** — son un concepto distinto (tipo de estación de mando de una salida discreta a válvula, no alimentación de una entrada de transmisor) y mezclarlos sería incorrecto incluso si técnicamente "cupieran" en el mismo campo `BIT`. No se crea `senal.conex_tipo` como columna — punto 15 cumplido literalmente.

### 34.12 Matriz de validación CONTROL / COM (estado tras 013)

| Campo | CONTROL | COM |
|---|---|---|
| `instrumento_id` XOR `equipo_id` | Obligatorio (uno de los dos) | Obligatorio (uno de los dos) — sin cambio |
| `tipo_io_id` | Opcional | **PROHIBIDO** (`NULL` forzado por trigger) |
| `canal_id` | Opcional | **PROHIBIDO** (`NULL` forzado por trigger) |
| `direccion_com_id` | **PROHIBIDO** (`NULL` forzado por trigger) | Opcional |
| `tipo_dato_com_id` (nuevo) | **PROHIBIDO** (`NULL` forzado por trigger extendido) | Opcional |
| `es_loop_powered` (nuevo) | Opcional (`TRUE`/`FALSE`/`NULL`) | **PROHIBIDO** (`NULL` forzado por trigger extendido) |
| `tag_senal` | Opcional (nullable, 013) | Opcional (nullable, 013) |
| `codigo_senal` (nuevo) | Opcional, legacy/importado, **sin UNIQUE** | Opcional, legacy/importado, **sin UNIQUE** |
| `causa_alarma` (nuevo) | Opcional (`NULL`/`0`/`1`) — **no exclusivo, permitido en ambas clases** | Opcional (`NULL`/`0`/`1`) — **no exclusivo, permitido en ambas clases** |
| `nombre_corto` | Opcional (sin cambio) | Opcional (sin cambio) |
| `tipo_interfaz_id`, `estado_revision_id`, `prioridad_alarma_id`, alarmas, rangos, etc. | Opcional (sin cambio) | Opcional (sin cambio) |

### 34.13 Fuera de alcance de 013 (deuda documentada, no diseñada aquí)

`instrumento.posicion_normal`, `instrumento.posicion_falla`, `instrumento.alimentacion_instrumento` — conceptualmente pertenecen a `nucleo.instrumento`, descubiertos durante el análisis de Señales pero **no se diseña su DDL en esta ronda**; quedan como evolución futura de Instrumentos, en una migración propia cuando corresponda (no `013`, no `014`, no `015`).

### 34.14 Backfill — exacto, sin inventar

| Cambio | Backfill sobre las 194 filas existentes |
|---|---|
| `tag_senal` → nullable | Ninguno — conserva el valor actual de las 194 filas (`ALTER COLUMN` no reescribe datos) |
| `codigo_senal` (nueva) | `NULL` en las 194 — no hay ninguna fuente hoy en SIEI de la que derivarlo; una futura importación del Excel lo poblaría con `ID_SENAL` literal |
| `tipo_dato_com_id` (nueva) | `NULL` en las 194 — no hay `TIPO_DATO` capturado hoy en ningún lado de SIEI |
| `es_loop_powered` (nueva) | `NULL` en las 194 — **no se infiere de `tag_senal`** (violaría el punto 27 explícito de no inventar backfill desde texto de tags); solo una futura importación de `CONEX_TIPO='LP'` lo pobla |
| `causa_alarma` (nueva) | `NULL` en las 194 — **sin backfill**, tampoco derivado de `tipo_io_id` aunque técnicamente se podría (34.3: el campo ya no representa esa fórmula en SIEI) |

### 34.15 Impacto backend (diseño, sin tocar código)

`backend/src/routes/signals.ts`:
- `REQUIRED_ON_CREATE = ['tagSenal', 'claseSenalId']` → **`['claseSenalId']`** (quitar `tagSenal`). El `if (typeof body.tagSenal === 'string') { trim(); if empty -> 400 }` de POST se mantiene solo si `tagSenal` viene presente (ya lo hace, no valida required); en PATCH, el bloque que hoy rechaza `tagSenal: null` (`'tagSenal cannot be empty or null'`) debe **permitir `null`** (limpiar el tag), igual que cualquier otro campo opcional — hoy es la única excepción codificada como obligatoria en PATCH.
- `SIGNAL_FIELDS`: agregar `codigoSenal: { column: 'codigo_senal', kind: 'string', max: 20, sqlType: sql.NVarChar(20) }`, `tipoDatoComId: { column: 'tipo_dato_com_id', kind: 'bigintId', sqlType: sql.NVarChar(30) }`, `esLoopPowered: { column: 'es_loop_powered', kind: 'boolean' (nuevo FieldKind), sqlType: sql.Bit }`, `causaAlarma: { column: 'causa_alarma', kind: 'boolean', sqlType: sql.Bit }` — sin restricción de clase en su validación de forma (a diferencia de `tipoDatoComId`/`esLoopPowered`, cuya exclusividad por clase la decide el trigger, no el `FieldSpec`).
- `SIGNAL_SELECT_COLUMNS`/`SIGNAL_FROM_CLAUSE`/`serializeSignal`: agregar `s.codigo_senal`, `s.causa_alarma` (serializado `boolean | null`), `s.tipo_dato_com_id` (+ `LEFT JOIN cat.cat_tipo_dato_com tdc ON tdc.id = s.tipo_dato_com_id` + `tdc.codigo AS tipo_dato_com_codigo`), `s.es_loop_powered` (serializado como `boolean | null`, no `0/1`).
- `FK_FIELD_BY_CONSTRAINT`: agregar `FK_senal_tipo_dato_com: 'tipoDatoComId'`.
- `mapSignalSqlError`: agregar mapeo para `CK_senal_tipo_dato_com_loop_excl` (400) y ampliar los mensajes 51008/51009 ya existentes para mencionar los campos nuevos.
- Ningún filtro de querystring existe hoy en `GET /signals` (se lista todo el proyecto) — no hay diseño de filtros que ajustar.
- **No se genera `tagSenal` ni `codigoSenal` automáticamente en ningún punto** — cumple el punto 23 explícitamente.

`frontend/src/api/types.ts`: `Signal.tagSenal: string` → `string | null`; agregar `codigoSenal: string | null`, `causaAlarma: boolean | null`, `tipoDatoComId: string | null`, `tipoDatoComCodigo: string | null`, `esLoopPowered: boolean | null` a `Signal` y a `SignalInput` (sin `tipoDatoComCodigo`, que es solo de lectura).

`frontend/src/api/catalogs.ts`: agregar `listComDataTypes = (devUserEmail) => listCatalog('/api/catalogs/com-data-types', devUserEmail)` — mismo patrón genérico ya usado para `io-types`/`com-directions`, no una función nueva de forma distinta.

### 34.16 Diseño del catálogo backend — reusar `simpleCatalogRouter`, no crear arquitectura nueva

`cat.cat_tipo_dato_com` tiene exactamente la forma `{id, codigo, descripcion, created_at, updated_at}` que ya sirve `backend/src/lib/simpleCatalogRouter.ts` (la misma factory que ya expone `cat_clase_senal`, `cat_tipo_io`, `cat_direccion_com` — no `tiposGabinete.ts`/`tiposEquipo.ts`, que existen aparte solo porque esas tablas usan `nombre` en vez de `descripcion`). Diseño exacto en `server.ts`, junto al bloque ya comentado *"Estos 3 los usa directamente nucleo.senal..."* (ampliar el comentario a "Estos 4..."):

```ts
app.use(
  '/api/catalogs/com-data-types',
  createSimpleCatalogRouter('cat.cat_tipo_dato_com', false)
);
```
`writable: false` — lista cerrada confirmada por evidencia real (34.7), mismo criterio que `signal-classes`/`io-types`/`com-directions`. Ruta en inglés (`com-data-types`), consistente con esas tres, no con el patrón español de `tipos-equipo`/`tipos-gabinete` (esas nacieron después y siguen otro precedente; `cat_tipo_dato_com` pertenece a la familia de catálogos de validación de señal, no a la de catálogos de entidad).

### 34.17 Diseño frontend

`SignalForm.tsx`: el fieldset `CONTROL` (línea 181-205) gana un campo "Loop powered" **tri-estado** (34.19); el fieldset `COM` (línea 207-221) gana un `CatalogSelect` de "Tipo de dato" (`options.comDataTypes`). El campo `TAG *` (línea 99-109) pierde el asterisco y el atributo `required` — pasa a opcional en ambas clases, nunca marcado como obligatorio visualmente. `causaAlarma` **no va en ninguno de los dos fieldsets exclusivos** (no es exclusivo de clase, 34.3/34.12) — va en el fieldset común `Ingeniería` (línea 223+, junto a `estadoRevisionId`/`prioridadAlarmaId`), mismo control tri-estado que `esLoopPowered` (34.19). `useSignalFormOptions.ts` agrega `listComDataTypes` al `Promise.all` ya existente (mismo patrón de fetch combinado). `signalFormDefaults.ts` agrega `codigoSenal: null, causaAlarma: null, tipoDatoComId: null, esLoopPowered: null` a `emptySignalInput()`.

### 34.18 Tratamiento UI de `codigo_senal`

Recomendación: **campo avanzado, oculto por defecto, solo lectura cuando viene poblado**. No es un dato que alguien cree a mano en SIEI (nunca se genera ni se pide al usuario) — solo existe si vino de una importación futura del Excel legacy. Mostrarlo como protagonista (visible siempre, editable) sugeriría falsamente que es parte del flujo normal de alta de señales. Un `<details>`/sección "Avanzado" colapsada por defecto que lo muestra de solo lectura cuando `value.codigoSenal` no es `null`, y ni siquiera renderiza el campo si es `null` y la señal es nueva (nada que mostrar), es la opción más limpia — mismo espíritu que `instrumento.tag_anterior`, que tampoco es protagonista del formulario de Instrumentos.

### 34.19 UI tri-estado de `es_loop_powered` (y `causa_alarma`, mismo control)

Un checkbox HTML nativo no tiene tercer estado persistente utilizable en un formulario controlado (el estado `indeterminate` es solo visual, no seleccionable por el usuario). Recomendación: **un `<select>` de 3 opciones** (mismo componente `CatalogSelect`-like ya usado en el resto del formulario, o uno ad hoc con las opciones fijas "No definido" / "Sí" / "No") mapeado a `null` / `true` / `false` — consistente con el resto de la UI de Señales, que ya usa `CatalogSelect` con `emptyLabel="— elegir —"` para todo lo opcional, en vez de introducir un componente de checkbox suelto que sería el único de su tipo en este formulario. `causa_alarma` reutiliza exactamente el mismo control (es `BIT NULL` con la misma semántica de tres estados), solo que ubicado en el fieldset común en vez de en uno exclusivo de clase.

### 34.20 Tests SQL (`database/tests/`, próximo número real: **025**, no 013)

Casos mínimos, todos ejecutables con el patrón `BEGIN TRY/BEGIN TRANSACTION/ROLLBACK` ya usado en el resto de la suite:
1. Crear CONTROL sin `tag_senal` → 201/aceptado a nivel de motor.
2. Crear COM sin `tag_senal` → aceptado.
3. Múltiples señales con `tag_senal = NULL` en el mismo proyecto → conviven sin violar `UX_senal_proyecto_tag`.
4. Dos señales activas con el mismo `tag_senal` en el mismo proyecto → rechazado (índice ya existente, solo re-confirmar con `tag_senal` no nulo).
5. Mismo `tag_senal` en proyectos diferentes → permitido (aislamiento multiproyecto, patrón ya probado en `010_smoke_multiproyecto.sql`).
6. `tag_senal` existente antes de aplicar 013 → preservado exacto (mismo patrón de preservación que `024` CASO 1, con una tabla descartable propia, no contra un timestamp fijo de SIEI_DEV — lección ya aprendida).
7. COM con `tipo_dato_com_id` válido → 201.
8. CONTROL con `tipo_dato_com_id` → rechazado (trigger extendido).
9. COM con `es_loop_powered` (`true` o `false`) → rechazado (trigger extendido).
10. CONTROL con `es_loop_powered = NULL` → permitido.
11. CONTROL con `es_loop_powered = true`/`false` → permitido.
12. `codigo_senal = NULL` → permitido.
13. `codigo_senal` con valor "legacy" (`620-SIG-000259`) → preservado literal, sin normalización.
14. **Dos señales activas con el mismo `codigo_senal` en el mismo proyecto → PERMITIDO** (sin UNIQUE, decisión 34.6 — caso explícito para no dejarlo sin cubrir, ya que invierte la expectativa "natural" del resto del modelo).
15. `IX_senal_proyecto_codigo` sigue resolviendo `WHERE codigo_senal = ?` correctamente aunque no sea único (verificar plan/uso del índice, no solo el resultado).
16. `CK_senal_origen_xor` (instrumento/equipo) sigue funcionando sin cambio — regresión.
17. COM sin canal / CONTROL con canal — regresión de reglas ya existentes, sin cambio esperado.
18. `tipo_dato_com_id` inexistente → 400 a nivel de FK (`FK_senal_tipo_dato_com`).
19. CONTROL con `causa_alarma = 1` → permitido.
20. COM con `causa_alarma = 1` → permitido (a diferencia de `tipoDatoComId`/`esLoopPowered`, ningún trigger lo rechaza en ninguna clase).
21. `causa_alarma = NULL` en una señal existente y en una nueva → permitido en ambos casos.

### 34.21 Tests API (`backend/tests/signals.api.test.ts`, extender el existente)

Espejo de los casos SQL relevantes a nivel HTTP: POST CONTROL sin `tagSenal` → 201; POST COM sin `tagSenal` → 201; PATCH con `tagSenal: null` → 200 (hoy rechazado, cambio de comportamiento a probar explícitamente); GET `/catalogs/com-data-types` trae los 7 códigos; POST COM con `tipoDatoComId` válido → 201; POST CONTROL con `tipoDatoComId` → 400 (mensaje ampliado); POST COM con `esLoopPowered` → 400; POST CONTROL con `esLoopPowered: true/false/null` → 201; POST CONTROL **y** POST COM con `causaAlarma: true` → 201 en ambos casos (única combinación de los 3 campos nuevos que no depende de la clase); GET de una señal devuelve `codigoSenal`/`causaAlarma`/`tipoDatoComId`/`tipoDatoComCodigo`/`esLoopPowered` en su forma serializada.

### 34.22 Regresiones necesarias

`test:signals` (directo), `test:connections` y `test:comm-links` (usan `nucleo.senal` como parte de rutas/enlaces, no deberían verse afectados pero deben re-confirmarse), `test:loops` (usa instrumentos con señales). Si el trigger extendido introduce algún error de sintaxis, cualquier INSERT/UPDATE de señal en cualquier suite lo revelaría de inmediato (falla dura, no silenciosa). Frontend: `tsc -b`, `vite build`, `oxlint` tras tocar `SignalForm.tsx`/`types.ts`/`catalogs.ts`.

### 34.23 Instalación limpia (diseño de cómo se validará, no ejecutado)

Mismo procedimiento que se usó y documentó para `012`: BD temporal descartable → aplicar `001`...`012` (ya congeladas) → aplicar `013_senales.sql` recién creado → `database/tests/001_smoke_modulo.sql` (fixture base) → `025_smoke_senales_opcionales.sql` (o el nombre real que se le dé) → BD destruida al final. No ejecutado en esta ronda (solo diseño, per instrucción explícita).

### 34.24 Draft técnico FINAL consolidado de `013_senales.sql` (NO creado como archivo)

```sql
-- =============================================================================
-- 013_senales.sql — SIEI (DRAFT FINAL, sin implementar)
-- =============================================================================

-- 1. tag_senal: obligatorio -> opcional
ALTER TABLE nucleo.senal ALTER COLUMN tag_senal NVARCHAR(80) NULL;

-- 2. Reemplazar el índice único de tag_senal para excluir NULL explícitamente
DROP INDEX UX_senal_proyecto_tag ON nucleo.senal;
CREATE UNIQUE INDEX UX_senal_proyecto_tag
    ON nucleo.senal (proyecto_id, tag_senal)
    WHERE tag_senal IS NOT NULL AND activo = 1;

-- 3. codigo_senal: referencia legacy/importada, opcional, SIN unicidad
ALTER TABLE nucleo.senal ADD codigo_senal NVARCHAR(20) NULL;
CREATE INDEX IX_senal_proyecto_codigo
    ON nucleo.senal (proyecto_id, codigo_senal)
    WHERE codigo_senal IS NOT NULL;

-- 4. causa_alarma: atributo propio de SIEI, independiente del Excel,
--    sin FK, sin catálogo, sin CHECK, sin restricción de clase
ALTER TABLE nucleo.senal ADD causa_alarma BIT NULL;

-- 5. Catálogo cat.cat_tipo_dato_com (lista cerrada, evidencia real, 34.7)
CREATE TABLE cat.cat_tipo_dato_com (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_dato_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_dato_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_dato_com_codigo UNIQUE (codigo)
);

INSERT INTO cat.cat_tipo_dato_com (codigo, descripcion) VALUES
    (N'BIT',   N'Un bit (booleano)'),
    (N'WORD',  N'Palabra sin signo de 16 bits'),
    (N'DWORD', N'Palabra sin signo de 32 bits'),
    (N'UINT',  N'Entero sin signo de 16 bits'),
    (N'UDINT', N'Entero sin signo de 32 bits'),
    (N'DINT',  N'Entero con signo de 32 bits'),
    (N'REAL',  N'Punto flotante de 32 bits');

-- 6. tipo_dato_com_id: FK opcional, exclusivo de COM (regla en el trigger, paso 8)
ALTER TABLE nucleo.senal ADD tipo_dato_com_id BIGINT NULL;
ALTER TABLE nucleo.senal ADD CONSTRAINT FK_senal_tipo_dato_com
    FOREIGN KEY (tipo_dato_com_id) REFERENCES cat.cat_tipo_dato_com (id);

-- 7. es_loop_powered: opcional, exclusivo de CONTROL (regla en el trigger, paso 8)
ALTER TABLE nucleo.senal ADD es_loop_powered BIT NULL;

-- 8. CHECK de exclusividad simple entre los dos campos de clase (sin JOIN a
--    catálogo, mismo patrón que CK_senal_tipo_io_direccion_excl) — defensa
--    adicional, no reemplaza la validación semántica del trigger de abajo
ALTER TABLE nucleo.senal ADD CONSTRAINT CK_senal_tipo_dato_com_loop_excl
    CHECK (NOT (tipo_dato_com_id IS NOT NULL AND es_loop_powered IS NOT NULL));

-- 9. Extender TR_senal_validar_clase (DROP + CREATE, cuerpo existente de
--    001_initial_schema.sql intacto salvo estos 3 cambios puntuales):
--    a) guarda de entrada: agregar OR UPDATE(tipo_dato_com_id) OR UPDATE(es_loop_powered)
--    b) bloque COM-prohibido: agregar "OR i.es_loop_powered IS NOT NULL" a la condición,
--       mensaje ampliado "Una senal COM no puede tener tipo_io_id, canal_id ni es_loop_powered."
--    c) bloque CONTROL-prohibido: agregar "OR i.tipo_dato_com_id IS NOT NULL" a la condición,
--       mensaje ampliado "Una senal CONTROL no puede tener direccion_com_id ni tipo_dato_com_id."
--    causa_alarma NO se toca en este trigger — no tiene restricción de clase.
```

**Confirmado que NO se incluye**: `senal.conex_tipo` (34.11, explícitamente rechazado — `BOT_S`/`BOT_D` quedan como deuda de modelado sin destino todavía), cualquier cambio a `instrumento` (34.13, fuera de alcance), `UX_senal_proyecto_codigo` como UNIQUE (34.6, decisión final: no UNIQUE), cualquier CHECK/trigger/FK que involucre `causa_alarma` (34.3, decisión final: campo plano sin restricciones).

### 34.25 Preguntas bloqueantes para 013

**Ninguna.** Las 3 preguntas de la ronda anterior quedaron resueltas: `causa_alarma` se implementa como `BIT NULL` independiente (34.3), `BOT_S`/`BOT_D` quedan fuera de 013 como deuda de modelado documentada sin bloquear nada (34.11), `codigo_senal` no lleva índice único (34.6). El diseño de `013_senales` está completo y consolidado en 34.24, listo para implementar cuando el usuario lo apruebe.

---

## 35. DISEÑO TÉCNICO EXACTO DE `014_planos.sql` (propuesto, NO implementado)

Verificación de repositorio (re-hecha, no asumida): `git status` limpio, `git log -3` = `83a8db4` (013) → `a33aba6` (011) → `019780e` (012), `013_senales.sql` confirmado comiteado. `014` confirmado como siguiente migración libre; `026` como siguiente smoke test libre.

### 35.1 `PLANOS` — estructura real confirmada (re-verificada contra el Excel, no asumida)

Encabezados reales: `ITEM, DESCRIPCION, CODIGO, TABLERO, TABLERO_WSP, PLANO_CONEX_INTERIOR, ESTAD0` — exactamente los 7 ya documentados, sin cambios. **40 filas reales de datos** (41 filas físicas menos 1 encabezado de sección "ELECTRICIDAD" en la fila 36, que no es un plano). Un bloque de 33 filas E&C/PE (filas 2-34) y un bloque de 7 filas "ELECTRICIDAD" (filas 37-43, diagramas de motor + unifilares) que **no tiene TABLERO/TABLERO_WSP/PLANO_CONEX_INTERIOR/ESTAD0 en absoluto** (las 4 columnas vienen `NULL` en las 7).

| Columna | Poblados | Notas |
|---|---|---|
| `CODIGO` | 37/40 | **1 duplicado real**: `620-J-20039` aparece en la fila 25 (E&C CONEXIONADO TBJ 3) Y en la fila 26 (PE LAYOUT TBC 3) — dos documentos distintos, mismo código. 3 nulos, los 3 son filas LAYOUT (32, 33, 34). Longitud uniforme: **11 caracteres**, formato `###-J-#####` (o `###-E-#####` en la sección ELECTRICIDAD). Varios códigos contienen `X` como placeholder de "aún no asignado" (`620-J-2XXX3`, `620-J-200X6`, etc.) |
| `DESCRIPCION` | 40/40 | **Cero duplicados.** Longitud real 42–79 caracteres |
| `TABLERO` | 32/40 | Ver clasificación 35.3 |
| `TABLERO_WSP` | 32/40 | Ver 35.4 |
| `PLANO_CONEX_INTERIOR` | 18/40 | Ver 35.5 |
| `ESTAD0` | 28/40 | Ver 35.6 |

### 35.2 Principio del dominio (confirmado, sin cambios de diseño)

`PLANO` = identidad viva del dibujo de ingeniería (`plano.id` es la identidad real, igual que `senal.id`/`gabinete.id`); `ENTREGABLE`/`REVISION_ENTREGABLE` = emisión documental controlada, dominio completamente separado (`nucleo.entregable` inspeccionado: numeración compuesta congelada, `tipo_entregable_id`, nada de esto aplica a un plano CAD/externo). Un `plano.codigo_plano` puede existir sin que exista jamás una revisión emitida — de hecho, hoy no existe ningún mecanismo de revisión de plano en absoluto, y **014 no lo crea** (ver 35.6).

### 35.3 Clasificación de `TABLERO` (evidencia dura, no asumida)

Cruzado contra `SENALES_CONTROL.RIO` (valores reales: `620-PCC-5006`, `620-RIO-5012`, `620-RIO-5013` — exactamente los 3 tags de gabinete ya conocidos desde el diagnóstico de 012) y `SENALES_CONTROL.TAG_CAJA`/`CAJA_EQUIPO` (valores reales: `620-TBC-5015/5016/5017/50X3/50X4/XXX1`, `620-TBJ-5014/5015/5016/XXX1/XXX2/XXX3` — exclusivamente prefijos `TBC-`/`TBJ-`, nunca usados como gabinete en ninguna otra hoja):

| Clasificación | Filas | Valores distintos |
|---|---|---|
| → `nucleo.gabinete` (prefijo `620-PCC-`/`620-RIO-`) | **18** | 3 (`620-PCC-5006`, `620-RIO-5012`, `620-RIO-5013`) |
| → `nucleo.caja` (prefijo `620-TBC-`/`620-TBJ-`) | **14** | 12 |
| → no resuelto | **0** | — |

**100% resuelto, sin ambigüedad.** Confirma exactamente la sospecha del diagnóstico anterior: `TABLERO` mezcla dos clases de objeto reales (gabinete y caja), nunca una tercera. **`plano.tablero` NO se crea como columna** — se resuelve exclusivamente vía las relaciones tipadas (35.9/35.10).

Evidencia de cardinalidad **N:M real** (no 1:1): la fila 34 tiene `TABLERO = '620-TBC-5016/5017'` — **un mismo plano (LAYOUT) documentando DOS cajas a la vez**, separadas por `/` en el dato crudo. `620-TBC-5016` por su parte tiene 3 planos propios (filas 20, 29, 34) — confirma también **un mismo tablero con varios planos**. Ver 35.11/35.12 para la cardinalidad completa.

### 35.4 `TABLERO_WSP` (confirmado: pertenece al gabinete/caja, no al plano — ya resuelto en la ronda de 012, re-confirmado aquí)

32/40 poblados, 10 valores distintos, todos con el mismo prefijo base que su `TABLERO` correspondiente (ej. fila 2: `TABLERO='620-RIO-5012'`, `TABLERO_WSP='620-RIO-T103'`; fila 13: `TABLERO='620-TBC-XXX1'`, `TABLERO_WSP='620-TBC -5015'`). Es el mismo concepto que motivó `gabinete.tag_anterior` en la migración 012 — el identificador histórico WSP del **tablero/gabinete que el plano documenta**, no del plano en sí. **Confirmado con datos reales: NO se carga en `plano.codigo_anterior`.** Cuando la futura importación exista, `TABLERO_WSP` alimentará `gabinete.tag_anterior` o `caja.tag_anterior` (columna que aún no existe en `nucleo.caja` — no se crea en 014, es una migración de Cajas, fuera de este alcance) según a cuál de las dos resuelva su `TABLERO` correspondiente.

### 35.5 `PLANO_CONEX_INTERIOR` (confirmado: es un SEGUNDO plano, no un atributo — con una anomalía real documentada)

18/40 poblados, solo **3 valores distintos** (`620-J-2023`, `620-J-2029`, `620-J-20019`), cada uno constante para **todas** las filas que comparten el mismo `TABLERO` (ej. las 7 filas de `620-RIO-5012` tienen todas `PLANO_CONEX_INTERIOR = 620-J-2023`). **Confirmado: nunca aparece en una fila cuyo `TABLERO` sea una caja** (0/14 filas-caja lo tienen) — es exclusivo de gabinete. Esto confirma la hipótesis exacta: es el código del plano de conexionado *interior* del gabinete, constante por gabinete, no un atributo de cada hoja individual.

**Anomalía real encontrada (no presente en el diagnóstico anterior)**: el valor `620-J-20019` (usado como `PLANO_CONEX_INTERIOR` de `620-PCC-5006` en 5 filas) es, en la fila 4 de la misma hoja, el `CODIGO` **propio** de un plano de `620-RIO-5012` ("HOJA 3"). Es decir, el código de "conexionado interior" de PCC-5006 coincide literalmente con el código ya usado como plano principal de otro gabinete distinto. Esto es casi con certeza un error de tipeo/copiado en el Excel legacy (no se puede confirmar ni corregir sin more contexto del usuario) — se documenta como advertencia de calidad de dato para la futura importación, no se resuelve aquí.

**Diseño confirmado**: `PLANO_CONEX_INTERIOR` se convierte en su propio registro de `nucleo.plano` (`tipo_plano = INTERIOR_GABINETE`), relacionado al mismo gabinete vía `gabinete_plano` — **no se crea `plano.plano_conex_interior` como columna de texto.**

### 35.6 `ESTAD0` (análisis profundo, confirma la mezcla ya sospechada — sigue fuera de 014)

28/40 poblados. Valores y frecuencia: `B`=16, `A`=6, `INI`=5, `ANULADO`=1. Los 12 nulos son **exactamente** las 5 filas LAYOUT + las 7 filas ELECTRICIDAD — `ESTAD0` está poblado en el 100% de las filas CONEXIONADO (28/28) y en el 0% de LAYOUT/ELECTRICIDAD. Esto es evidencia nueva: `ESTAD0` no es una propiedad universal de "plano", es específica del tipo CONEXIONADO en este dataset (podría ser solo que las otras aún no se cargaron, no una regla estructural — no se puede afirmar con certeza cuál de las dos).

Clasificación tentativa por valor:
- `INI`, `A`, `B` → **revisión** (progresión secuencial, ya evidenciado en la ronda de 012 con `620-PCC-5006` mostrando sus 3 hojas en distintos estados simultáneos)
- `ANULADO` → **estado documental** (terminal, aparece una sola vez, aislado, no combinado con una letra)
- Ningún valor cae en "desconocido" — los 4 valores observados encajan en las 2 categorías ya identificadas.

**Confirmado: 014 NO crea `cat_estado_plano` ni `revision_plano`.** El hallazgo se documenta, la separación real de "progresión de revisión" vs. "estado documental terminal" queda pendiente de una fase futura que sí las modele por separado.

### 35.7 Tipos de plano definitivos — CORRECCIÓN: solo 3, no 4

Clasificando las 40 filas reales por el contenido literal de `DESCRIPCION`:

| Tipo | Filas | Regla de clasificación | Evidencia |
|---|---|---|---|
| `CONEXIONADO` | **33** | Contiene "DIAGRAMA(S) DE CONEXIONADO" | Incluye las 5 filas de motores en la sección ELECTRICIDAD (mismo tipo de documento, sin gabinete/caja asociado) |
| `LAYOUT` | **5** | Prefijo `PE -` | **Verificado 1:1**: las 5 filas con prefijo `PE -` son exactamente las 5 filas que contienen la palabra "LAYOUT" en su descripción — ambas señales coinciden en el 100% de los casos, no solo el prefijo aislado |
| — sin clasificar | **0** | — | 33+5+2(ver abajo) = 40, cuadra exacto |

**Hallazgo que corrige la premisa original: `GANCHO` NO es un tipo de plano.** Se buscó `PLANO_GANCHO`/`PLANO_GANCHO_DESCRIPCION` en todo el workbook — existen únicamente en `SENALES`/`SENALES_CONTROL` (nunca en la hoja `PLANOS`). De los 24 valores distintos de `PLANO_GANCHO`, **20 (83%) coinciden literalmente con un `CODIGO` ya existente en `PLANOS`** (`620-J-20040`, `620-J-20035`, `620-E-60026`, etc. — códigos que ya son CONEXIONADO o de la sección ELECTRICIDAD). Los 4 que no coinciden son: `'VENDOR'` (26 ocurrencias — marcador explícito de "el gancho lo documenta el fabricante, no un plano de SIEI") y 3 variantes con errores/placeholders (`620-E-600XX`, `620-PPS-5005`, `620-PPS-5006` — el último parece un tag de equipo usado por error en vez del código del plano). Además, 90/269 filas con `PLANO_GANCHO` poblado **no tienen `TAG_CAJA`** — el "gancho" no es exclusivo de señales que llegan a una caja, también aparece en señales que terminan directo en equipo.

**Conclusión con evidencia**: `GANCHO` es una **referencia desde `SEÑAL` hacia un plano YA EXISTENTE** (de cualquier tipo — normalmente CONEXIONADO), no una categoría de plano nueva. Es conceptualmente idéntico a `lazo.codigo_documento` (35.16): un puntero de otra entidad hacia un plano, no un atributo del plano. **No se agrega `GANCHO` a `cat.cat_tipo_plano`.** Tampoco se agrega ninguna columna a `nucleo.senal` en 014 (`senal.plano_gancho`) — eso pertenece, si acaso, a una fase futura de conexionado (mismo criterio que `lazo.codigo_documento`, ver 35.16), y el valor `'VENDOR'` tampoco encaja como FK a `plano.id` (no es un plano real).

**¿Falta un quinto tipo? — evidencia mixta, no concluyente.** Las 7 filas de la sección "ELECTRICIDAD" incluyen 5 `CONEXIONADO` (diagramas de conexionado de motor, encajan bien) pero **2 filas dicen literalmente "DIAGRAMA UNIFILAR"** (filas 42-43: suministro 480V y centro de control de motores) — un tipo de dibujo eléctrico genuinamente distinto (diagrama unifilar/de una línea) que no encaja en `CONEXIONADO`, `INTERIOR_GABINETE` ni `LAYOUT`. Es evidencia real, pero son solo 2 filas de un dominio (distribución eléctrica de potencia) que está en el borde del alcance actual de I&C. **Se documenta como candidato (`UNIFILAR`) sin agregarlo al seed de 014** — ver pregunta abierta en 35.22.

**Tipos definitivos para el seed de 014**: `CONEXIONADO`, `INTERIOR_GABINETE`, `LAYOUT`. `LAZO`, `UBICACION`, `P&ID` confirmados fuera (35.16-35.18); `GANCHO` removido de la lista original con evidencia (arriba); `UNIFILAR` documentado como candidato no incluido.

### 35.8 `codigo_plano` — política definitiva

`NVARCHAR(50)`, nullable — mismo patrón de longitud que `tag_gabinete`/`tag_caja`/`tag_instrumento` (todos `NVARCHAR(50)` en el esquema actual, independientemente de que el dato real observado sea más corto: 11 caracteres uniformes, formato `###-J-#####`/`###-E-#####`). **Nullable** porque 3/40 filas reales (todas LAYOUT) no tienen código todavía. **Sin `UNIQUE`**: se encontró **un duplicado real** (`620-J-20039`, ver 35.1) en el único dataset disponible — evidencia aún más fuerte que la ya usada para decidir que `codigo_senal` (013) tampoco fuera único. Se propone en su lugar un índice no único filtrado, igual patrón que `IX_senal_proyecto_codigo`:

```sql
CREATE INDEX IX_plano_proyecto_codigo
    ON nucleo.plano (proyecto_id, codigo_plano)
    WHERE codigo_plano IS NOT NULL AND activo = 1;
```

(Con `activo = 1` a diferencia de `IX_senal_proyecto_codigo`, porque aquí sí tiene sentido excluir planos desactivados de la búsqueda operativa — a diferencia de `codigo_senal`, que es puramente legado/histórico y se busca igual esté la señal activa o no.)

### 35.9 Esquema definitivo de `nucleo.plano`

Patrón inspeccionado contra `nucleo.gabinete`/`nucleo.caja` (mismas convenciones: `id BIGINT IDENTITY`, `UNIQUE(id, proyecto_id)`, `activo BIT DEFAULT 1`, `created_at/updated_at`, `created_by/updated_by` vía FK a `seguridad.usuario` como en las 20 tablas de la migración 003).

```sql
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
```

`descripcion NOT NULL` (100% poblado en la evidencia real, es la única columna siempre presente además del tipo). `descripcion NVARCHAR(300)` — mismo patrón que `instrumento.descripcion`/`gabinete.descripcion`/`caja.descripcion` (no `NVARCHAR(200)`, ese es el patrón de `cat.*`; no `MAX`, el dato real es de 42-79 caracteres, 300 da margen amplio sin desperdiciar). `codigo_anterior NVARCHAR(50) NULL`, sin `UNIQUE`, sin FK — mismo patrón exacto que `instrumento.tag_anterior`/`gabinete.tag_anterior`, **y solo se puebla si representa el código anterior del MISMO plano** (35.1 confirma: el Excel actual no tiene evidencia de un código anterior de plano — queda `NULL` para todo lo que se importe de este dataset).

### 35.10 Esquema definitivo de `nucleo.gabinete_plano` y `nucleo.caja_plano`

Estrategia de relación tipada (no genérica `plano_entidad`/`tipo_entidad`) confirmada como la más coherente: sigue el mismo espíritu que el resto del modelo (`CK_..._xor` en vez de FK polimórfica) y es, de hecho, la **primera tabla puramente de unión N:M** del esquema `nucleo` — no hay antecedente idéntico, así que se diseña siguiendo los principios ya documentados (FK compuesta por proyecto, filtrado único, soft delete + auditoría igual que cualquier otra tabla `nucleo`, en vez de tratarla como una excepción):

```sql
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

CREATE UNIQUE INDEX UX_gabinete_plano_activo
    ON nucleo.gabinete_plano (gabinete_id, plano_id)
    WHERE activo = 1;
```

`nucleo.caja_plano` es estructuralmente idéntico, sustituyendo `gabinete_id`→`caja_id` y las FKs correspondientes a `nucleo.caja`. **Protección cross-project automática**: al tener `proyecto_id` como columna propia de la fila de unión, y ambas FKs compuestas exigir `(hijo_id, proyecto_id)` contra el MISMO `proyecto_id` de la fila, es estructuralmente imposible relacionar un gabinete/caja de un proyecto con un plano de otro — mismo mecanismo ya usado en todo el esquema (`senal.canal_id`, `punto_conexion.*`, etc.), no hace falta ningún `CHECK` ni trigger adicional.

### 35.11 Cardinalidad GABINETE ↔ PLANO (evidencia real, no 1:1)

**1 gabinete → N planos, confirmado con datos reales**: `620-RIO-5012` tiene 7 planos propios (6 hojas de conexionado + 1 layout), `620-RIO-5013` tiene 6, `620-PCC-5006` tiene 5 (4 hojas + 1 layout) — exactamente el patrón `conexionado (varias hojas) + layout` descrito en el pedido. **N planos → 1 gabinete es el caso dominante** en este dataset; no se encontró ningún caso real de "un plano → varios gabinetes" (el único caso de agrupación múltiple encontrado fue del lado de caja, ver 35.12), pero la tabla de unión N:M soporta ambos sentidos sin costo adicional — no se restringe artificialmente a 1:N solo porque sea lo único observado hoy.

### 35.12 Cardinalidad CAJA ↔ PLANO (confirmado N:M real)

**Confirmado con evidencia directa, no hipotético**: la fila 34 (`'PE - ... LAYOUT TABLEROS TBC 1/2'`, `TABLERO='620-TBC-5016/5017'`) es **un solo plano relacionado con DOS cajas**. Y `620-TBC-5016` tiene **3 planos propios** (filas 20, 29, 34) — confirma también "una caja, varios planos". La cardinalidad real es N:M en ambos sentidos, exactamente lo que `nucleo.caja_plano` como tabla de unión modela sin necesitar ningún caso especial.

### 35.13 Unicidades e índices — resumen definitivo

| Objeto | Índice | Motivo |
|---|---|---|
| `nucleo.plano` | `IX_plano_proyecto_codigo` (NO único, filtrado `WHERE codigo_plano IS NOT NULL AND activo=1`) | Duplicado real encontrado (35.8); LAYOUT frecuentemente sin código |
| `nucleo.gabinete_plano` | `UX_gabinete_plano_activo` (ÚNICO, filtrado `WHERE activo=1`, sobre `(gabinete_id, plano_id)`) | Evita duplicar la MISMA asociación activa dos veces, sin impedir que un gabinete tenga múltiples planos DISTINTOS (la unicidad es sobre el PAR, no sobre `gabinete_id` solo) |
| `nucleo.caja_plano` | `UX_caja_plano_activo` (ÚNICO, filtrado `WHERE activo=1`, sobre `(caja_id, plano_id)`) | Mismo motivo |

### 35.14 FKs cross-project — confirmado, sin mecanismo nuevo

Ya cubierto en 35.10: toda relación de `gabinete_plano`/`caja_plano` lleva su propio `proyecto_id`, y ambas FK compuestas fuerzan que el gabinete/caja Y el plano referenciado pertenezcan al mismo proyecto que esa fila de unión — estructuralmente imposible cruzar proyectos, sin necesidad de `CHECK` ni trigger. Mismo patrón que el resto del esquema, ninguna excepción.

### 35.15 Política de `codigo_anterior` — definitiva

`plano.codigo_anterior` existe conceptualmente pero **no se puebla desde `TABLERO_WSP`** (35.4 — ese valor pertenece al gabinete/caja, no al plano). El Excel actual no muestra evidencia de que un plano individual haya tenido un código *anterior propio* distinto del actual. Política: `codigo_anterior = NULL` para toda fila creada a partir de este dataset; la columna queda preparada para el día en que exista evidencia real de renumeración de un plano específico (ej. un plano reeditado con nuevo número de documento tras un cambio de disciplina o de numeración de proyecto).

### 35.16 `nucleo.lazo` — inspeccionado, sin tocar en 014

`nucleo.lazo` (migración 001): `id, proyecto_id, instrumento_id NOT NULL, codigo_documento NVARCHAR(100) NULL, activo, created_at, updated_at`. Hoy `codigo_documento` es texto libre sin FK — candidato evidente a convertirse en `lazo.plano_id BIGINT NULL` con FK compuesta a `nucleo.plano`, pero **no se migra en 014** (sería un cambio de columna existente con datos ya cargados en un dominio distinto — instrumentación, no planos — y mezclaría dos refactors). Documentado como trabajo futuro explícito, ninguna FK ni columna nueva se toca en `nucleo.lazo` en esta migración.

### 35.17 `UBICACION` — candidato futuro, no incluido

Sin evidencia de filas reales de plano de ubicación en el dataset actual (ninguna fila de `PLANOS` menciona "UBICACION" en su descripción). Se documenta como candidato para un futuro tipo de `cat.cat_tipo_plano`, sin seedearlo por anticipado — agregar un catálogo con cero evidencia real sería inventar, no confirmar.

### 35.18 P&ID — confirmado fuera de 014

`instrumento.plano_pnid`/`equipo.plano_pnid` ya existen (migraciones 004/007) con su propio origen (el importador P&ID/Plant3D, dominio completamente distinto). No hay ninguna razón estructural para mezclarlos con `nucleo.plano` en 014 — son referencias de texto libre a un plano P&ID que vive fuera del alcance actual de este dominio. Confirmado: **P&ID queda fuera de 014**, sin FK, sin mención en `cat.cat_tipo_plano`.

### 35.19 Relación con Entregables — confirmado, sin FK en 014

`nucleo.entregable` inspeccionado (migración 006): numeración compuesta congelada (`componente_etapa/proyecto/cliente/tipo/area/disciplina/correlativo`), pensada para documentos **generados por SIEI desde plantilla** (hoy solo LDI). Un plano es un documento **externamente autorado** (CAD), catalogado pero no generado por SIEI — dominios estructuralmente distintos, ya confirmado conceptualmente antes de esta ronda. **014 no crea `plano.entregable_id` ni `entregable.plano_id`.** Si en el futuro un plano necesita pasar por un flujo de emisión controlada equivalente al de LDI, sería una relación explícita a diseñar entonces, no una anticipada aquí sin caso de uso real.

### 35.20 Soft delete y auditoría — confirmado sin sorpresas

Las 3 tablas (`plano`, `gabinete_plano`, `caja_plano`) siguen el patrón universal ya usado en cada tabla `nucleo.*` desde la migración 003: `activo BIT NOT NULL DEFAULT 1`, `created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()`, `updated_at DATETIME2 NULL` (poblado por el backend, nunca por trigger salvo cascada), `created_by`/`updated_by BIGINT NULL` con FK a `seguridad.usuario` (nulos permitidos para datos de sistema/importación, igual que el resto). Ninguna columna adicional inventada.

### 35.21 Backend — diseño, sin implementar

**Ruta**: `/api/projects/:projectId/planos` (español), **no** `/api/projects/:projectId/plans`. Justificación basada en la convención real del backend, no en preferencia: el precedente mixto existente usa inglés para la mayoría (`instruments`, `equipment`, `boxes` para `caja`, `switches`, `racks`, `loops`) pero español para conceptos de dominio sin traducción limpia y de introducción reciente (`gabinetes`, `documentacion`, `plantillas-entregable`, `entregables`, `revisiones`) — precisamente el precedente más reciente y más cercano temática y cronológicamente (`gabinetes`, migración 012, la migración inmediatamente anterior de este mismo arco Señales/Gabinetes/Planos) resolvió el mismo dilema a favor del español porque "cabinet"/"enclosure" no capturan el término de dominio tal como ya se usa en todo el proyecto. "Plano" tiene el mismo problema: "plans"/"drawings" en inglés no transmiten específicamente "documento de ingeniería tipo CAD" sin ambigüedad, y toda la documentación de este dominio (`CLAUDE.md`, este mismo diagnóstico) ya usa "Planos" consistentemente en español como nombre de sección. Se recomienda `/api/projects/:projectId/planos`.

Diseño de endpoints (mismo patrón que `gabinetes.ts`):
- `GET /planos` — filtros por querystring: `?tipoPlanoId=`, `?gabineteId=` (join a `gabinete_plano`), `?cajaId=` (join a `caja_plano`) — mismo patrón `?instrumentoId=`/`?canalId=` ya usado en `signals.ts`/`connectionPoints.ts`.
- `GET /planos/:id` — incluye, en la respuesta, los gabinetes y cajas asociados (arrays resueltos, no solo ids sueltos) para evitar 3 llamadas separadas desde el frontend.
- `POST /planos` — body: `codigoPlano` (opcional), `codigoAnterior` (opcional), `descripcion` (requerido), `tipoPlanoId` (requerido). Nunca acepta `gabineteId`/`cajaId` directamente en el mismo body (las asociaciones son su propio recurso, ver más abajo) — sigue el mismo principio que `punto_conexion` (creado con su dueño ya resuelto) pero aquí, al ser N:M real, no aplica un "dueño único al crear": el plano se crea solo, las asociaciones se agregan después.
- `PATCH /planos/:id` — mismos 4 campos editables.
- `DELETE /planos/:id` — soft delete (`activo=0`), mismo patrón que el resto; reactivar no existe hoy en ningún endpoint de este estilo (ni `gabinetes.ts` lo tiene), no se inventa aquí.
- `POST /planos/:id/gabinetes` — body `{ gabineteId }`, crea la fila de `gabinete_plano` (o la reactiva si ya existía inactiva, mismo criterio que otros índices filtrados del repo). `DELETE /planos/:id/gabinetes/:gabineteId` — desactiva la asociación.
- `POST /planos/:id/cajas` / `DELETE /planos/:id/cajas/:cajaId` — análogo para caja.
- **Catálogo**: `cat.cat_tipo_plano` tiene forma `{id, codigo, descripcion, created_at, updated_at}` — mismo caso que `cat.cat_tipo_dato_com` en 013: se expone reutilizando `createSimpleCatalogRouter('cat.cat_tipo_plano', false)`, sin router propio, montado en `/api/catalogs/tipos-plano` (español, seguido el precedente de `tipos-gabinete`/`tipos-equipo`, no el de `io-types`/`com-directions` — `cat_tipo_plano` es un catálogo de ENTIDAD como gabinete/equipo, no un catálogo de VALIDACIÓN de señal como `cat_tipo_dato_com`, así que sigue esa otra familia de nombres).

### 35.22 Frontend — diseño, sin implementar

Módulo nuevo `Planos`: `PlanosListPage` (tabla: Código / Descripción / Tipo / Código anterior), `PlanoFormPage` (crear/editar, campos: Código, Descripción\*, Tipo\*, Código anterior), `PlanoDetailPage` (datos + gestión de asociaciones). Mismo patrón visual que `GabinetesListPage`/`GabineteDetailPage`.

**Recomendación UX — opción B (crear, luego asociar en el detalle), no A (todo en un formulario):** dado que la relación es N:M real y un plano puede nacer sin ninguna asociación todavía (o con varias desde el principio, sin límite fijo), meter un multi-select de gabinetes Y otro de cajas dentro del mismo formulario de creación sería sobrediseñar un caso que el propio dominio no acota (¿cuántos de cada uno mostrar por defecto?). El patrón ya establecido en el frontend para relaciones N:M-ish es justamente "crear la entidad simple primero, gestionar relaciones en su página de detalle" (ej. instrumento se crea solo, sus señales se gestionan después desde Señales, no desde el formulario de Instrumento). Se recomienda: `PlanoFormPage` crea solo los 4 campos propios; `PlanoDetailPage` tiene dos secciones ("Gabinetes asociados" / "Cajas asociadas") con un selector + botón "Asociar" y una lista con botón "Quitar" por fila — igual espíritu que la sección de puertos dentro de `SwitchDetailPage`.

### 35.23 Tabla de mapeo Excel → SIEI (los 7 campos reales)

| Campo Excel | Destino SIEI | Persistido/derivado/ignorado | Observación |
|---|---|---|---|
| `ITEM` | — | Ignorado | Correlativo de fila del Excel, sin significado fuera de él (igual que otros `ITEM` ya vistos en este workbook) |
| `DESCRIPCION` | `plano.descripcion` | Persistido literal | 100% poblado, sin duplicados |
| `CODIGO` | `plano.codigo_plano` | Persistido literal | Nullable, sin normalización — preserva placeholders `X` tal cual |
| `TABLERO` | `gabinete_plano`/`caja_plano` (resuelto por prefijo, ver 35.3) | Derivado a relación, nunca columna | Puede generar 1 o 2 filas de relación si el valor viene compuesto (`"A/B"`) |
| `TABLERO_WSP` | `gabinete.tag_anterior` / `caja.tag_anterior` (futuro) | Derivado, va a OTRA entidad | Nunca a `plano.codigo_anterior` (35.4) |
| `PLANO_CONEX_INTERIOR` | Nuevo registro de `nucleo.plano` (`tipo=INTERIOR_GABINETE`) + `gabinete_plano` | Derivado a una fila adicional | Un valor puede repetirse en varias filas de `PLANOS` — se crea una sola vez por valor distinto, no una vez por fila origen |
| `ESTAD0` | — (por ahora) | Ignorado en 014 | Ver 35.6 — queda documentado, no modelado |

### 35.24 Datos existentes de SIEI (consultado, no asumido)

`nucleo.gabinete`: 42 filas, 1 activa, **todas en TEST-001** (fixtures). `nucleo.caja`: 33 filas, **0 activas** (todas desactivadas por corridas de test anteriores), todas en TEST-001. **Proyecto real 22043: 0 gabinetes, 0 cajas.** `nucleo.plano` **no existe todavía** (`OBJECT_ID('nucleo.plano') IS NULL`, confirmado). Mismo perfil que `senal`/`gabinete` antes de sus respectivas migraciones: cero dato real, cero riesgo de backfill con datos de producción.

### 35.25 Backfill — confirmado: ninguno

014 crea catálogo + tablas + constraints + índices; `nucleo.plano` queda **vacío** al terminar. No existe ninguna razón técnica para poblar nada automáticamente — la importación real de `PLANOS` es un proyecto aparte, explícitamente fuera de esta migración (punto 33 del pedido).

### 35.26 Tests SQL — diseño (próximo número real: **026**, confirmado libre)

1. Crear plano con `codigoPlano` — aceptado.
2. Crear plano sin `codigoPlano` (`NULL`) — aceptado.
3. Mismo `codigo_plano` activo dos veces en el mismo proyecto — **permitido** (sin UNIQUE, 35.8) — caso explícito para no dejarlo sin cubrir, invierte la expectativa "natural".
4. Mismo `codigo_plano` en otro proyecto — permitido (ya lo es, al no haber UNIQUE, pero se prueba igual para dejar registro del comportamiento esperado).
5. Desactivar un plano (`activo=0`) y crear uno nuevo con el mismo código — permitido (no hay índice único que lo bloquee de todas formas).
6. `tipo_plano_id` inexistente — rechazado (FK).
7. `proyecto_id` inexistente en un INSERT directo — rechazado (FK, regresión estándar).
8. Asociar plano-gabinete mismo proyecto — aceptado, aparece en `gabinete_plano`.
9. Asociar plano-gabinete cross-project — rechazado (FK compuesta).
10. Asociar la MISMA pareja gabinete-plano dos veces activa — rechazado (`UX_gabinete_plano_activo`).
11. Asociar plano-caja mismo proyecto — aceptado.
12. Asociar plano-caja cross-project — rechazado.
13. Asociar la misma pareja caja-plano dos veces activa — rechazado.
14. Un gabinete con múltiples planos distintos — permitido (varias filas en `gabinete_plano`, distinto `plano_id` cada una).
15. Un plano con múltiples gabinetes distintos — permitido (reproduce el caso real de la fila 34 del Excel, adaptado a gabinete para cubrir ambos lados).
16. Una caja con múltiples planos — permitido.
17. Auditoría: `created_by`/`updated_by` se pueblan cuando se pasa el parámetro, quedan `NULL` si no (regresión del patrón estándar).
18. Reactivar una asociación previamente desactivada (crear de nuevo la misma pareja tras desactivarla) — permitido, sin violar el índice filtrado.

### 35.27 Tests API — diseño

CRUD completo de `/planos` con los 3 roles (ADMIN/EDITOR/VIEWER); filtros `?tipoPlanoId=`/`?gabineteId=`/`?cajaId=`; `codigoPlano` duplicado → 201 (no 409, a diferencia de `tag_gabinete`/`tag_caja` — caso explícito para no romper la expectativa heredada de otros módulos); asociar/desasociar gabinete y caja vía los sub-recursos; cross-project → 400 `invalid_reference` (mismo patrón que `racks.ts`/`switches.ts` con `gabineteId` inexistente/ajeno); permisos de proyecto (403 para VIEWER en escritura); `GET /catalogs/tipos-plano` trae exactamente `CONEXIONADO`/`INTERIOR_GABINETE`/`LAYOUT`.

### 35.28 Instalación limpia futura (diseño, no ejecutada)

BD temporal descartable → aplicar `001`...`013` (congeladas) → aplicar `014_planos.sql` recién creado → `001_smoke_modulo.sql` (fixture base) → `026_smoke_planos.sql` (o el nombre real que se le dé) → destruir la BD. Mismo procedimiento ya usado y documentado para 012 y 013.

### 35.29 Draft DDL completo de `014_planos.sql` (consolidado, NO creado como archivo)

```sql
-- 1. Catálogo global (lista cerrada, 3 valores confirmados con evidencia)
CREATE TABLE cat.cat_tipo_plano (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_plano_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_plano PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_plano_codigo UNIQUE (codigo)
);

INSERT INTO cat.cat_tipo_plano (codigo, descripcion) VALUES
    (N'CONEXIONADO',       N'Diagrama de conexionado / cableado'),
    (N'INTERIOR_GABINETE', N'Plano de conexionado interior de un gabinete'),
    (N'LAYOUT',            N'Plano de distribución física (layout)');

-- 2. nucleo.plano
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

CREATE INDEX IX_plano_proyecto_codigo
    ON nucleo.plano (proyecto_id, codigo_plano)
    WHERE codigo_plano IS NOT NULL AND activo = 1;

-- 3. nucleo.gabinete_plano (union N:M)
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

CREATE UNIQUE INDEX UX_gabinete_plano_activo
    ON nucleo.gabinete_plano (gabinete_id, plano_id)
    WHERE activo = 1;

-- 4. nucleo.caja_plano (union N:M, estructuralmente identico)
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

CREATE UNIQUE INDEX UX_caja_plano_activo
    ON nucleo.caja_plano (caja_id, plano_id)
    WHERE activo = 1;
```

**Confirmado que NO se incluye**: `revision_plano`, `cat_estado_plano`, `archivo_plano`, `plano_pdf`/`plano_dwg`, importador de `PLANOS`, `vw_conexionado`, terminaciones/borneras, `BOT_S`/`BOT_D`, cualquier columna/catálogo `UNIFILAR`, `LAZO`, `UBICACION`, `P&ID`, `plano.entregable_id`/`entregable.plano_id`, `plano.tablero`, `plano.plano_conex_interior`, `senal.plano_gancho`, cambios a `001`–`013`.

### 35.30 Preguntas — decisiones finales (RESUELTO, `014_planos` implementada)

1. **`UNIFILAR` como cuarto tipo**: **aprobado e incorporado** al seed de `cat.cat_tipo_plano` — 2 documentos reales inequívocos son evidencia suficiente. Sin lógica especial: mismo catálogo cerrado, mismo tratamiento que los otros 3.
2. **La anomalía de `PLANO_CONEX_INTERIOR` para `620-PCC-5006`** (código `620-J-20019` coincidiendo con el plano propio de `620-RIO-5012`): **queda documentada, no resuelta**. Conflicto legacy real, pendiente de aclaración humana en la futura importación (política: detectar + advertir, nunca corregir ni fusionar automáticamente).
3. **El duplicado real de `CODIGO`** (`620-J-20039`): **queda documentado, no corregido**. Confirma la decisión ya tomada de no imponer `UNIQUE` sobre `codigo_plano`; la futura importación deberá advertir sobre este caso puntual sin bloquear ni deduplicar.
4. **Ruta del backend**: **aprobada `/planos`** (español) — implementada en `backend/src/routes/planos.ts`, montada en `/api/projects/:projectId/planos`.

`014_planos` está implementada y aplicada en SIEI_DEV: `cat.cat_tipo_plano` (4 tipos), `nucleo.plano`, `nucleo.gabinete_plano`, `nucleo.caja_plano` — las 3 tablas nuevas quedaron vacías tras la migración (0 filas), sin ningún backfill, tal como se diseñó. Backend completo (CRUD + asociaciones N:M con reactivación) y frontend completo (`PlanosListPage`/`PlanoFormPage`/`PlanoDetailPage`) implementados. `database/tests/026_smoke_planos.sql` (18 casos) y `backend/tests/planos.api.test.ts` (33 casos) en verde, tanto en SIEI_DEV como en una instalación limpia `001→014` desde los archivos versionados. Detalle completo en el reporte de entrega al usuario, no repetido aquí.

**`014_planos.sql` (implementada) es la última migración congelada.** `015_terminaciones` sigue sin diseñar más allá de reconocerla como la siguiente fase.

## 36. Diagnóstico técnico — `015_terminaciones` (SOLO DISEÑO, sin implementar)

Fase disparada por el mensaje "FASE 015 — DISEÑO TÉCNICO DE `015_terminaciones`". `001`–`014` quedan congeladas (`014_planos` en `98e61bc`, working tree limpio al iniciar). Este apartado es puramente analítico: **no existe `015_terminaciones.sql`, no se aplicó SQL, no hay backend/frontend/tests nuevos, no hay commit.**

### 36.1 Modelo físico actual re-inspeccionado (evidencia de código, no de memoria)

De `001_initial_schema.sql` (líneas ~300-650) y `012_gabinetes.sql` (líneas ~283-620, versión vigente post-rename):

- `nucleo.modulo(id, proyecto_id, slot_id, catalogo_modulo_id, activo, ...)` — 1 módulo por slot (`UQ_modulo_slot`).
- `nucleo.canal(id, proyecto_id, modulo_id, numero_canal, activo, ...)` — `UX_canal_modulo_numero`. `TR_canal_validar_capacidad` valida rango y cupo contra `cat_modulo_io.canales_max`.
- `nucleo.cable(id, proyecto_id, tag_cable, tipo_cable NVARCHAR(100), capacidad_conductores, activo, ...)`.
- `nucleo.par_conductor(id, proyecto_id, cable_id, numero_par, ...)` — **sin `activo`** (registro histórico permanente, precedente ya documentado), `UQ_par_conductor_cable_numero`. Solo modela **pares**, no conductores individuales.
- `nucleo.punto_conexion(id, proyecto_id, instrumento_id, equipo_id, caja_id, gabinete_id, modulo_id, regleta, bornera, borne, lado, circuito, hilo, descripcion, activo, ...)` — dueño XOR de 5 vías (`CK_punto_conexion_pertenencia_xor`). Los 6 campos de terminal son **texto libre sin normalizar**: `regleta`/`borne`/`circuito`/`hilo` NVARCHAR(30), `lado` NVARCHAR(20), `bornera` NVARCHAR(30) — confirmado en `backend/src/routes/connectionPoints.ts` (`OWNER_FIELDS`, sin validación de formato ni unicidad).
- `nucleo.ruta_conexion(id, proyecto_id, senal_id, activo, ...)` — 1:1 con una señal activa.
- `nucleo.tramo_conexion(id, proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden, activo, ...)`.

**Brecha confirmada** (vía `TR_senal_validar_canal_ruta`, `TR_tramo_conexion_validar_secuencia`, `TR_tramo_conexion_validar_canal_ruta`): una ruta es `INSTRUMENTO/EQUIPO → 0..N CAJA (intermedios) → GABINETE/MODULO (final)`. El tramo final solo valida que `punto_destino.modulo_id = canal.modulo_id` (el **módulo entero**) — **no existe `punto_conexion.canal_id`**, por lo que hoy es imposible representar "aterrizó en el canal N específico", solo "aterrizó en este módulo". Esta es exactamente la brecha que el punto 18 del pedido pide cerrar.

**Restricción operativa heredada** (sin cambios desde `001`): una ruta multi-tramo debe construirse/editarse en **una sola sentencia multi-fila** — un estado intermedio que termine en CAJA es rechazado (error 51007) dentro de la misma transacción. Cualquier API nueva de terminales debe respetar esto.

### 36.2 Evidencia Excel — sin asumir semántica por nombre (`02_MASTER_IO_620.xlsm`, `SENALES_CONTROL`, 488 filas)

| Campo | Población | Formato real | Hallazgo |
|---|---|---|---|
| `TB` | 488/488 (100%) | `TB-01`…`TB-15+` | Identificador de **bloque físico de terminales**, alta repetición (`TB-07`×56, `TB-01`×48). |
| `BORNERA` | 488/488 (100%) | `F{impar}-{par}` (`F1-2`…`F31-32`) | Terminal **par** específico dentro de un `TB`. `TB-01` por sí solo abarca 16 valores distintos de `BORNERA` (`F1-2`…`F31-32`) — confirma jerarquía `TB` (bloque) ⊃ `BORNERA` (par dentro del bloque), no sinónimos. Un valor anómalo encontrado: `"F1-F2-3-4"` (fila `620-PIT-5058`) — formato compuesto/mal formado, evidencia de calidad de dato real, no un patrón nuevo. |
| `T_MODULO` | 488/488 (100%) | 2 partes separadas por `;` en 472/488 (ej. `IN-0;L2-0`), 3 partes en 16/488 (instrumentos RTD 3 hilos, ej. `IN_0/A;IN_0/A;IN_0/RTD C`) | **Determinístico por `(MODELO, CANAL)`**: 0 de 56 combinaciones verificadas tienen más de un `T_MODULO` distinto. Es la etiqueta de fábrica impresa en el **conector del módulo**, fija por modelo+canal — un hecho de hoja de datos, no un dato por señal. |
| `TB_CAJA` | 189/488 (39%) | **Constante literal `"TB"` en el 100% de los casos poblados** | No distingue nada — confirma la sospecha previa del diagnóstico: convención/placeholder, no una identidad real. |
| `BORNE_JB` | 189/488 (39%) | Listas separadas por coma (`"1,2"`, `"1,2,3"`, `"10,11,12,13,14"`, etc.) | Ver 36.3 — semántica resuelta esta fase. |
| `BORNERA_BLOQUE_CAJA` | 189/488 (39%) | Enteros secuenciales `1`…`41` | Ver 36.4 — semántica resuelta esta fase. |
| `B_NUM_RESERVA` | 12/488 (2.5%) | Enteros pequeños (1,2,3,5,7,10) | Ver 36.5. |
| `N_PAR_CABLE` | 269/488 (55%) | Dígito único 1-9 | Mapea directo a `par_conductor.numero_par` — **pero ver 36.6**, hay evidencia de que no siempre representa un par físico real. |
| `TAG_CABLE` vs `TAG_CABLE_INST` | 269/488 y 189/488 | `620TBC5016-T01` / `620HV5084-T01` | Dos tags de cable distintos para los dos tramos (instrumento→caja usa `_INST`; caja→gabinete usa el otro) — el modelo multi-tramo actual ya soporta esto sin cambios. |
| `TIPO_CABLE`/`TIPO_CABLE_INST` | — | Texto libre (`"1-19c#14 AWG"`, `"1-8p#18 AWG+SH"`, `"1-1p#16 AWG+SH"`) | Mapea a `cable.tipo_cable NVARCHAR(100)`. **Nota importante**: `"19c"` = 19 **conductores** (no pares); `"8p"`/`"1p"` = pares. Coexisten cables organizados en pares y cables organizados en conductores individuales — ver 36.6. |
| `CANAL` | 100% | Entero secuencial 0-N | Mapea a `canal.numero_canal`. |

### 36.3 `BORNE_JB` — resuelto (puntos 6, 8, 9 del pedido)

**Caso obligatorio `620-HV-5084`** (instrumento tipo válvula motorizada con selector remoto + finales de carrera + comando abrir/cerrar), las 5 señales de ESE instrumento en la misma caja `620-TBC-XXX1`, mismo `TAG_CABLE_INST=620HV5084-T01`:

| TAG | SEÑAL | `BORNE_JB` | `N_PAR_CABLE` |
|---|---|---|---|
| 620-HS-5084 | REM | `1,2,3` | 1 |
| 620-ZSO-5084 | ZIO | `4,5,6` | 2 |
| 620-ZSC-5084 | ZIC | `7,8,9` | 3 |
| 620-HYO-5084 | HYO | `10,11,12,13,14` | 4 |
| 620-HYC-5084 | HYC | `15,16,17,18` | 5 |

**Respuesta definitiva**: los 5 terminales de `HYO` (`10-14`) **no son un bloque compartido ni reservado** — son **exclusivos de esa señal**, y la cantidad (5, frente a 3 de las otras) refleja simplemente que esa señal específica necesita más hilos (probablemente doble contacto/interlock). La evidencia es contundente: los rangos son **contiguos y no se solapan** dentro del mismo instrumento/cable, y crecen 1:1 con `N_PAR_CABLE` (1,2,3,4,5 — orden secuencial de par dentro del mismo cable multiconductor). **No hay ambigüedad física en este caso puntual.**

**Pero** (punto 9, análisis de solapamiento por `TAG_CAJA`): al repetir el mismo análisis entre TODAS las señales que comparten una `TAG_CAJA`, **7 de 8 cajas con datos muestran "solapamiento"** — ej. en `620-TBC-5015`, tanto `620-HV-5104` como `620-HV-5105` (dos instrumentos físicos DISTINTOS) reutilizan exactamente los mismos rangos `1,2,3` / `4,5,6` / `7,8,9` / `10-14` / `15-18`. (15 de las 488 filas usan tags placeholder `XXX` — instrumentos aún no asignados, `ESTADO_REVISION='PENDIENTE'` — excluidos del análisis para no contaminar el resultado; el patrón de reutilización persiste igual con datos 100% reales.)

**Conclusión (resuelve la pregunta más importante del pedido)**: `BORNE_JB` **no es una dirección física global y única dentro de la caja** — es un **índice local/relativo, con ámbito (`TAG_CAJA` + `TAG_CABLE_INST`/instrumento)**, análogo a "conductor N del cable dedicado de ESTE instrumento". Cada instrumento vuelve a numerar desde 1 dentro de su propio grupo de conductores. Esto **no es un problema de calidad de datos** — es la semántica real del campo. La consecuencia de diseño es directa: **`BORNE_JB` nunca puede ser, por sí solo, una clave de negocio para "terminal físico ocupado en esta caja"**; para eso se necesita `(TAG_CAJA, TAG_CABLE_INST, BORNE_JB)` como mínimo, y aun así no corresponde a una dirección física absoluta de regleta (ver 36.4).

### 36.4 `BORNERA_BLOQUE_CAJA` — resuelto (punto 10)

Al ordenar por valor dentro de cada `TAG_CAJA` (ej. `620-TBC-5016`, 41 filas), la secuencia es monótonamente creciente **en el orden de aparición de cada grupo instrumento-señal** (1, 2, 3, 4, 5, 6, 7...) — pero con **irregularidades reales de captura**: se encontraron valores duplicados consecutivos (`5, 5` seguido de `7` — salta el `6`; `17, 17` seguido de `19` — salta el `18`) en `620-TBC-5015`. No hay ninguna fórmula que lo derive de `BORNE_JB` ni de ningún otro campo — es un **índice de enumeración asignado manualmente por el proyectista, en el orden gráfico en que las regletas aparecen en el plano interior de la caja**, confirmando la sospecha previa del diagnóstico (14.x). Es lo más cercano a una "dirección física absoluta de regleta en la caja" que existe en el dataset, pero **no es confiable como clave de negocio estricta** por los saltos/duplicados encontrados — son errores de captura reales, no una regla.

### 36.5 `B_NUM_RESERVA` (punto 12 — analizado, explícitamente NO incluido en 015)

Solo 12/488 filas (2.5%). Valores pequeños (1,2,3,5,7,10) que aparecen siempre junto a un `BORNERA_BLOQUE_CAJA` que es el último (o cercano al último) del grupo de esa caja — consistente con "cantidad de terminales de reserva dejados libres después de este grupo, antes del siguiente instrumento". Es un dato de **dimensionamiento de capacidad de la regleta física**, relacionado con capacidad de caja/bornera (un futuro tema de diseño de caja, no de conexionado señal-por-señal). **Por instrucción explícita del usuario, no se modela en `015`** — queda documentado como insumo para una futura fase de "diseño físico de caja/capacidad de bornera".

### 36.6 `TB_CAJA` (punto 11) y ¿existe un conductor individual? (punto 13)

**`TB_CAJA`**: 100% constante (`"TB"` literal en las 189 filas pobladas). **No amerita persistirse como entidad ni catálogo** — es una convención de nomenclatura sin valor discriminante en la evidencia disponible (un futuro dataset con cajas multi-bloque como `TB1`/`TB2` sí podría requerir usar este campo como identificador real de bloque dentro de la caja — ver 36.9 sobre soportar esa generalización desde el día uno del diseño, sin depender de que el dato actual lo use).

**`nucleo.par_conductor` — ¿alcanza?**: se encontró evidencia real de que **no todos los cables están organizados en pares**. `TIPO_CABLE_INST` incluye tanto cables de pares (`"1-8p#18 AWG+SH"`, `"1-1p#16 AWG+SH"`) como cables de **conductores individuales** (`"1-19c#14 AWG"`, usado exactamente por `620-HV-5084` — el caso de 36.3 — donde `N_PAR_CABLE` toma valores 1-5 sin que exista un "par" físico real: son 5 conductores individuales de un cable de 19 hilos, no 5 pares). Esto significa que `N_PAR_CABLE`, tal como se usa realmente en el Excel, es más un **índice de grupo de conductor(es) dentro del cable** que un número de par en sentido estricto — y que el modelo actual (`par_conductor`, exclusivamente pares) **no representa fielmente un cable de conductores individuales**. **Evaluación (no implementar todavía)**: esto es evidencia real a favor de generalizar `par_conductor` hacia un concepto más amplio (`nucleo.conductor` individual, con `par_conductor` reducido a una agrupación opcional de 2 conductores) — pero antes de decidir la forma exacta hace falta confirmar con el usuario si en la práctica de diseño real siempre se cablea "conductor por conductor" o si el par sigue siendo la unidad manejable incluso en cables tipo "c" (ej. dos hilos adyacentes tratados como un par funcional aunque el cable no venga trenzado en pares de fábrica). **Queda como pregunta abierta**, no resuelta por asunción.

### 36.7 Casos de cableado físico reconstruidos con valores literales (punto 7)

- **AI 2 hilos (transmisor de proceso)** — `620-PIT-5058` (PIT, señal `PI`): `TB=TB-09`, `BORNERA=F1-F2-3-4` (formato anómalo, ver 36.2), `T_MODULO=IN0;RTN0`, `TAG_CAJA=620-TBJ-XXX1`, `BORNE_JB=1,2`, `N_PAR_CABLE=1`, `TAG_CABLE_INST=620PIT5058-X01`, `TIPO_CABLE_INST=1-1p#16 AWG+SH` (par blindado dedicado, instrumento→caja de instrumentación `TBJ`).
- **RTD 3 hilos** — `620-TE-5041A` (TE): `T_MODULO` con 3 partes `IN_0/A;IN_0/A;IN_0/RTD C` — el módulo RTD dedica 3 terminales físicos por canal (dos "A" + un "RTD C"), consistente con el estándar de medición RTD a 3 hilos.
- **DI válvula (finales de carrera / selector)** — `620-HS-5084`/`620-ZSO-5084`/`620-ZSC-5084` (ver tabla 36.3): cada señal discreta de entrada tiene su propio grupo contiguo de 3 terminales dentro del mismo cable multiconductor del instrumento.
- **DO válvula (comando abrir/cerrar)** — `620-HV-XXX3`, señal `HY`: `TB=TB-07`, `BORNERA=F9-10`, `T_MODULO=OUT-4;L1-4` (prefijo `OUT`/`L1` en vez de `IN`/`L2`, confirmando que `T_MODULO` distingue entrada/salida de forma consistente), `TAG_CAJA=620-TBC-XXX1`, `BORNE_JB=1,2,3`.
- **Directo a equipo (sin caja intermedia)** — `620-PPS-5005` (arrancador de motor), señales `RDY`/`REM`/`ESP`/`RUN`/`FAL`: 90 filas del dataset tienen `TAG_EQUIPO_INST` poblado y `TAG_CAJA` vacío, **pero `TB`/`BORNERA`/`T_MODULO` siguen poblados** — confirma que existe cableado real `EQUIPO → GABINETE` de un solo tramo, sin caja intermedia, exactamente como ya lo permite el modelo actual (`0..N` cajas intermedias, hoy 0 en este caso).

### 36.8 Arquitectura del bloque de terminales — Opción 1 vs Opción 2 (punto 3A, resuelto con evidencia)

Recordando la regla de negocio (memoria `siei-terminal-blocks-015`, confirmada de nuevo en el pedido): bloques de terminales existen de forma independiente en CAJA, GABINETE y MÓDULO.

- **Evidencia a favor de un concepto único y reutilizable** (Opción 2, `bloque_terminal → caja/gabinete/modulo` de 3 vías): en el Excel, `TB`/`BORNERA` en `SENALES_CONTROL` conviven exactamente igual sea el destino una `TAG_CAJA` (caja) o un módulo de RIO/gabinete (filas sin `TAG_CAJA`, directo a gabinete/módulo) — la forma del dato (bloque + terminal dentro del bloque) es idéntica en ambos casos, no hay ninguna columna ni convención que distinga "bloque de caja" de "bloque de gabinete" más allá de cuál FK esté poblada. Un `bloque_terminal` con dueño XOR de 3 vías (`caja_id`/`gabinete_id`/`modulo_id`) — mismo patrón ya usado en `punto_conexion` (XOR de 5 vías) y en `gabinete_plano`/`caja_plano` (N:M con FKs compuestas) — evita duplicar la tabla y el CRUD tres veces, y modela naturalmente el caso de "terminal directo a equipo/gabinete sin caja" del punto 36.7.
- **Evidencia a favor de separar módulo del resto** (parte de Opción 1): el terminal de módulo (`T_MODULO`) es un **hecho de fábrica determinístico por `(modelo, canal)`** — no se "crea" ni se numera libremente como sí ocurre con los bloques de caja/gabinete (`TB`, con bloques `TB1`/`TB2`/`X1`/`X2` nombrados libremente por el proyectista). Fusionarlos en la misma tabla sin distinción forzaría a decidir si el terminal de módulo es una fila manual (como los de caja/gabinete) o una fila derivada/generada del catálogo del módulo — son ciclos de vida distintos.

**Recomendación**: **modelo híbrido, más cercano a la Opción 2 pero sin forzar la unificación total**:
- Un `nucleo.bloque_terminal` genérico con dueño XOR de 3 vías (`caja_id`/`gabinete_id`/`modulo_id`) y un `nucleo.terminal` hijo (número/etiqueta dentro del bloque) cubre caja y gabinete de forma idéntica y **también** puede cubrir módulo si en el futuro se necesitan bloques de terminal de módulo nombrados libremente (no todos los módulos tienen terminales fijos de fábrica — algunos usan regletas removibles genéricas).
- Pero para el terminal **específico de canal de módulo** (`T_MODULO`, fijo por catálogo), en vez de forzar una fila manual de `terminal` por cada módulo instalado, se modela como **metadato del catálogo del canal** (ver 36.9) — determinístico, sin captura manual, coexistiendo con el `bloque_terminal`/`terminal` genérico para los casos donde el módulo sí necesite terminales asignables libremente.

Esto responde el punto 3A sin decidir por simplicidad de implementación: la evidencia real (mismo formato `TB`/`BORNERA` en caja y gabinete; naturaleza determinística y de catálogo distinta para el terminal de módulo) es la que separa "terminal asignable libremente" (caja/gabinete, y potencialmente módulo) de "terminal fijo de fábrica por canal" (módulo, caso común).

### 36.9 `T_MODULO`/`BORNERA` como metadato de catálogo, no como dato por instalación

Ambos campos resultaron **determinísticos por `(MODELO, CANAL)`** (0 de 56 combinaciones con más de un valor distinto verificadas para cada uno). Esto tiene una implicación de diseño directa: **no deben capturarse como texto libre por cada instalación real** (como hoy vive implícitamente en `punto_conexion.borne`/`bornera`) — deben derivarse de una tabla de catálogo `(catalogo_modulo_id, numero_canal) → etiqueta`.

Interpretación de la diferencia entre ambos, con la evidencia disponible:
- **`T_MODULO`** = etiqueta impresa por el fabricante en el conector físico del módulo (ej. `IN-0`, `OUT-4`) — **hecho universal del modelo de módulo**, no depende del proyecto.
- **`BORNERA`** = el par de terminal específico en la **regleta de campo del gabinete/RIO** al que se cablea internamente ese canal (ej. `F1-2`) — en este dataset también resultó 100% determinístico por `(MODELO, CANAL)`, pero conceptualmente es una **convención de cableado interno del proyecto** (el ingeniero que diseñó el RIO decidió llevar canal 0 al par F1-2, canal 1 al F3-4, etc., de forma consistente en todo el proyecto) — no necesariamente un hecho universal del fabricante. Con un solo proyecto como evidencia, **no se puede descartar** que otro proyecto use un esquema de cableado interno distinto para el mismo módulo. Se recomienda modelarlo igual que `T_MODULO` (derivado de catálogo) **pero con el catálogo scoped a nivel de proyecto** (o a una "plantilla de cableado de RIO" reutilizable), nunca como un hecho global fijo del `cat.cat_modulo_io` en sí.

### 36.10 `punto_conexion` vs. terminal — ¿evolucionar o extender? (puntos 17, 18)

**Recomendación**: **no** convertir `punto_conexion` en un concepto de terminal. `punto_conexion` sigue representando el extremo lógico/físico de un tramo de la ruta de señal (dueño XOR ya establecido, con tramos que lo conectan en cadena) — cambiar su naturaleza rompería el modelo de rutas ya implementado y probado (`ruta_conexion`/`tramo_conexion`, triggers de secuencia). En su lugar:

- Se agrega una **relación opcional** `punto_conexion.terminal_id` (nueva FK, nullable) que, cuando está poblada, ancla ese punto de conexión a un `nucleo.terminal` concreto (dentro de un `bloque_terminal` de caja/gabinete, o a un terminal de canal de módulo vía catálogo). Los 6 campos de texto libre actuales (`regleta`/`bornera`/`borne`/`lado`/`circuito`/`hilo`) **se mantienen** para retrocompatibilidad y para los casos donde aún no se modele el terminal formalmente (deuda técnica documentada, no forzada a resolverse de una vez).
- Esto cierra el punto 18 (`punto_conexion.modulo_id` no referencia el canal exacto) **sin romper nada existente**: cuando el punto de conexión final de una ruta apunta a un módulo, su `terminal_id` (si está poblado) permite conocer el canal exacto a través de la cadena `terminal → catálogo(modelo, canal) → canal`, sin necesitar una columna `canal_id` directa en `punto_conexion` (que además sería redundante con `terminal_id` una vez que el terminal en sí ya referencia el canal).

### 36.11 Alternativas de arquitectura comparadas (punto 15)

| | A: `punto_conexion` por borne | B: `punto_conexion` + `punto_conexion_borne` hijo | C: `bloque_terminal`/`terminal` independiente + `terminacion` que enlaza conductor↔terminal | D: texto libre (statu quo) |
|---|---|---|---|---|
| Ventajas | Cambio mínimo | Menos cambio que C, ya reutiliza el XOR existente | Modela la jerarquía real (bloque→terminal) igual en caja/gabinete/módulo; permite detectar ocupación/conflicto; base para generar CAD/reportes de conexionado | Cero esfuerzo inmediato |
| Desventajas | `punto_conexion` explota en identidad (un punto por CADA terminal usado, rompiendo su rol de "extremo de tramo") | El terminal queda subordinado a un punto de conexión existente, en vez de existir independientemente (no se puede declarar "terminal libre" sin una ruta) | Mayor superficie nueva (2-3 tablas), requiere backfill/estrategia de convivencia con `punto_conexion` actual | Nunca se puede consultar "qué terminal está ocupado por qué", ni detectar solapamientos — sigue siendo deuda técnica indefinidamente |
| Capacidad de generar CAD/reporte de conexionado | Baja | Media | Alta — es justo lo que la jerarquía real necesita | Nula |
| Detección de conflictos (dos señales al mismo terminal) | No (texto libre igual que hoy) | Parcial | Sí, con `UNIQUE` real sobre `(bloque_terminal_id, numero_terminal)` | No |
| Complejidad de implementación | Baja | Media | Alta | Ninguna |

**Recomendación: Opción C**, extendida con el `terminal_id` opcional en `punto_conexion` de 36.10 (no una tabla `terminacion` separada de tramo/conductor — el vínculo tramo↔terminal ya existe implícitamente vía `punto_conexion` como extremo del tramo; no hace falta una entidad nueva solo para eso). Es la única que responde al principio del punto 16 (consultar ocupación/libres/conflictos) con una clave real, y es la única evidenciada como necesaria por los datos (36.3-36.4 muestran que ni `BORNE_JB` ni `BORNERA_BLOQUE_CAJA` del Excel sirven como clave de negocio confiable — SIEI necesita numerar sus propios terminales, igual que ya hace con IDs internos en vez de TAG).

### 36.12 Jerarquía de bloques de terminal en caja/gabinete/módulo (puntos 19, 20)

`nucleo.bloque_terminal(id, proyecto_id, caja_id NULL, gabinete_id NULL, modulo_id NULL, codigo NVARCHAR(20), descripcion, activo, ...)` con XOR de 3 vías — soporta desde el día uno múltiples bloques nombrados por caja/gabinete (`TB1`, `TB2`, `X1`, `X2`), aunque el Excel actual solo use el nombre constante `"TB"` (36.6) — el `codigo` es libre, no hardcoded a `"TB"`.

`nucleo.terminal(id, proyecto_id, bloque_terminal_id, numero NVARCHAR(20), activo, ...)` — un terminal individual dentro de un bloque, `UNIQUE (bloque_terminal_id, numero) WHERE activo = 1` (mismo patrón de índice filtrado del resto del esquema).

Ejemplo trabajado (punto 20): `gabinete.TB1` (bloque de terminal de campo del RIO) recibe un cable externo en su terminal `F1-2`; **una fila `tramo_conexion` interna** (mismo mecanismo de tramo ya existente, `par_conductor_id` puede ser NULL o un "puente"/jumper interno) conecta ese `punto_conexion` (ancla a `terminal` de `TB1`) con otro `punto_conexion` que ancla al `terminal` de canal del `modulo` correspondiente — el cableado interno gabinete→módulo se modela como **un tramo más**, sin necesitar un concepto nuevo distinto de tramo.

### 36.13 Diseño backend/frontend (solo diseño, puntos 21-22)

**Backend** (rutas nuevas, mismo patrón que `planos.ts`/`gabinetes.ts`, no implementadas):
- `GET /api/projects/:id/cajas/:cajaId/bloques-terminal` y equivalente para gabinete — lista bloques + terminales + ocupación (join contra `punto_conexion.terminal_id`).
- `GET /api/projects/:id/modulos/:moduloId/terminales` — terminales de canal derivados del catálogo `(modelo, canal)`, más cualquier `bloque_terminal` manual asociado al módulo.
- `GET /api/projects/:id/senales/:senalId/conexionado` — recorre `ruta_conexion` → `tramo_conexion` en orden, resolviendo cada `punto_conexion` a su terminal (si tiene) o a su texto libre (si no).
- Reglas de conflicto (`terminal` ocupado por otro `punto_conexion` activo) se validan igual que hoy se valida "canal en uso" — rechazo, nunca sobrescritura silenciosa.

**Frontend** (pantallas futuras, no implementadas): `Caja→Borneras`, `Gabinete→Borneras` (mismo componente reutilizado, XOR ya es el patrón usado en el resto del frontend), `Módulo→Terminales` (solo lectura, derivado de catálogo), `Señal→Conexionado` (vista de solo lectura del recorrido tramo por tramo) — ningún editor gráfico, consistente con el resto de SIEI.

### 36.14 Reconstrucción de `vw_conexionado` sin duplicar datos en `senal` (punto 23)

Una vista futura que reproduzca la forma plana de `MASTER_IO` (señal/gabinete/rack/slot/módulo/canal/TB/BORNERA/T_MODULO/cable/caja/TB_CAJA/BORNE_JB) se construye por `JOIN` puro, navegando exactamente la cadena ya existente: `senal → ruta_conexion → tramo_conexion (ordenado por numero_orden) → punto_conexion → terminal → bloque_terminal → (caja | gabinete | modulo → slot → rack → gabinete)`, más `tramo_conexion.par_conductor_id → cable`. **Ningún campo de esta vista se copia a `senal`** — la vista es 100% derivada en tiempo de consulta, igual que el resto del esquema evita denormalización.

### 36.15 Casos de prueba futuros (diseño only, punto 25)

Creación de bloque/terminal para caja/gabinete/módulo · prevención de terminal duplicado activo en un mismo bloque (`UNIQUE` filtrado) · cable→terminal de caja · cable→terminal de gabinete · cable→terminal de módulo · tramo interno gabinete-terminal→módulo-terminal · rechazo de ocupación incompatible (dos `punto_conexion` activos al mismo `terminal`) · casos válidos de puente/común si existen en el dominio real (no evidenciados aún en el Excel, pendiente de confirmar con el usuario) · aislamiento cross-project (mismo patrón FK compuesta) · soft delete (`activo`) · auditoría (`created_by`/`updated_by`).

### 36.16 Preguntas abiertas — NO resueltas por asunción (punto 27)

1. **`BORNERA` como convención de proyecto vs. hecho universal**: determinístico por `(modelo, canal)` en este único proyecto, pero no hay evidencia de un segundo proyecto para confirmar si esto es siempre así o específico del criterio de cableado de este ingeniero. Afecta si el catálogo de 36.9 debe ser global o scoped por proyecto/plantilla.
2. **Individual conductor vs. par (`N_PAR_CABLE` en cables no-pareados, 36.6)**: ¿se necesita `nucleo.conductor` individual, o el equipo de ingeniería sigue razonando en "pares funcionales" incluso en cables de conductores sueltos? Requiere confirmación humana, no inferible del Excel solo.
3. **Casos de puente/terminal común**: no se encontró evidencia de terminales compartidos legítimamente entre dos señales (todo solapamiento encontrado fue el patrón "reinicio local por instrumento" de 36.3, no un puente real) — queda abierto si existen en la práctica real de este dominio y cómo deben modelarse si sí.
4. **Formato anómalo `"F1-F2-3-4"`** (`620-PIT-5058`, 36.7): dato de captura real, no un patrón — no se sabe si es error de tipeo o un formato legítimo de bornera compuesta; no se resuelve por asunción.
5. **`TB1`/`TB2` multi-bloque**: el diseño (36.12) lo soporta estructuralmente, pero no hay ningún caso real en el Excel que use más de un `TB` por caja — la generalización es prospectiva, no evidenciada todavía.

### 36.17 Estado al cierre de esta fase

Solo diagnóstico y diseño, tal como se pidió. **No existe `015_terminaciones.sql`. No se aplicó SQL. No hay cambios en backend, frontend, tests ni commit.** `001`–`014` permanecen exactamente como están (`98e61bc`). La implementación de `015_terminaciones` requiere, como mínimo, que el usuario resuelva las 5 preguntas abiertas de 36.16 y confirme la recomendación arquitectónica de 36.11 (Opción C extendida) antes de proceder — siguiendo el mismo patrón de aprobación explícita usado en `012`/`013`/`014`.

## 37. Revisión y corrección del diseño de terminaciones (antes de implementar, SOLO REDISEÑO)

Disparado por "FASE 015 — REVISIÓN DEL DISEÑO DE TERMINACIONES ANTES DE IMPLEMENTAR", que **reabre expresamente** la conclusión de 36.10/36.11 (`punto_conexion.terminal_id` sin `terminacion`) por ser insuficiente frente a señales reales multi-conductor. Puerta confirmada: working tree con solo `docs/DIAGNOSTICO_SENALES_GABINETES.md` modificado (sección 36, sin commit), `git log` en `98e61bc`, `015_terminaciones.sql` no existe. Sigue sin haber SQL/backend/frontend/tests/commit — este apartado es la corrección del diseño, no su implementación.

### 37.1 Crítica explícita de la propuesta anterior (36.10)

La propuesta de 36.10 (`punto_conexion.terminal_id` opcional, sin entidad `terminacion`) **queda descartada**, no por preferencia sino por un contraejemplo directo ya presente en la propia evidencia: `620-HYO-5084` necesita **5 conductores** aterrizando en **5 terminales físicos distintos** dentro del mismo extremo lógico de un mismo tramo (la caja `620-TBC-XXX1`). `punto_conexion` es una fila única por extremo de tramo (dueño XOR); `terminal_id` como columna simple solo puede apuntar a **un** terminal. No existe forma de extender esa columna a "N terminales" sin romper la cardinalidad 1:1 de la fila, o sin forzar a crear un `punto_conexion` distinto por cada conductor — lo segundo es exactamente lo que el punto 4 del pedido prohíbe ("no convertir un terminal físico en un punto_conexion", porque multiplicaría artificialmente los puntos de una misma conexión y rompería la semántica ya probada de `ruta_conexion`/`tramo_conexion`). La propuesta anterior era válida únicamente para el caso 1:1 (AI de 2 hilos con un solo par) y fallaba silenciosamente para cualquier señal con más de un conductor por extremo — es decir, fallaba precisamente en el caso que el propio diagnóstico había identificado como el más importante (`HYO`).

### 37.2 Decisión: ¿`TERMINACION` sí o no? → **SÍ, obligatoria**

Justificación (no solo por el contraejemplo de 37.1, sino por lo que la entidad debe representar): una terminación no es "el extremo de una conexión" (eso ya lo es `punto_conexion`) — es **el hecho físico puntual "este conductor, en este tramo, en este extremo, aterriza en este terminal"**. Son conceptos ortogonales: `punto_conexion` vive en el espacio de la ruta lógica de la señal (cuántos tramos, en qué orden, entre qué nodos); `terminacion` vive en el espacio de la implementación física de cada tramo (cuántos hilos lo componen y dónde aterriza cada uno). Mantener `punto_conexion` sin conocimiento de terminales (se elimina por completo cualquier `terminal_id` en `punto_conexion` — no se conserva "por si acaso") evita la duplicación de fuente de verdad que arrastraría tener dos caminos (uno directo vía `punto_conexion.terminal_id` para el caso simple, otro vía `terminacion` para el caso múltiple) que podrían desincronizarse.

### 37.3 Decisión: ¿`CONDUCTOR` individual sí o no? → **SÍ**

Evidencia decisiva: `TIPO_CABLE_INST = "1-19c#14 AWG"` (19 **conductores**, sin estructura de pares) es el cable real usado por `620-HV-5084`, cuyas 5 señales consumen conductores 1 a 5 de ese cable **sin que exista un "par" físico correspondiente** — `N_PAR_CABLE` en este caso no numera pares reales, numera conductores sueltos. Un modelo que solo conozca `par_conductor` no puede representar "el conductor 3 de un cable de 19 hilos individuales" sin fingir una agrupación de a dos que no existe físicamente. `nucleo.conductor` pasa a ser **la unidad física fundamental**; `par_conductor` se conserva como una **agrupación opcional** de exactamente 2 conductores (par trenzado), nunca al revés.

### 37.4 Estrategia de convivencia `CONDUCTOR` ↔ `PAR_CONDUCTOR`

```
nucleo.cable
  └── nucleo.conductor            (unidad física real, 1..N por cable)
         └── par_conductor_id NULL → nucleo.par_conductor   (agrupación opcional de 2 conductores)
```

- `nucleo.par_conductor` **no se modifica de forma destructiva**: mantiene exactamente su forma actual (`id, proyecto_id, cable_id, numero_par`, sin `activo`, registro histórico permanente). Sigue siendo válida y consultable tal cual para todo lo ya creado.
- `nucleo.conductor` es la tabla nueva: cada conductor pertenece a un cable (`cable_id`) y, **opcionalmente**, a un par (`par_conductor_id NULL`). Un cable de conductores individuales (`"19c"`) tiene N filas `conductor` con `par_conductor_id = NULL`; un cable de pares (`"8p"`) tiene 2N filas `conductor`, agrupadas de a 2 bajo cada fila `par_conductor`.
- **Convivencia con los registros existentes**: los `par_conductor` ya creados (fixtures de pruebas, sin datos reales de producción todavía) **permanecen intactos** — no se les asigna retroactivamente `conductor` a menos que se decida un backfill explícito más adelante (fuera de alcance de 015, ver 37.15). El código de aplicación deja de crear nuevas rutas usando solo `par_conductor`/`tramo_conexion.par_conductor_id` (ver 37.5) y empieza a operar sobre `conductor`, pero nada obliga a migrar el historial ya existente.
- Cardinalidad de un par: se recomienda una regla (constraint o trigger, a definir en la implementación) de **como máximo 2** conductores activos por `par_conductor_id` — no se fuerza `= 2` exactamente para no bloquear un estado transitorio "par con un solo conductor cargado todavía".

### 37.5 Decisión: `tramo_conexion.par_conductor_id` → **se retira de uso, no se elimina de golpe**

Un tramo real puede transportar varios conductores simultáneamente (`HYO` = 5). Una columna singular `par_conductor_id` en `tramo_conexion` no puede expresar eso — es la misma limitación de cardinalidad que 37.1 encontró en `punto_conexion.terminal_id`, aplicada ahora al tramo en vez del punto. **Se introduce `nucleo.tramo_conductor` como tabla intermedia** (ver 37.6) que reemplaza esta relación. `tramo_conexion.par_conductor_id` se **deja intacta en su forma actual** (nullable, sin tocar su tipo/FK) por disciplina de no-destrucción sobre `001`–`014`, pero queda **deprecada**: el código de aplicación (rutas backend futuras) deja de escribirla para tramos nuevos creados bajo el modelo de `015`; los tramos existentes que ya la tengan poblada (fixtures de prueba) conservan su valor sin verse afectados. Una futura migración (`016+`, fuera de alcance aquí) podría formalizar su retiro (`DROP COLUMN`) una vez que ningún flujo activo dependa de ella — decisión que no corresponde tomar en este rediseño.

### 37.6 Análisis de necesidad de `TRAMO_CONDUCTOR` → **necesaria**

Sin ella, `terminacion` tendría que referenciar `(tramo_conexion_id, conductor_id)` directamente — funcionalmente posible, pero peor en integridad relacional: permitiría, por error, registrar una terminación para un conductor que nunca fue declarado como parte de ese tramo (nada impediría vincular un conductor de un cable completamente distinto). `tramo_conductor` declara explícitamente **qué conductores participan en qué tramo** como un hecho propio, independiente de si ya tienen terminación en alguno de sus extremos — y le da a `terminacion` una clave natural single-FK (`tramo_conductor_id`) en lugar de una compuesta. Es el mismo patrón que ya usa el esquema para otras relaciones N:M explícitas (`gabinete_plano`, `caja_plano` de la migración 014): declarar la pertenencia como su propia fila, no inferirla.

### 37.7 Modelo final (bloque_terminal · terminal · conductor · tramo_conductor · terminacion)

```
nucleo.cable
  └── nucleo.conductor (cable_id, par_conductor_id NULL)

nucleo.ruta_conexion
  └── nucleo.tramo_conexion (punto_origen_id, punto_destino_id, numero_orden)
         └── nucleo.tramo_conductor (tramo_conexion_id, conductor_id)
                ├── nucleo.terminacion (extremo = ORIGEN, terminal_id)
                └── nucleo.terminacion (extremo = DESTINO, terminal_id)

nucleo.caja / nucleo.gabinete / nucleo.modulo
  └── nucleo.bloque_terminal (caja_id XOR gabinete_id XOR modulo_id, codigo)
         └── nucleo.terminal (bloque_terminal_id, numero)
```

`punto_conexion` no cambia de rol (sigue siendo el extremo lógico del tramo, dueño XOR de 5 vías) y **no** gana un `terminal_id` — el detalle físico de terminales vive exclusivamente en `terminacion`/`terminal`, un nivel más abajo que `punto_conexion`, conectado indirectamente a través de `tramo_conductor`/`tramo_conexion`.

### 37.8 ¿Es necesario `extremo`? → **sí, columna explícita obligatoria**

Un mismo conductor (una fila `tramo_conductor`) tiene físicamente dos puntas: la que aterriza en el nodo de origen del tramo y la que aterriza en el nodo de destino — y son **dos terminales distintos** (ej. conductor 1 del cable `620HV5084-T01`: origen = terminal de la caja `620-TBC-XXX1`, destino = terminal del gabinete). Nada en `tramo_conductor_id` por sí solo indica cuál extremo corresponde a cuál fila de `terminacion` si hay dos filas por conductor — sin un campo `extremo` explícito, dos terminaciones del mismo `tramo_conductor_id` serían indistinguibles salvo por su `terminal_id`, y no habría forma de saber cuál es la de origen y cuál la de destino sin inspeccionar externamente cada `terminal.bloque_terminal_id` y compararlo contra `punto_origen`/`punto_destino` del tramo — una inferencia frágil e indirecta. `extremo NVARCHAR(10) NOT NULL CHECK (extremo IN ('ORIGEN','DESTINO'))` lo hace explícito y consultable en una sola columna, sin depender de un join adicional para saber qué extremo es cuál.

### 37.9 Principio de `bloque_terminal`/`terminal` — confirmado sin cambios respecto a 36.12

Se mantiene el diseño ya aprobado: `bloque_terminal` con dueño XOR de 3 vías (`caja_id`/`gabinete_id`/`modulo_id`), `codigo` como dato real (nunca hardcodeado a `"TB"`), `terminal` hijo con `numero` libre y `UNIQUE(bloque_terminal_id, numero) WHERE activo = 1`. Esto ya soporta, sin cambios adicionales: `cable → terminal de caja`, `cable → terminal de gabinete`, `cable → terminal de módulo`, y `terminal de gabinete → cableado interno (un tramo más, con su propio tramo_conductor/terminacion) → terminal de módulo`.

### 37.10 `BORNERA` project-scoped — solución más simple que no impone una regla falsa global

No se crea ningún catálogo nuevo para `BORNERA`. La política conservadora pedida ("no fijarlo globalmente como verdad universal del fabricante") se cumple de forma directa porque **`BORNERA` nunca fue propuesta como catálogo global** — es simplemente el valor de `terminal.numero` para un terminal cuyo `bloque_terminal.gabinete_id` está poblado (ej. `terminal.numero = 'F1-2'`). Es un dato capturado por proyecto, exactamente igual que cualquier otro `terminal.numero`, sin derivación ni fórmula. Si en el futuro se detecta que varios proyectos repiten la misma convención de forma consistente, ahí sí se justificaría una "plantilla de cableado de RIO" reutilizable (tabla de plantilla + un paso de generación masiva de `terminal` a partir de ella) — pero eso es una optimización de captura de datos, no un requisito de integridad, y **no se diseña en 015** por falta de evidencia multi-proyecto (pregunta abierta 1 de 36.16, ahora resuelta operativamente: se trata como dato de proyecto, sin catálogo).

### 37.11 `T_MODULO` como metadato de catálogo — tabla recomendada

`T_MODULO` sí es un hecho de fábrica (determinístico por modelo+canal, 0 contraejemplos). Se agrega:

```
cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal) → etiqueta_terminal
```

Global (sin `proyecto_id`, mismo criterio que el resto de `cat.*`), `UNIQUE(catalogo_modulo_id, numero_canal)`. Con esto, la etiqueta de fábrica de un canal se deriva vía `canal → modulo.catalogo_modulo_id + canal.numero_canal → cat_modulo_io_terminal.etiqueta_terminal`, sin retipearla por cada módulo instalado.

Para que `terminacion.terminal_id` sea uniforme sin importar si el dueño es caja/gabinete/módulo (evita un tipo de FK especial solo para módulos), se recomienda que un `modulo` real tenga también su propio `bloque_terminal` (con `modulo_id` poblado) y una fila `terminal` por canal — pero el **texto** de esa fila (`terminal.numero`) se **deriva/copia** de `cat_modulo_io_terminal` en el momento de crear el módulo o el canal (no se retipea a mano), en vez de dejarlo como dato manual libre como en caja/gabinete. Esta es una decisión de implementación (cuándo y cómo se generan esas filas) que no se resuelve en este rediseño — solo se confirma que el catálogo de origen (`cat_modulo_io_terminal`) es la pieza que falta y que la forma de `terminal` no necesita bifurcarse por tipo de dueño.

### 37.12 Puentes y terminales comunes — no implementar, no bloquear

Regla por defecto: ocupación doble de un terminal se **rechaza**. Esto se implementa como índice único filtrado sobre `terminacion`: `UNIQUE(terminal_id) WHERE activo = 1` — un terminal activo admite como máximo una terminación activa. Esto **no imposibilita** modelar puentes/jumpers/distribución más adelante: el día que se necesite, basta con relajar esa unicidad condicionalmente (por ejemplo agregando un `tipo_terminacion` o `es_puente BIT` a `terminacion` y excluyendo las filas marcadas como puente del índice filtrado) — un cambio aditivo de una futura migración, no una reestructuración. No se diseña esa funcionalidad ahora porque no hay evidencia real de que exista en el dominio (pregunta abierta 3 de 36.16, sigue abierta).

### 37.13 Formato legacy anómalo (`"F1-F2-3-4"`) — no bloquea la arquitectura

Se trata como dato legacy ambiguo, no como un patrón a soportar en el diseño. La arquitectura de `terminal`/`bloque_terminal` no necesita saber nada sobre cómo se parsea ese texto: cuando exista una futura importación real de este dato, la política será detectar + advertir + no corregir automáticamente (mismo precedente que `codigo_plano` duplicado y `PLANO_CONEX_INTERIOR` en `014_planos`), dejando la fila como pendiente de revisión humana. No afecta ni una sola columna del draft DDL de 37.14.

### 37.14 Draft DDL conceptual (SOLO DRAFT — no se crea ningún archivo)

```sql
-- ============================================================
-- nucleo.conductor — unidad física fundamental de un cable
-- ============================================================
CREATE TABLE nucleo.conductor (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT NOT NULL,
    cable_id          BIGINT NULL,            -- NULL = conductor/jumper interno sin cable formal de proyecto (37.17)
    numero_conductor  INT NOT NULL,
    par_conductor_id  BIGINT NULL,            -- agrupación opcional de a 2 (37.4)
    etiqueta          NVARCHAR(10) NULL,      -- ej. 'A'/'B' dentro de un par, informativo
    activo            BIT NOT NULL CONSTRAINT DF_conductor_activo DEFAULT (1),
    created_at        DATETIME2 NOT NULL CONSTRAINT DF_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2 NULL,
    created_by        BIGINT NULL,
    updated_by        BIGINT NULL,
    CONSTRAINT PK_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_conductor_cable FOREIGN KEY (cable_id, proyecto_id) REFERENCES nucleo.cable (id, proyecto_id),
    CONSTRAINT FK_conductor_par FOREIGN KEY (par_conductor_id, proyecto_id) REFERENCES nucleo.par_conductor (id, proyecto_id),
    CONSTRAINT FK_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
-- único cuando pertenece a un cable real; un jumper sin cable_id no compite por numeración
CREATE UNIQUE INDEX UX_conductor_cable_numero
    ON nucleo.conductor (cable_id, numero_conductor)
    WHERE cable_id IS NOT NULL AND activo = 1;

-- ============================================================
-- nucleo.bloque_terminal — dueño XOR de 3 vías (caja/gabinete/modulo)
-- ============================================================
CREATE TABLE nucleo.bloque_terminal (
    id            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id   BIGINT NOT NULL,
    caja_id       BIGINT NULL,
    gabinete_id   BIGINT NULL,
    modulo_id     BIGINT NULL,
    codigo        NVARCHAR(20) NOT NULL,      -- dato real: 'TB', 'TB1', 'TB2', 'X1'... (13)
    descripcion   NVARCHAR(200) NULL,
    activo        BIT NOT NULL CONSTRAINT DF_bloque_terminal_activo DEFAULT (1),
    created_at    DATETIME2 NOT NULL CONSTRAINT DF_bloque_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2 NULL,
    created_by    BIGINT NULL,
    updated_by    BIGINT NULL,
    CONSTRAINT PK_bloque_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_bloque_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_bloque_terminal_pertenencia_xor CHECK (
        (IIF(caja_id IS NOT NULL,1,0) + IIF(gabinete_id IS NOT NULL,1,0) + IIF(modulo_id IS NOT NULL,1,0)) = 1
    ),
    CONSTRAINT FK_bloque_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_bloque_terminal_caja FOREIGN KEY (caja_id, proyecto_id) REFERENCES nucleo.caja (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_gabinete FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_modulo FOREIGN KEY (modulo_id, proyecto_id) REFERENCES nucleo.modulo (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_bloque_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_bloque_terminal_caja_codigo
    ON nucleo.bloque_terminal (caja_id, codigo) WHERE caja_id IS NOT NULL AND activo = 1;
CREATE UNIQUE INDEX UX_bloque_terminal_gabinete_codigo
    ON nucleo.bloque_terminal (gabinete_id, codigo) WHERE gabinete_id IS NOT NULL AND activo = 1;
CREATE UNIQUE INDEX UX_bloque_terminal_modulo_codigo
    ON nucleo.bloque_terminal (modulo_id, codigo) WHERE modulo_id IS NOT NULL AND activo = 1;

-- ============================================================
-- nucleo.terminal — terminal individual dentro de un bloque
-- ============================================================
CREATE TABLE nucleo.terminal (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT NOT NULL,
    bloque_terminal_id  BIGINT NOT NULL,
    numero              NVARCHAR(20) NOT NULL,   -- 'F1-2', '10', 'IN-0'... texto real, no derivado por fórmula
    activo              BIT NOT NULL CONSTRAINT DF_terminal_activo DEFAULT (1),
    created_at          DATETIME2 NOT NULL CONSTRAINT DF_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2 NULL,
    created_by          BIGINT NULL,
    updated_by          BIGINT NULL,
    CONSTRAINT PK_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminal_bloque FOREIGN KEY (bloque_terminal_id, proyecto_id) REFERENCES nucleo.bloque_terminal (id, proyecto_id),
    CONSTRAINT FK_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_terminal_bloque_numero
    ON nucleo.terminal (bloque_terminal_id, numero) WHERE activo = 1;

-- ============================================================
-- nucleo.tramo_conductor — qué conductores participan en qué tramo (37.6)
-- ============================================================
CREATE TABLE nucleo.tramo_conductor (
    id                 BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id        BIGINT NOT NULL,
    tramo_conexion_id  BIGINT NOT NULL,
    conductor_id       BIGINT NOT NULL,
    activo             BIT NOT NULL CONSTRAINT DF_tramo_conductor_activo DEFAULT (1),
    created_at         DATETIME2 NOT NULL CONSTRAINT DF_tramo_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at         DATETIME2 NULL,
    created_by         BIGINT NULL,
    updated_by         BIGINT NULL,
    CONSTRAINT PK_tramo_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_tramo_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tramo_conductor_tramo FOREIGN KEY (tramo_conexion_id, proyecto_id) REFERENCES nucleo.tramo_conexion (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_conductor FOREIGN KEY (conductor_id, proyecto_id) REFERENCES nucleo.conductor (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tramo_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_tramo_conductor_tramo_conductor
    ON nucleo.tramo_conductor (tramo_conexion_id, conductor_id) WHERE activo = 1;

-- ============================================================
-- nucleo.terminacion — el hecho físico: conductor+tramo+extremo→terminal
-- ============================================================
CREATE TABLE nucleo.terminacion (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id         BIGINT NOT NULL,
    tramo_conductor_id  BIGINT NOT NULL,
    extremo             NVARCHAR(10) NOT NULL,   -- 'ORIGEN' | 'DESTINO' (37.8)
    terminal_id         BIGINT NOT NULL,
    activo              BIT NOT NULL CONSTRAINT DF_terminacion_activo DEFAULT (1),
    created_at          DATETIME2 NOT NULL CONSTRAINT DF_terminacion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2 NULL,
    created_by          BIGINT NULL,
    updated_by          BIGINT NULL,
    CONSTRAINT PK_terminacion PRIMARY KEY (id),
    CONSTRAINT UQ_terminacion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_terminacion_extremo CHECK (extremo IN ('ORIGEN','DESTINO')),
    CONSTRAINT FK_terminacion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminacion_tramo_conductor FOREIGN KEY (tramo_conductor_id, proyecto_id) REFERENCES nucleo.tramo_conductor (id, proyecto_id),
    CONSTRAINT FK_terminacion_terminal FOREIGN KEY (terminal_id, proyecto_id) REFERENCES nucleo.terminal (id, proyecto_id),
    CONSTRAINT FK_terminacion_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminacion_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
-- un conductor, en un tramo, tiene a lo sumo una terminación por extremo
CREATE UNIQUE INDEX UX_terminacion_tramo_conductor_extremo
    ON nucleo.terminacion (tramo_conductor_id, extremo) WHERE activo = 1;
-- ocupación: un terminal activo admite como máximo una terminación activa (37.12; relajable a futuro sin romper esto)
CREATE UNIQUE INDEX UX_terminacion_terminal_ocupacion
    ON nucleo.terminacion (terminal_id) WHERE activo = 1;

-- ============================================================
-- cat.cat_modulo_io_terminal — metadato de fábrica por (modelo, canal) (37.11)
-- ============================================================
CREATE TABLE cat.cat_modulo_io_terminal (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    catalogo_modulo_id  BIGINT NOT NULL,
    numero_canal        INT NOT NULL,
    etiqueta_terminal   NVARCHAR(50) NOT NULL,   -- ej. 'IN-0;L2-0', 'OUT-4;L1-4'
    activo              BIT NOT NULL CONSTRAINT DF_cat_modulo_io_terminal_activo DEFAULT (1),
    created_at          DATETIME2 NOT NULL CONSTRAINT DF_cat_modulo_io_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2 NULL,
    CONSTRAINT PK_cat_modulo_io_terminal PRIMARY KEY (id),
    CONSTRAINT FK_cat_modulo_io_terminal_modulo FOREIGN KEY (catalogo_modulo_id) REFERENCES cat.cat_modulo_io (id)
);
CREATE UNIQUE INDEX UX_cat_modulo_io_terminal_modelo_canal
    ON cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal) WHERE activo = 1;

-- ============================================================
-- Sin cambios de esquema a: punto_conexion (se elimina la idea de agregarle terminal_id — 37.1/37.2),
-- par_conductor (se conserva intacta — 37.4), tramo_conexion (par_conductor_id se deja intacta pero
-- deprecada en código de aplicación — 37.5).
-- ============================================================
```

### 37.15 Casos reales representados sin ambigüedad (demostración pedida, no simplificar por reducir tablas)

**AI 2 hilos** (`620-PIT-5058`, cable `1-1p#16 AWG+SH`): 1 `par_conductor` → 2 `conductor` (par_conductor_id compartido) → 2 `tramo_conductor` (uno por conductor, mismo tramo instrumento→caja) → cada uno con 2 `terminacion` (ORIGEN en un terminal del bloque del instrumento/borne de campo, DESTINO en un terminal de `bloque_terminal` de la caja `620-TBJ-XXX1`). Cero ambigüedad: cada hilo del par tiene su propia fila de principio a fin.

**RTD 3 hilos** (`620-TE-5041A`, `T_MODULO` con 3 partes `IN_0/A;IN_0/A;IN_0/RTD C`): 3 `conductor` del cable de instrumento (sin necesidad de forzarlos en pares — dos son "A" y uno es "RTD C", una terna, no un par), 3 `tramo_conductor` sobre el mismo tramo, 6 `terminacion` (3 ORIGEN en caja, 3 DESTINO en el módulo — cada una apuntando al `terminal` correcto derivado de `cat_modulo_io_terminal` para ese canal). El modelo no necesita "adivinar" que son 3 y no 2: cada conductor real tiene su fila.

**`HYO` 5 hilos** (`620-HYO-5084`, cable `620HV5084-T01`, `BORNE_JB=10,11,12,13,14`): 5 `conductor` (numerados 1-5 dentro del cable de 19 conductores, `par_conductor_id = NULL` — no son pares, ver `"1-19c"` abajo), 5 `tramo_conductor` sobre el tramo instrumento→caja `620-TBC-XXX1`, 5 `terminacion` de ORIGEN (una por cada terminal de la caja, informativamente equivalentes a los `BORNE_JB` legacy `10..14` pero identificados por `terminal.id` real de SIEI, no por el número legacy reiniciable) + 5 `terminacion` de DESTINO si el tramo continúa hacia el gabinete/módulo. Este es exactamente el caso que 37.1 demostró que la propuesta anterior no podía representar, y aquí queda representado sin ambigüedad: 5 filas `tramo_conductor`, 10 filas `terminacion` (5 ORIGEN + 5 DESTINO), cada una con su propio `terminal_id`.

**Cable `1-19c#14 AWG`** (19 conductores individuales, el propio cable de `620-HV-5084`): 19 filas `conductor` con `cable_id` apuntando a este cable y `par_conductor_id = NULL` en todas — nunca se fuerza una agrupación de a 2 donde físicamente no existe.

**Cable `1-1p#18 AWG+SH`** (1 par blindado): 1 fila `par_conductor` + 2 filas `conductor` con `par_conductor_id` apuntando a esa fila — agrupación real, usada donde corresponde.

### 37.16 Impacto sobre lo existente (punto 23) — todo vía migración nueva, `001`–`014` sin tocar

| Tabla/objeto | Impacto |
|---|---|
| `nucleo.punto_conexion` | **Sin cambio de esquema.** Sigue siendo el extremo lógico del tramo; nunca gana `terminal_id` (37.1/37.2). |
| `nucleo.tramo_conexion` | **Sin cambio de esquema.** `par_conductor_id` se deja intacta pero deprecada en código de aplicación (37.5); nuevas rutas la dejan `NULL` y usan `tramo_conductor` en su lugar. |
| `nucleo.par_conductor` | **Sin cambio de esquema, sin dato tocado.** Pasa a ser una agrupación opcional referenciada desde `conductor.par_conductor_id`, no la unidad fundamental. |
| Triggers de ruta (`TR_tramo_conexion_validar_secuencia`, `TR_senal_validar_canal_ruta`, `TR_tramo_conexion_validar_canal_ruta`) | **Sin cambio de lógica.** Siguen validando la secuencia/coherencia de `punto_conexion`/`tramo_conexion` exactamente igual — son ortogonales a `conductor`/`terminacion`, que operan un nivel más abajo. |
| `backend/src/routes/connectionPoints.ts` | Sin cambio de contrato en 015 (los 6 campos de texto libre se mantienen, como deuda técnica reconocida — 36.10). Un futuro endpoint nuevo (`terminaciones.ts`, no creado en este turno) manejaría `conductor`/`tramo_conductor`/`terminacion`/`bloque_terminal`/`terminal`. |
| Frontend / tests existentes | **Sin impacto** — ningún endpoint ni tabla existente cambia de forma. |

### 37.17 Cableado interno de gabinete sin cable formal (punto 17)

Confirmado que el tramo `Gabinete TB1 → conductor/jumper interno → Módulo/canal/terminal` se representa como **un tramo más** (`tramo_conexion` normal, con su `tramo_conductor`/`terminacion` normales) — no se inventa un concepto especial de "jumper". Para no obligar falsamente a que todo tramo tenga un cable externo identificado, `nucleo.conductor.cable_id` se diseña **NULLABLE** (ver DDL 37.14): un conductor interno/jumper puede existir con `cable_id = NULL`, conservando su propia identidad (`conductor.id`) y sus dos `terminacion` (ORIGEN/DESTINO), sin pertenecer a ningún `nucleo.cable` de proyecto. No se crea catálogo de jumpers.

### 37.18 Tests que debería tener `015` (diseño, no se escriben en este turno)

Creación de `bloque_terminal`/`terminal` para caja/gabinete/módulo (incluyendo el XOR) · `UNIQUE` filtrado de `terminal.numero` dentro de un bloque · creación de `conductor` con y sin `par_conductor_id` · creación de `conductor` con `cable_id = NULL` (jumper) · `tramo_conductor` ligando un conductor a un tramo · `terminacion` ORIGEN y DESTINO para el mismo `tramo_conductor` (caso 1 conductor) · caso multi-conductor tipo `HYO` (5 conductores, 10 terminaciones) sin colisión · rechazo de doble ocupación de un mismo `terminal` (`UX_terminacion_terminal_ocupacion`) · rechazo de dos `terminacion` del mismo extremo para el mismo `tramo_conductor` · aislamiento cross-project en las 5 tablas nuevas (mismo patrón FK compuesta) · soft delete (`activo`) en cada tabla · auditoría (`created_by`/`updated_by`) · `cat_modulo_io_terminal` determinístico por `(catalogo_modulo_id, numero_canal)`.

### 37.19 Migración/backfill de fixtures existentes (punto 24)

**No se migran datos automáticamente.** Los `par_conductor` de prueba ya existentes (fixtures de smoke tests) permanecen exactamente como están — no se les crea `conductor` retroactivo en `015`. Cualquier fixture nueva de prueba que se agregue durante la implementación de `015` deberá crear sus propios `conductor`/`tramo_conductor`/`terminacion` desde cero, sin depender de datos previos. Esto es consistente con "no cargar data real" y con el hecho de que ninguna de las tablas nuevas tiene aún una sola fila en ningún ambiente.

### 37.20 Preguntas que realmente siguen abiertas (punto 25)

1. **¿Cuándo/cómo se generan las filas `terminal` de un módulo?** (37.11) — ¿al crear el `modulo`, al crear cada `canal`, o bajo demanda/derivadas sin fila física? No resuelto — impacta si `terminacion.terminal_id` para el lado módulo siempre existe de antemano o debe crearse la primera vez que se usa.
2. **Cardinalidad exacta de `par_conductor`**: ¿debe forzarse `= 2` conductores activos (con un trigger) o basta con "como máximo 2"? (37.4) — no decidido, es un detalle de implementación pendiente de confirmar.
3. **Convención de `numero_conductor`**: ¿secuencial simple 1..N por cable (como se asumió en 37.15), o debe reflejar alguna convención de color/posición física del cable? No hay evidencia Excel que lo exija, pero tampoco se descartó explícitamente.
4. Las 5 preguntas de 36.16 que no dependían de esta revisión (puentes reales, formato `"F1-F2-3-4"`, multi-bloque `TB1`/`TB2` sin evidencia real, `BORNERA` universal vs. proyecto — esta última ahora resuelta operativamente en 37.10) **siguen abiertas** en los mismos términos.

### 37.21 Estado al cierre de esta revisión

Solo rediseño, tal como se pidió. **No existe `015_terminaciones.sql`. No se aplicó SQL. No hay cambios en backend, frontend, tests ni commit. `001`–`014` sin modificar. No se cargó data real.** La decisión que reabre y reemplaza la de 36.10/36.11 es: `punto_conexion.terminal_id` descartado; `terminacion` + `conductor` + `tramo_conductor` confirmados como necesarios, con `extremo` explícito. Pendiente de aprobación del usuario antes de escribir `015_terminaciones.sql`.

## 38. Último ajuste de diseño — `015_terminaciones` (SOLO DISEÑO, cuarta corrección)

Disparado por "ÚLTIMO AJUSTE DE DISEÑO — 015 TERMINACIONES", que aprueba conceptualmente `CONDUCTOR`/`TRAMO_CONDUCTOR`/`TERMINACION`/`BLOQUE_TERMINAL`/`TERMINAL` de la sección 37 pero corrige 4 puntos antes de congelar. Sigue sin existir `015_terminaciones.sql`, sin SQL aplicado, sin backend/frontend/tests/commit, `001`–`014` sin tocar.

### 38.1 Modelo final corregido

```
nucleo.cable
  └── nucleo.conductor (cable_id NULL, par_conductor_id NULL)

nucleo.ruta_conexion
  └── nucleo.tramo_conexion
         └── nucleo.tramo_conductor (tramo_conexion_id, conductor_id)
                ├── nucleo.terminacion (extremo = ORIGEN)  → posicion_terminal_id
                └── nucleo.terminacion (extremo = DESTINO) → posicion_terminal_id
                       └── nucleo.posicion_terminal (terminal_id, codigo)
                              └── nucleo.terminal (bloque_terminal_id, numero, catalogo_modulo_io_terminal_id NULL)
                                     └── nucleo.bloque_terminal (caja_id XOR gabinete_id XOR modulo_id, codigo)

cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal) → etiqueta_terminal   [1:N por canal]
```

Cambio central respecto a la sección 37: se inserta `posicion_terminal` entre `terminal` y `terminacion`. La ocupación exclusiva se mueve de `terminal` a `posicion_terminal` — un mismo `terminal` físico admite legítimamente 2+ aterrizajes simultáneos (campo + interno) siempre que sean posiciones/clamps distintos del mismo terminal.

### 38.2-38.3 Tablas y columnas definitivas de `015`

**`nucleo.conductor`** (sin cambio respecto a 37.14): `id, proyecto_id, cable_id NULL, numero_conductor, par_conductor_id NULL, etiqueta NULL, activo, created_at, updated_at, created_by, updated_by`.

**`nucleo.bloque_terminal`** (sin cambio respecto a 37.14): `id, proyecto_id, caja_id NULL, gabinete_id NULL, modulo_id NULL, codigo, descripcion NULL, activo, auditoría` — XOR de 3 vías.

**`nucleo.terminal`** (ajustada — agrega la FK de materialización de catálogo, punto 3 del pedido):
`id, proyecto_id, bloque_terminal_id, numero NVARCHAR(20), catalogo_modulo_io_terminal_id NULL, activo, auditoría`.
`catalogo_modulo_io_terminal_id` es la solución elegida (evaluada y confirmada, no la alternativa de una FK distinta por tipo de dueño): permite que **toda** `terminacion` llegue a un `terminal` por el mismo camino (`posicion_terminal → terminal`) sin importar si el dueño es caja, gabinete o módulo — para caja/gabinete queda `NULL` (dato manual); para módulo, cuando el terminal se materializa desde catálogo, queda poblada y trazable a la etiqueta de fábrica de origen.

**`nucleo.posicion_terminal`** (nueva — punto 1 del pedido):
`id, proyecto_id, terminal_id, codigo NVARCHAR(10), activo, auditoría`. `codigo` es texto libre (no se asume A/B universalmente) — para un terminal con un solo punto de aterrizaje se crea una única fila (ej. `codigo='A'` o `'1'`, a elección de quien la capture, sin significado especial); para un terminal de doble clamp físico (campo + interno) se crean 2 filas.

Nombre elegido: **`posicion_terminal`** (patrón "cabeza-calificador" ya usado en el repo: `par_conductor`, `bloque_terminal`, `tramo_conexion` — el sustantivo nuevo va primero, el que ya existe va después). Se descartan `terminal_posicion` (invierte el orden que usa el resto del esquema) y `punto_terminal` (`punto_conexion` ya usa "punto" para el extremo de ruta lógica; reutilizar la palabra para un concepto físico distinto generaría confusión terminológica).

**`nucleo.tramo_conductor`** (sin cambio respecto a 37.14): `id, proyecto_id, tramo_conexion_id, conductor_id, activo, auditoría`.

**`nucleo.terminacion`** (corregida — punto 2 del pedido, sin columnas redundantes):
`id, proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo NVARCHAR(10), activo, auditoría`. Se eliminan `tramo_conexion_id`/`conductor_id` (ya inferibles vía `tramo_conductor_id`) y se reemplaza `terminal_id` por `posicion_terminal_id`.

**`cat.cat_modulo_io_terminal`** (corregida a 1:N — punto 3 del pedido):
`id, catalogo_modulo_id, numero_canal, orden_terminal INT NOT NULL, etiqueta_terminal NVARCHAR(50), activo, created_at, updated_at`. `orden_terminal` es lo que permite representar el caso RTD real (canal 0 → 3 filas: `orden=1 'IN_0/A'`, `orden=2 'IN_0/A'`, `orden=3 'IN_0/RTD C'` — dos etiquetas iguales son válidas, `orden_terminal` las distingue).

### 38.4 FKs (todas compuestas `(hijo_id, proyecto_id) → (padre_id, proyecto_id)`, salvo `cat.*` que no lleva `proyecto_id`)

- `conductor.cable_id` → `cable(id, proyecto_id)`, nullable.
- `conductor.par_conductor_id` → `par_conductor(id, proyecto_id)`, nullable.
- `bloque_terminal.caja_id/gabinete_id/modulo_id` → `caja/gabinete/modulo(id, proyecto_id)`, cada una nullable (XOR).
- `terminal.bloque_terminal_id` → `bloque_terminal(id, proyecto_id)`, NOT NULL.
- `terminal.catalogo_modulo_io_terminal_id` → `cat.cat_modulo_io_terminal(id)`, nullable, **sin `proyecto_id`** (tabla `cat` global).
- `posicion_terminal.terminal_id` → `terminal(id, proyecto_id)`, NOT NULL.
- `tramo_conductor.tramo_conexion_id` → `tramo_conexion(id, proyecto_id)`, NOT NULL.
- `tramo_conductor.conductor_id` → `conductor(id, proyecto_id)`, NOT NULL.
- `terminacion.tramo_conductor_id` → `tramo_conductor(id, proyecto_id)`, NOT NULL.
- `terminacion.posicion_terminal_id` → `posicion_terminal(id, proyecto_id)`, NOT NULL.
- `cat_modulo_io_terminal.catalogo_modulo_id` → `cat.cat_modulo_io(id)`.
- Todas las tablas `nucleo.*` nuevas llevan además `FK_*_created_by`/`FK_*_updated_by` → `seguridad.usuario(id)` y `FK_*_proyecto` → `nucleo.proyecto(id)`, y su propio `UNIQUE(id, proyecto_id)` para soportar las FKs compuestas de sus hijos — mismo patrón que el resto del esquema.

### 38.5 UNIQUE/índices (punto 8 del pedido, uno a uno)

| Constraint pedida | Implementación exacta |
|---|---|
| `UNIQUE bloque_terminal + codigo terminal` | `UX_terminal_bloque_numero (bloque_terminal_id, numero) WHERE activo = 1` |
| `UNIQUE terminal + codigo posicion` | `UX_posicion_terminal_terminal_codigo (terminal_id, codigo) WHERE activo = 1` |
| `UNIQUE tramo_conexion + conductor` | `UX_tramo_conductor_tramo_conductor (tramo_conexion_id, conductor_id) WHERE activo = 1` |
| `UNIQUE tramo_conductor + extremo en terminacion` | `UX_terminacion_tramo_conductor_extremo (tramo_conductor_id, extremo) WHERE activo = 1` |
| `UNIQUE posicion_terminal ocupada` | `UX_terminacion_posicion_ocupacion (posicion_terminal_id) WHERE activo = 1` — **reemplaza** la `UX_terminacion_terminal_ocupacion` de 37.14, que queda retirada del diseño |

Adicionales no pedidas explícitamente pero necesarias por consistencia:
- `UX_bloque_terminal_caja_codigo` / `_gabinete_codigo` / `_modulo_codigo` (sin cambio respecto a 37.14).
- `UX_cat_modulo_io_terminal_modelo_canal_orden (catalogo_modulo_id, numero_canal, orden_terminal) WHERE activo = 1` — reemplaza la versión 2-columnas de 37.14.
- `UX_terminal_bloque_catalogo (bloque_terminal_id, catalogo_modulo_io_terminal_id) WHERE catalogo_modulo_io_terminal_id IS NOT NULL AND activo = 1` — evita materializar dos veces el mismo terminal de catálogo dentro del mismo bloque de módulo (punto 7 del apartado 38.6).

### 38.6 Modelo terminal de módulo: catálogo → instancia (punto 3 del pedido)

`cat.cat_modulo_io_terminal` es la **definición de fábrica** (1:N por canal, global, sin `proyecto_id`). Un módulo real instalado en un proyecto necesita filas físicas propias porque `terminacion` debe llegar a él por el mismo camino uniforme que caja/gabinete (`posicion_terminal → terminal → bloque_terminal`) — no una FK alternativa solo para módulos.

**Materialización** (momento no resuelto aún, ver 38.14): cuando corresponda materializar un módulo, para cada fila de `cat_modulo_io_terminal` de su `catalogo_modulo_id` se crea:
1. Un `bloque_terminal` con `modulo_id` poblado (uno por módulo, `codigo` fijo tipo `'MODULO'` o el nombre del módulo — dato real igual que cualquier `bloque_terminal.codigo`).
2. Un `terminal` hijo con `numero = etiqueta_terminal` (copiado del catálogo) y `catalogo_modulo_io_terminal_id` apuntando a la fila de origen.
3. Al menos un `posicion_terminal` (normalmente 1, salvo evidencia de que un terminal de módulo también necesite doble clamp — no evidenciado, se deja abierto).

Esto resuelve el requisito explícito: **ninguna arquitectura donde caja/gabinete referencien `nucleo.terminal` pero módulo necesite una FK distinta** — `terminacion.posicion_terminal_id` es siempre el mismo tipo de columna sin importar el dueño final.

### 38.7 Ejemplo `HYO` (5 conductores) con el modelo corregido

Cable `620HV5084-T01` (`"1-19c#14 AWG"`, sin pares) → 5 `conductor` (`par_conductor_id = NULL`) → 5 `tramo_conductor` sobre el tramo instrumento→caja → por cada uno, 1 `terminacion` de ORIGEN (posición del lado instrumento) y, si el tramo continúa, 1 de DESTINO — cada `terminacion.posicion_terminal_id` apunta a una `posicion_terminal` distinta, cada una hija de un `terminal` distinto de la caja `620-TBC-XXX1` (5 terminales físicos separados, informativamente equivalentes a `BORNE_JB=10..14` pero con identidad real de SIEI). Sin cambio de fondo respecto a 37.15 — el ajuste de `posicion_terminal` no afecta este caso porque cada conductor sigue usando un terminal y una posición distintos, no comparte ninguno.

### 38.8 Ejemplo AI 2 hilos con el modelo corregido

`620-PIT-5058`, cable `1-1p#16 AWG+SH`: 1 `par_conductor` → 2 `conductor` → 2 `tramo_conductor` → 4 `terminacion` (2 ORIGEN + 2 DESTINO), cada una a su propia `posicion_terminal` (una por hilo del par, cada una hija de un `terminal` distinto de la caja `620-TBJ-XXX1`). El campo legacy `BORNERA=F1-F2-3-4` (anómalo, 37.13) permanece sin parsear — los 2 terminales reales del par se capturan individualmente (`terminal.numero='F1'`, `terminal.numero='F2'`, por ejemplo) sin depender de ese texto.

### 38.9 Ejemplo RTD 3 hilos con el modelo corregido

`620-TE-5041A`, `T_MODULO` de 3 partes: en el lado del módulo, `cat_modulo_io_terminal` tiene 3 filas para `(catalogo_modulo_id, numero_canal=0)`: `orden=1 'IN_0/A'`, `orden=2 'IN_0/A'`, `orden=3 'IN_0/RTD C'` — al materializar el módulo, esas 3 filas de catálogo generan 3 `terminal` reales (cada uno con su propia `posicion_terminal`). Del lado de la caja, 3 `conductor` (cable de instrumento) → 3 `tramo_conductor` → 3 `terminacion` DESTINO, una por cada `posicion_terminal` de los 3 terminales de módulo materializados. Nunca se fuerza a 2 conductores donde físicamente hay 3.

### 38.10 Ejemplo gabinete `TB1` → módulo (punto 7 del pedido, doble aterrizaje del mismo terminal)

```
TRAMO A (cable de campo, instrumento → gabinete)
  conductor 1 → tramo_conductor A1
    terminacion ORIGEN → posición terminal del lado instrumento/caja
    terminacion DESTINO → posicion_terminal "A" del terminal "15" del bloque_terminal TB1 (gabinete)

TRAMO B (conductor interno / jumper, gabinete → módulo — cable_id NULL, ver 37.17)
  conductor interno → tramo_conductor B1
    terminacion ORIGEN  → posicion_terminal "B" del MISMO terminal "15" del bloque_terminal TB1
    terminacion DESTINO → posicion_terminal del terminal "IN-2" del bloque_terminal del módulo (materializado desde catálogo)
```

El `terminal` con `numero='15'` tiene **2 filas `posicion_terminal`** (`codigo='A'`, `codigo='B'`), cada una con **su propia** `terminacion` activa — `UX_terminacion_posicion_ocupacion` no se viola porque la unicidad es por `posicion_terminal_id`, no por `terminal_id`: el mismo terminal físico legítimamente sostiene 2 aterrizajes simultáneos (campo + interno) sin que el modelo lo interprete como doble ocupación.

### 38.11 Impacto sobre estructuras existentes (sin cambios respecto a 37.16, reconfirmado)

`punto_conexion`, `tramo_conexion` (salvo `par_conductor_id` deprecada, no tocada de esquema) y `par_conductor` **sin cambios de esquema ni de datos**. Los triggers de ruta no se tocan. Todo lo nuevo (`conductor`, `bloque_terminal`, `terminal`, `posicion_terminal`, `tramo_conductor`, `terminacion`, `cat.cat_modulo_io_terminal`) vive en una migración `015` propia, aditiva, sin ningún `ALTER`/`DROP` sobre `001`–`014`.

### 38.12 `par_conductor` — sin constraint de cardinalidad (punto 5 del pedido)

Se retira la recomendación de 37.4 de "como máximo 2 conductores activos por par". Motivo: existen configuraciones de cable tipo triad (`Tr`) en los datos que no encajan en "par" ni tienen aún un concepto general de agrupación (`grupo_conductor`) diseñado. Para `015`: `conductor.par_conductor_id` sigue siendo nullable, **sin ningún CHECK/trigger de cardinalidad** — queda como agrupación opcional libre, sin reglas de conteo, hasta que una fase futura diseñe `grupo_conductor` de forma general (triads incluidos) si se confirma que hace falta. `par_conductor` en sí **no se toca** (ni esquema ni datos).

### 38.13 `BORNERA` — terminales guardados individualmente (punto 4 del pedido)

Se descarta la afirmación `BORNERA = terminal.numero` como regla general. Cada borne físico se guarda como su propio `terminal` (ej. `F1-2` → `terminal.numero='F1'` + `terminal.numero='F2'`, dos filas hermanas del mismo `bloque_terminal`). La reconstrucción de la presentación legacy (`"F1-2"`) es un problema de lectura/agrupación (ej. por rango numérico o por adyacencia de creación), no de almacenamiento — no se agrega ninguna columna de agrupación en `015` (ni falta: agregar un `terminal.grupo_legacy_bornera NVARCHAR(20) NULL` más adelante sería un cambio aditivo trivial si la reconstrucción de lectura resulta insuficiente, pero no se justifica todavía). El formato `"F1-F2-3-4"` sigue **sin parsear automáticamente** — se documenta como dato ambiguo para detectar+advertir en una futura importación, igual que en 37.13.

### 38.14 Draft DDL final actualizado (SOLO DRAFT — no se crea ningún archivo)

```sql
-- nucleo.conductor — sin cambios respecto a 37.14 (cable_id NULL, par_conductor_id NULL, SIN constraint de cardinalidad de par)
CREATE TABLE nucleo.conductor (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT NOT NULL,
    cable_id          BIGINT NULL,
    numero_conductor  INT NOT NULL,
    par_conductor_id  BIGINT NULL,
    etiqueta          NVARCHAR(10) NULL,
    activo            BIT NOT NULL CONSTRAINT DF_conductor_activo DEFAULT (1),
    created_at        DATETIME2 NOT NULL CONSTRAINT DF_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2 NULL,
    created_by        BIGINT NULL,
    updated_by        BIGINT NULL,
    CONSTRAINT PK_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_conductor_cable FOREIGN KEY (cable_id, proyecto_id) REFERENCES nucleo.cable (id, proyecto_id),
    CONSTRAINT FK_conductor_par FOREIGN KEY (par_conductor_id, proyecto_id) REFERENCES nucleo.par_conductor (id, proyecto_id),
    CONSTRAINT FK_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_conductor_cable_numero
    ON nucleo.conductor (cable_id, numero_conductor) WHERE cable_id IS NOT NULL AND activo = 1;

-- nucleo.bloque_terminal — sin cambios respecto a 37.14
CREATE TABLE nucleo.bloque_terminal (
    id            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id   BIGINT NOT NULL,
    caja_id       BIGINT NULL,
    gabinete_id   BIGINT NULL,
    modulo_id     BIGINT NULL,
    codigo        NVARCHAR(20) NOT NULL,
    descripcion   NVARCHAR(200) NULL,
    activo        BIT NOT NULL CONSTRAINT DF_bloque_terminal_activo DEFAULT (1),
    created_at    DATETIME2 NOT NULL CONSTRAINT DF_bloque_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2 NULL,
    created_by    BIGINT NULL,
    updated_by    BIGINT NULL,
    CONSTRAINT PK_bloque_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_bloque_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_bloque_terminal_pertenencia_xor CHECK (
        (IIF(caja_id IS NOT NULL,1,0) + IIF(gabinete_id IS NOT NULL,1,0) + IIF(modulo_id IS NOT NULL,1,0)) = 1
    ),
    CONSTRAINT FK_bloque_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_bloque_terminal_caja FOREIGN KEY (caja_id, proyecto_id) REFERENCES nucleo.caja (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_gabinete FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_modulo FOREIGN KEY (modulo_id, proyecto_id) REFERENCES nucleo.modulo (id, proyecto_id),
    CONSTRAINT FK_bloque_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_bloque_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_bloque_terminal_caja_codigo ON nucleo.bloque_terminal (caja_id, codigo) WHERE caja_id IS NOT NULL AND activo = 1;
CREATE UNIQUE INDEX UX_bloque_terminal_gabinete_codigo ON nucleo.bloque_terminal (gabinete_id, codigo) WHERE gabinete_id IS NOT NULL AND activo = 1;
CREATE UNIQUE INDEX UX_bloque_terminal_modulo_codigo ON nucleo.bloque_terminal (modulo_id, codigo) WHERE modulo_id IS NOT NULL AND activo = 1;

-- cat.cat_modulo_io_terminal — 1:N por canal (orden_terminal)
CREATE TABLE cat.cat_modulo_io_terminal (
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    catalogo_modulo_id  BIGINT NOT NULL,
    numero_canal        INT NOT NULL,
    orden_terminal      INT NOT NULL,
    etiqueta_terminal   NVARCHAR(50) NOT NULL,
    activo              BIT NOT NULL CONSTRAINT DF_cat_modulo_io_terminal_activo DEFAULT (1),
    created_at          DATETIME2 NOT NULL CONSTRAINT DF_cat_modulo_io_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2 NULL,
    CONSTRAINT PK_cat_modulo_io_terminal PRIMARY KEY (id),
    CONSTRAINT FK_cat_modulo_io_terminal_modulo FOREIGN KEY (catalogo_modulo_id) REFERENCES cat.cat_modulo_io (id)
);
CREATE UNIQUE INDEX UX_cat_modulo_io_terminal_modelo_canal_orden
    ON cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal) WHERE activo = 1;

-- nucleo.terminal — agrega catalogo_modulo_io_terminal_id NULL
CREATE TABLE nucleo.terminal (
    id                            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id                   BIGINT NOT NULL,
    bloque_terminal_id            BIGINT NOT NULL,
    numero                        NVARCHAR(20) NOT NULL,
    catalogo_modulo_io_terminal_id BIGINT NULL,
    activo                        BIT NOT NULL CONSTRAINT DF_terminal_activo DEFAULT (1),
    created_at                    DATETIME2 NOT NULL CONSTRAINT DF_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at                    DATETIME2 NULL,
    created_by                    BIGINT NULL,
    updated_by                    BIGINT NULL,
    CONSTRAINT PK_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminal_bloque FOREIGN KEY (bloque_terminal_id, proyecto_id) REFERENCES nucleo.bloque_terminal (id, proyecto_id),
    CONSTRAINT FK_terminal_catalogo FOREIGN KEY (catalogo_modulo_io_terminal_id) REFERENCES cat.cat_modulo_io_terminal (id),
    CONSTRAINT FK_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_terminal_bloque_numero ON nucleo.terminal (bloque_terminal_id, numero) WHERE activo = 1;
CREATE UNIQUE INDEX UX_terminal_bloque_catalogo ON nucleo.terminal (bloque_terminal_id, catalogo_modulo_io_terminal_id)
    WHERE catalogo_modulo_io_terminal_id IS NOT NULL AND activo = 1;

-- nucleo.posicion_terminal — NUEVA
CREATE TABLE nucleo.posicion_terminal (
    id            BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id   BIGINT NOT NULL,
    terminal_id   BIGINT NOT NULL,
    codigo        NVARCHAR(10) NOT NULL,
    activo        BIT NOT NULL CONSTRAINT DF_posicion_terminal_activo DEFAULT (1),
    created_at    DATETIME2 NOT NULL CONSTRAINT DF_posicion_terminal_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2 NULL,
    created_by    BIGINT NULL,
    updated_by    BIGINT NULL,
    CONSTRAINT PK_posicion_terminal PRIMARY KEY (id),
    CONSTRAINT UQ_posicion_terminal_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_posicion_terminal_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_posicion_terminal_terminal FOREIGN KEY (terminal_id, proyecto_id) REFERENCES nucleo.terminal (id, proyecto_id),
    CONSTRAINT FK_posicion_terminal_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_posicion_terminal_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_posicion_terminal_terminal_codigo ON nucleo.posicion_terminal (terminal_id, codigo) WHERE activo = 1;

-- nucleo.tramo_conductor — sin cambios respecto a 37.14
CREATE TABLE nucleo.tramo_conductor (
    id                 BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id        BIGINT NOT NULL,
    tramo_conexion_id  BIGINT NOT NULL,
    conductor_id       BIGINT NOT NULL,
    activo             BIT NOT NULL CONSTRAINT DF_tramo_conductor_activo DEFAULT (1),
    created_at         DATETIME2 NOT NULL CONSTRAINT DF_tramo_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at         DATETIME2 NULL,
    created_by         BIGINT NULL,
    updated_by         BIGINT NULL,
    CONSTRAINT PK_tramo_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_tramo_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_tramo_conductor_tramo FOREIGN KEY (tramo_conexion_id, proyecto_id) REFERENCES nucleo.tramo_conexion (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_conductor FOREIGN KEY (conductor_id, proyecto_id) REFERENCES nucleo.conductor (id, proyecto_id),
    CONSTRAINT FK_tramo_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tramo_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_tramo_conductor_tramo_conductor ON nucleo.tramo_conductor (tramo_conexion_id, conductor_id) WHERE activo = 1;

-- nucleo.terminacion — corregida: sin columnas redundantes, apunta a posicion_terminal
CREATE TABLE nucleo.terminacion (
    id                    BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id           BIGINT NOT NULL,
    tramo_conductor_id    BIGINT NOT NULL,
    posicion_terminal_id  BIGINT NOT NULL,
    extremo               NVARCHAR(10) NOT NULL,
    activo                BIT NOT NULL CONSTRAINT DF_terminacion_activo DEFAULT (1),
    created_at            DATETIME2 NOT NULL CONSTRAINT DF_terminacion_created_at DEFAULT SYSUTCDATETIME(),
    updated_at            DATETIME2 NULL,
    created_by            BIGINT NULL,
    updated_by            BIGINT NULL,
    CONSTRAINT PK_terminacion PRIMARY KEY (id),
    CONSTRAINT UQ_terminacion_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT CK_terminacion_extremo CHECK (extremo IN ('ORIGEN','DESTINO')),
    CONSTRAINT FK_terminacion_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_terminacion_tramo_conductor FOREIGN KEY (tramo_conductor_id, proyecto_id) REFERENCES nucleo.tramo_conductor (id, proyecto_id),
    CONSTRAINT FK_terminacion_posicion FOREIGN KEY (posicion_terminal_id, proyecto_id) REFERENCES nucleo.posicion_terminal (id, proyecto_id),
    CONSTRAINT FK_terminacion_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_terminacion_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_terminacion_tramo_conductor_extremo ON nucleo.terminacion (tramo_conductor_id, extremo) WHERE activo = 1;
CREATE UNIQUE INDEX UX_terminacion_posicion_ocupacion ON nucleo.terminacion (posicion_terminal_id) WHERE activo = 1;

-- Sin cambios a: punto_conexion, tramo_conexion (par_conductor_id deprecada, no tocada), par_conductor (sin constraint de cardinalidad).
```

### 38.15 Preguntas realmente bloqueantes (punto 14 del pedido)

1. **Momento de materialización de `terminal` de módulo** (38.6): ¿al crear el `modulo`, al crear cada `canal`, o bajo demanda? Bloqueante para el backend de `015` (no para el esquema, que ya lo soporta sin importar la respuesta).
2. **¿Todo terminal de módulo necesita 2 `posicion_terminal` o basta 1 por defecto?** No hay evidencia de doble clamp en el lado módulo (solo se confirmó en gabinete, caso 38.10) — se asume 1 salvo evidencia contraria, pero no está confirmado.
3. Las preguntas de 37.20 que no dependían de este ajuste siguen abiertas en los mismos términos: convención de `numero_conductor`, puentes/terminal común más allá del caso ya resuelto de doble-clamp, formato `"F1-F2-3-4"`, multi-bloque `TB1`/`TB2` sin evidencia real, `BORNERA` universal vs. proyecto (resuelta operativamente en 37.10, no bloqueante).

### 38.16 Estado al cierre de este ajuste

Solo diseño. **No existe `015_terminaciones.sql`. No se aplicó SQL. No hay cambios en backend, frontend, tests ni commit. `001`–`014` sin modificar. No se cargó data real.** El modelo queda: `conductor` (sin constraint de par) → `tramo_conductor` → `terminacion` (solo `tramo_conductor_id` + `posicion_terminal_id` + `extremo`) → `posicion_terminal` → `terminal` (con `catalogo_modulo_io_terminal_id` opcional) → `bloque_terminal`. Pendiente de aprobación final antes de escribir `015_terminaciones.sql`.

## 39. Corrección final del draft — incompatibilidad real con el esquema congelado (SOLO DISEÑO)

Disparado por "FASE 015 — CORRECCIÓN FINAL DEL DRAFT ANTES DE IMPLEMENTAR". El usuario encontró y reportó una incompatibilidad bloqueante entre la sección 38 y el esquema realmente aplicado, **verificada con evidencia de código en este apartado antes de aceptarla** (no se acepta por autoridad, se confirma con `grep`/lectura directa de `001_initial_schema.sql`). Sigue sin existir `015_terminaciones.sql`, sin SQL aplicado, sin backend/frontend/tests/commit, `001`–`014` sin tocar.

### 39.1 Confirmación de la incompatibilidad (punto 1 del pedido)

Verificado línea por línea en `database/migrations/001_initial_schema.sql`:
- Línea 599: `par_conductor_id BIGINT NOT NULL` en la definición de `nucleo.tramo_conexion`.
- Línea 740-742: `CREATE UNIQUE INDEX UX_tramo_conexion_par_conductor_id ON nucleo.tramo_conexion (par_conductor_id) WHERE activo = 1` — **sin** filtro `IS NOT NULL` (no hacía falta mientras la columna era `NOT NULL`).
- Línea 1018 (`TR_tramo_conexion_validar_secuencia`, recreado en `012_gabinetes.sql` línea 303 con el mismo cuerpo salvo `rio_id`→`gabinete_id`): la tabla variable `@activos` declara **su propia columna** `par_conductor_id BIGINT NOT NULL` — si esta columna recibiera un `NULL` al poblarse desde `nucleo.tramo_conexion`, el `INSERT INTO @activos` fallaría de inmediato, **para cualquier tramo activo de la ruta afectada**, no solo para el nuevo — porque el trigger repuebla `@activos` con todos los tramos activos de las rutas tocadas, no solo la fila insertada.
- Línea 1075: dentro del mismo trigger, `JOIN nucleo.par_conductor pc ON pc.id = a.par_conductor_id` (para el chequeo "Punto 4": cable activo) — un `INNER JOIN`, así que un tramo sin `par_conductor_id` simplemente desaparecería de ese chequeo específico si la columna fuera nullable sin ajustar el trigger.
- Línea 1471-1472 (`TR_cable_validar_desactivacion`): `JOIN nucleo.par_conductor pc ON pc.cable_id = i.id JOIN nucleo.tramo_conexion t ON t.par_conductor_id = pc.id AND t.activo = 1` — la única forma en que hoy se detecta "este cable está en uso por un tramo activo".
- Confirmado además (`grep`) que **ningún otro trigger** de `001_initial_schema.sql` referencia `tramo_conexion.par_conductor_id` — `TR_senal_validar_canal_ruta` y `TR_tramo_conexion_validar_canal_ruta` no la tocan.

**Conclusión**: la afirmación de la sección 38 ("`tramo_conexion` sin cambios de esquema, `par_conductor_id` simplemente deprecada") es **incorrecta** y queda retirada. Un cable `"19c"` nuevo, sin par real, no podría crear ningún `tramo_conexion` bajo el modelo nuevo sin inventar un `par_conductor` ficticio — exactamente el problema que el usuario identificó. `015` **no es 100% aditiva**: además de las tablas nuevas, requiere un `ALTER` real sobre `nucleo.tramo_conexion` y la recreación de exactamente 2 triggers existentes. `001`–`014` no se tocan como archivos — el cambio vive íntegramente en `015_terminaciones.sql`, igual que migraciones anteriores ya alteraron columnas de tablas creadas en `001` (`011` sobre `revision_entregable_fila.instrumento_id`, `013` sobre `senal.tag_senal`).

### 39.2 Cambio exacto a `tramo_conexion.par_conductor_id` (punto 2)

```sql
ALTER TABLE nucleo.tramo_conexion ALTER COLUMN par_conductor_id BIGINT NULL;
```

La FK existente (`FK_tramo_conexion_par_conductor`) no requiere cambio — una FK de SQL Server ya tolera valores `NULL` en la columna referenciante sin verificarlos contra la tabla padre. Los datos legacy (fixtures de smoke tests con `par_conductor_id` poblado) permanecen intactos. Política explícita: **legacy** = `par_conductor_id` puede seguir poblado (comportamiento histórico sin cambios); **modelo nuevo** = `par_conductor_id = NULL` y los conductores viven exclusivamente en `tramo_conductor`.

### 39.3 Índice legacy corregido (punto 3)

```sql
DROP INDEX UX_tramo_conexion_par_conductor_id ON nucleo.tramo_conexion;
GO
CREATE UNIQUE INDEX UX_tramo_conexion_par_conductor_id
    ON nucleo.tramo_conexion (par_conductor_id)
    WHERE par_conductor_id IS NOT NULL AND activo = 1;
GO
```

Necesario porque un índice único de SQL Server (a diferencia de una `UNIQUE CONSTRAINT` ANSI estándar) trata múltiples `NULL` como valores en conflicto si no se filtra explícitamente — sin `IS NOT NULL`, un segundo tramo nuevo con `par_conductor_id = NULL` violaría el índice apenas existiera el primero. Mismo patrón ya usado en `011`/`013` (`UX_senal_proyecto_tag`, `revision_entregable_fila` sobre `instrumento_id`).

### 39.4 Triggers existentes afectados — exactamente 2, ninguno más (punto 3/4 del pedido)

**`TR_tramo_conexion_validar_secuencia`** (recreado, `DROP`+`CREATE` como ya hicieron `009`/`012` sobre otros triggers): dos cambios puntuales, resto del cuerpo idéntico.
1. `@activos.par_conductor_id` pasa de `BIGINT NOT NULL` a `BIGINT NULL`.
2. El bloque "Punto 4" (chequeo de recursos activos) cambia sus `JOIN` a `nucleo.par_conductor`/`nucleo.cable` de `INNER` a `LEFT`, y la condición pasa de `... OR cb.activo = 0` a `... OR (pc.id IS NOT NULL AND cb.activo = 0)` — así un tramo del modelo nuevo (`par_conductor_id NULL`) sigue validando que sus `punto_conexion` estén activos (chequeo que no depende de `par_conductor_id`), simplemente no evalúa el sub-chequeo de "cable activo" por esa vía legacy. La validación equivalente para el modelo nuevo (¿el/los `cable` de los `conductor` de ese tramo siguen activos?) se cubre aparte, extendiendo `TR_cable_validar_desactivacion` (ver abajo) — no hace falta duplicarla aquí.

```sql
    DECLARE @activos TABLE (
        tramo_id            BIGINT PRIMARY KEY,
        ruta_conexion_id    BIGINT   NOT NULL,
        numero_orden        SMALLINT NOT NULL,
        punto_origen_id     BIGINT   NOT NULL,
        punto_destino_id    BIGINT   NOT NULL,
        par_conductor_id    BIGINT   NULL,          -- <-- antes NOT NULL
        rn                  BIGINT   NOT NULL,
        total               INT      NOT NULL,
        siguiente_origen    BIGINT   NULL
    );
    ...
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion po ON po.id = a.punto_origen_id
        JOIN nucleo.punto_conexion pd ON pd.id = a.punto_destino_id
        LEFT JOIN nucleo.par_conductor pc ON pc.id = a.par_conductor_id   -- <-- antes INNER
        LEFT JOIN nucleo.cable cb ON cb.id = pc.cable_id                  -- <-- antes INNER
        WHERE po.activo = 0 OR pd.activo = 0 OR (pc.id IS NOT NULL AND cb.activo = 0)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51015, 'Un tramo activo no puede usar puntos de conexion o cable inactivos.', 1;
    END
```

**`TR_cable_validar_desactivacion`** (recreado): se **extiende** (no solo se adapta) con una segunda condición `OR EXISTS` cubriendo el camino nuevo — un cable puede estar "en uso" tanto por un `par_conductor` legacy referenciado desde `tramo_conexion.par_conductor_id` como por un `conductor` propio referenciado desde `tramo_conductor.conductor_id`:

```sql
CREATE TRIGGER nucleo.TR_cable_validar_desactivacion ON nucleo.cable
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(activo) RETURN;

    IF EXISTS (
        SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
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
        THROW 51021, 'No se puede desactivar un CABLE en uso (legacy o nuevo modelo).', 1;
    END
END
GO
```

Ningún otro trigger de `001`/`012` necesita tocarse — confirmado por búsqueda exhaustiva (39.1).

**Nota de secuenciación explícita** (pedida en el punto 3 del mensaje): `tramo_conexion` puede seguir creándose sola, sin exigir que ya existan sus `tramo_conductor` en el mismo `INSERT` — la integridad de "todo conductor del tramo pertenece a este tramo y está activo" se valida en `tramo_conductor`/`terminacion` (triggers nuevos, 39.5/39.9), no en `TR_tramo_conexion_validar_secuencia`. Esto respeta el ciclo padre-primero-hijos-después ya usado en el resto del esquema.

### 39.5 Diseño definitivo `CONDUCTOR` (punto 5/6)

`cable_id BIGINT NOT NULL` (corrige 38.14: ya no nullable). Esto reabre la pregunta de cómo representar un jumper interno gabinete→módulo sin cable formal (37.17) — **resuelto sin romper "no inventar catálogo de jumpers"**: un jumper interno sigue usando una fila real de `nucleo.cable` (no una fila de catálogo — `cable` nunca fue un catálogo, es una entidad de proyecto con `tipo_cable` de texto libre) con, por ejemplo, `tipo_cable = 'JUMPER INTERNO'` o similar texto libre. No se necesita `cable_id NULL` ni ninguna tabla nueva — se reutiliza `nucleo.cable` tal cual, con datos que documenten que es interno. Este punto no fue mencionado explícitamente en el pedido, se deja registrado aquí para que quede explícita la reconciliación entre ambas decisiones.

`codigo NVARCHAR(20) NOT NULL` — identidad visible dentro del cable (`'1'`, `'2'`, `'BK'`, `'WH'`, `'+'`, `'-'`), reemplaza `numero_conductor INT`. `orden SMALLINT NULL` — puramente para ordenamiento de presentación, sin significado de identidad. `UNIQUE(cable_id, codigo) WHERE activo = 1`.

### 39.6 Constraints CONDUCTOR ↔ PAR ↔ CABLE (punto 5)

Se agrega, de forma aditiva, una clave candidata sobre `par_conductor` (tabla de `001`, no se toca su archivo — el `ALTER` vive en `015`):

```sql
ALTER TABLE nucleo.par_conductor
    ADD CONSTRAINT UQ_par_conductor_id_cable_proyecto UNIQUE (id, cable_id, proyecto_id);
```

Y la FK de `conductor` hacia `par_conductor` se define sobre las 3 columnas (reemplaza la FK 2-columnas de 38.14):

```sql
CONSTRAINT FK_conductor_par_mismo_cable
    FOREIGN KEY (par_conductor_id, cable_id, proyecto_id)
    REFERENCES nucleo.par_conductor (id, cable_id, proyecto_id)
```

Cuando `par_conductor_id IS NULL`, SQL Server no evalúa esta FK (semántica `MATCH SIMPLE`: si cualquier columna del FK es `NULL`, la fila no se valida contra la tabla padre) — sin restricción para conductores sin par. Cuando `par_conductor_id IS NOT NULL`, `cable_id` es siempre `NOT NULL` (39.5) y la FK exige que exista una fila `par_conductor` con exactamente ese `(id, cable_id, proyecto_id)` — es decir, **la base de datos rechaza** un `conductor` cuyo `par_conductor_id` apunte a un par de un cable distinto al suyo propio, sin depender del backend.

### 39.7 Diseño definitivo `TRAMO_CONDUCTOR` (punto 7) y exclusividad de conductor (punto 8)

Estructura sin cambio respecto a 38.14 (`tramo_conexion_id`, `conductor_id`). Cambia el índice de unicidad:

**¿Son necesarios ambos `UNIQUE(tramo_conexion_id, conductor_id)` y `UNIQUE(conductor_id)`?** No — matemáticamente, `UNIQUE(conductor_id) WHERE activo = 1` es **estrictamente más fuerte** e implica la otra: si un `conductor_id` admite como máximo una fila activa en toda la tabla, automáticamente admite como máximo una fila activa para cualquier `tramo_conexion_id` particular. Se **reemplaza** `UX_tramo_conductor_tramo_conductor` (38.14) por una sola:

```sql
CREATE UNIQUE INDEX UX_tramo_conductor_conductor_exclusivo
    ON nucleo.tramo_conductor (conductor_id) WHERE activo = 1;
```

Esto es exactamente la regla de negocio pedida ("un CONDUCTOR físico → máximo un tramo_conductor activo", igual que el legacy `UX_tramo_conexion_par_conductor_id` protegía el PAR) y simplifica el diseño (un índice menos) sin perder nada.

### 39.8 Diseño definitivo `TERMINACION` (punto 9)

Sin cambios de columnas respecto a 38.14 (`tramo_conductor_id`, `posicion_terminal_id`, `extremo`, `activo`, auditoría). Los cambios de esta fase son de **triggers nuevos** que la validan (39.9/39.10), no de su forma.

### 39.9 Validación extremo ↔ punto_conexion (punto 10) y canal ↔ terminal de módulo (punto 11)

Ambas se implementan en un único trigger nuevo `AFTER INSERT, UPDATE ON nucleo.terminacion` (mismo criterio que agrupa varios `IF EXISTS` en un solo trigger ya usado por `TR_tramo_conexion_validar_secuencia`):

```sql
CREATE TRIGGER nucleo.TR_terminacion_validar_propietario_y_canal ON nucleo.terminacion
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- (a) el propietario del bloque_terminal debe coincidir con el propietario
    --     real del punto_conexion del extremo correspondiente del tramo.
    IF EXISTS (
        SELECT 1
        FROM inserted te
        JOIN nucleo.tramo_conductor tcd ON tcd.id = te.tramo_conductor_id
        JOIN nucleo.tramo_conexion tc   ON tc.id = tcd.tramo_conexion_id
        JOIN nucleo.punto_conexion pto  ON pto.id = CASE te.extremo WHEN 'ORIGEN' THEN tc.punto_origen_id ELSE tc.punto_destino_id END
        JOIN nucleo.posicion_terminal pos ON pos.id = te.posicion_terminal_id
        JOIN nucleo.terminal ter        ON ter.id = pos.terminal_id
        JOIN nucleo.bloque_terminal bt  ON bt.id = ter.bloque_terminal_id
        WHERE te.activo = 1
          AND (
                (pto.caja_id       IS NOT NULL AND ISNULL(bt.caja_id, -1)     <> pto.caja_id)
             OR (pto.gabinete_id   IS NOT NULL AND ISNULL(bt.gabinete_id, -1) <> pto.gabinete_id)
             OR (pto.modulo_id     IS NOT NULL AND ISNULL(bt.modulo_id, -1)   <> pto.modulo_id)
             OR (pto.instrumento_id IS NOT NULL)   -- 39.11: sin bloque_terminal de instrumento en 015
             OR (pto.equipo_id      IS NOT NULL)   -- idem equipo
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51030, 'La terminacion no pertenece al mismo propietario que el punto_conexion del extremo del tramo.', 1;
    END

    -- (b) si el terminal es de modulo y viene de catalogo, el numero_canal del
    --     catalogo debe coincidir con el canal real de la senal de esa ruta.
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
        THROW 51031, 'La terminacion en un terminal de modulo no corresponde al canal real de la senal.', 1;
    END
END
GO
```

### 39.10 Alcance explícito: terminaciones en instrumento/equipo quedan fuera de `015` (aclaración de 39.9-a)

`bloque_terminal` solo tiene dueño XOR de 3 vías (caja/gabinete/modulo) — no incluye instrumento ni equipo (ningún hallazgo del diagnóstico evidenció necesidad de modelar el bloque de terminales propio de un instrumento). Por lo tanto el chequeo (a) de 39.9 **rechaza cualquier intento** de crear una `terminacion` cuyo extremo corresponda a un `punto_conexion` de tipo instrumento/equipo — en la práctica, el extremo instrumento-side de un tramo instrumento→caja simplemente **no tiene fila `terminacion`** en `015` (el conductor existe vía `tramo_conductor`, pero su aterrizaje físico del lado del instrumento no se modela todavía). Se documenta como límite de alcance explícito, no como omisión — coherente con "dejar como pregunta abierta lo que no está evidenciado" del resto del diagnóstico.

### 39.11 Materialización de terminales de módulo (punto 12 — decisión cerrada: trigger, simétrico a `TR_modulo_generar_canales`)

Se diseña `TR_modulo_generar_terminales AFTER INSERT, UPDATE ON nucleo.modulo`, mismo idioma que `TR_modulo_generar_canales` (línea 804 de `001_initial_schema.sql`): `IF NOT UPDATE(catalogo_modulo_id) RETURN` como filtro barato; opera solo sobre módulos nuevos o cuyo `catalogo_modulo_id` cambió de valor real (mismo patrón `LEFT JOIN deleted ... WHERE d.id IS NULL OR d.catalogo_modulo_id <> i.catalogo_modulo_id`).

Para cada módulo afectado:
1. **Idempotencia** — asegura que exista exactamente un `bloque_terminal` con `modulo_id = <este módulo>` (crear solo si `NOT EXISTS`; nunca duplicar).
2. Para cada fila de `cat.cat_modulo_io_terminal` cuyo `catalogo_modulo_id` sea el nuevo catálogo del módulo, asegura que exista un `terminal` hijo de ese `bloque_terminal` con `catalogo_modulo_io_terminal_id` apuntando a esa fila (`numero` copiado de `etiqueta_terminal`) — crear solo si `NOT EXISTS` (usa `UX_terminal_bloque_catalogo`, 38.5, como guardia natural). Cada `terminal` recién creado recibe **1** `posicion_terminal` por defecto (punto 13, decisión cerrada, sin doble clamp del lado módulo salvo evidencia futura).
3. **Bloqueo, no regeneración silenciosa, cuando el catálogo cambia** (`UPDATE` con `catalogo_modulo_id` distinto): antes de desactivar los `terminal` que ya no correspondan al nuevo catálogo, verifica si alguno tiene una `posicion_terminal` con una `terminacion` activa (`EXISTS` vía join `terminal→posicion_terminal→terminacion WHERE activo=1`). Si la hay, `ROLLBACK TRANSACTION` + `THROW` (mismo criterio que el bloqueo de `TR_modulo_generar_canales` cuando hay `senal` activa en un canal que quedaría fuera de rango, línea 854-865) — **nunca** destruye/regenera un terminal ocupado. Si no hay ocupación, desactiva (`activo = 0`) los `terminal`/`posicion_terminal` obsoletos y crea los nuevos del catálogo entrante — nunca reactiva una fila histórica (mismo criterio "FIX #3" que ya usa `TR_modulo_generar_canales` con los canales).

No se necesita backend transaccional adicional para la materialización en sí (el trigger la cubre igual que ya cubre canales) — el backend solo necesita, al crear/editar un `modulo`, dejar que el trigger actúe (no debe intentar crear `bloque_terminal`/`terminal` manualmente para el caso derivado de catálogo).

### 39.12 Política de posiciones de terminal de módulo (punto 13 — decisión cerrada)

Confirmado: 1 `posicion_terminal` por terminal de módulo por defecto, sin asumir universalmente A/B. Caja y gabinete siguen permitiendo `1..N` posiciones libres (dato manual, sin generación automática — solo módulo se materializa desde catálogo).

### 39.13 Catálogo de terminales de módulo — agrupación en `bloque_terminal` (punto 11 del pedido original, cerrado aquí)

No se inventa un "código de bloque de fabricante" — no hay evidencia de que exista. El `bloque_terminal` de un módulo usa un `codigo` neutro y constante por convención de aplicación (ej. `'MODULO'`), ya que para un módulo no existen múltiples bloques nombrados distintos como sí ocurre en caja/gabinete (`TB1`/`TB2`/`X1`) — un módulo tiene un único bloque de terminales propio, todos sus `terminal` cuelgan de él. Esto no requiere ninguna columna ni catálogo nuevo — es una decisión de valor de datos, no de esquema.

### 39.14 Soft delete / cascada lógica (punto 12 del pedido de esta fase, punto 12 original)

**Cascada hacia abajo** (mismo principio ya documentado del repo: "la desactivación cascada hacia abajo, nunca hacia arriba"):
- `tramo_conexion.activo` 1→0 (transición real) ⇒ nuevo trigger `TR_tramo_conexion_desactivar_conductores` cascada `tramo_conductor.activo → 0` para sus hijos activos.
- `tramo_conductor.activo` 1→0 (incluida la cascada anterior) ⇒ nuevo trigger `TR_tramo_conductor_desactivar_terminaciones` cascada `terminacion.activo → 0` para sus hijas activas.
Mismo patrón exacto que `TR_ruta_conexion_desactivar_tramos` (línea 1116 de `001`).

**Recursos en uso no se desactivan** (mismo principio: "canal, módulo, punto_conexion y cable en uso se rechazan, nunca se desasignan silenciosamente"), extendido a las 4 entidades nuevas de tipo recurso:
- `conductor`: rechazar desactivación si tiene un `tramo_conductor` activo (`UX_tramo_conductor_conductor_exclusivo` ya lo hace único, pero la desactivación del propio `conductor` necesita su propio trigger de rechazo, ej. `TR_conductor_validar_desactivacion`).
- `posicion_terminal`: rechazar si tiene una `terminacion` activa (`TR_posicion_terminal_validar_desactivacion`).
- `terminal`: rechazar si alguna de sus `posicion_terminal` está ocupada (tiene `terminacion` activa) — no solo si el `terminal` mismo tiene hijos activos, sino transitivamente ocupados (`TR_terminal_validar_desactivacion`).
- `bloque_terminal`: rechazar si alguno de sus `terminal` tiene una posición ocupada (`TR_bloque_terminal_validar_desactivacion`).

Los 4 siguen el mismo idioma exacto que `TR_punto_conexion_validar_desactivacion`/`TR_cable_validar_desactivacion` (`AFTER UPDATE`, `IF NOT UPDATE(activo) RETURN`, comparar `inserted`/`deleted` para detectar la transición real 1→0, `ROLLBACK`+`THROW` si está en uso).

### 39.15 Draft DDL final corregido — solo los deltas respecto a 38.14 (SOLO DRAFT)

```sql
-- conductor: cable_id ahora NOT NULL, codigo reemplaza numero_conductor, agrega orden
CREATE TABLE nucleo.conductor (
    id                BIGINT IDENTITY(1,1) NOT NULL,
    proyecto_id       BIGINT NOT NULL,
    cable_id          BIGINT NOT NULL,                 -- <-- antes NULL
    codigo            NVARCHAR(20) NOT NULL,            -- <-- antes numero_conductor INT
    orden             SMALLINT NULL,                    -- <-- nuevo, solo presentación
    par_conductor_id  BIGINT NULL,
    activo            BIT NOT NULL CONSTRAINT DF_conductor_activo DEFAULT (1),
    created_at        DATETIME2 NOT NULL CONSTRAINT DF_conductor_created_at DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2 NULL,
    created_by        BIGINT NULL,
    updated_by        BIGINT NULL,
    CONSTRAINT PK_conductor PRIMARY KEY (id),
    CONSTRAINT UQ_conductor_id_proyecto UNIQUE (id, proyecto_id),
    CONSTRAINT FK_conductor_proyecto FOREIGN KEY (proyecto_id) REFERENCES nucleo.proyecto (id),
    CONSTRAINT FK_conductor_cable FOREIGN KEY (cable_id, proyecto_id) REFERENCES nucleo.cable (id, proyecto_id),
    CONSTRAINT FK_conductor_par_mismo_cable FOREIGN KEY (par_conductor_id, cable_id, proyecto_id)
        REFERENCES nucleo.par_conductor (id, cable_id, proyecto_id),   -- <-- antes 2 columnas
    CONSTRAINT FK_conductor_created_by FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_conductor_updated_by FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id)
);
CREATE UNIQUE INDEX UX_conductor_cable_codigo ON nucleo.conductor (cable_id, codigo) WHERE activo = 1;

-- tramo_conductor: sin cambio de columnas, cambia el índice
CREATE UNIQUE INDEX UX_tramo_conductor_conductor_exclusivo
    ON nucleo.tramo_conductor (conductor_id) WHERE activo = 1;   -- <-- reemplaza UX_tramo_conductor_tramo_conductor

-- ALTER aditivo sobre par_conductor (tabla de 001, no se toca su archivo)
ALTER TABLE nucleo.par_conductor
    ADD CONSTRAINT UQ_par_conductor_id_cable_proyecto UNIQUE (id, cable_id, proyecto_id);

-- ALTER sobre tramo_conexion (tabla de 001) + índice reemplazado
ALTER TABLE nucleo.tramo_conexion ALTER COLUMN par_conductor_id BIGINT NULL;
DROP INDEX UX_tramo_conexion_par_conductor_id ON nucleo.tramo_conexion;
CREATE UNIQUE INDEX UX_tramo_conexion_par_conductor_id
    ON nucleo.tramo_conexion (par_conductor_id) WHERE par_conductor_id IS NOT NULL AND activo = 1;

-- terminacion, posicion_terminal, terminal, bloque_terminal, cat.cat_modulo_io_terminal: sin cambios respecto a 38.14
-- (ver esa sección para su DDL completo; los deltas de esta fase son índices/triggers, no columnas)

-- Triggers recreados: TR_tramo_conexion_validar_secuencia, TR_cable_validar_desactivacion (39.4)
-- Triggers nuevos: TR_terminacion_validar_propietario_y_canal (39.9),
--                  TR_modulo_generar_terminales (39.11),
--                  TR_tramo_conexion_desactivar_conductores, TR_tramo_conductor_desactivar_terminaciones (39.14, cascada),
--                  TR_conductor_validar_desactivacion, TR_posicion_terminal_validar_desactivacion,
--                  TR_terminal_validar_desactivacion, TR_bloque_terminal_validar_desactivacion (39.14, bloqueo por uso)
```

### 39.16 Tests adicionales que nacen de estos cambios (punto 16)

Además de los ya listados en 37.18: migración legacy→nuevo conviviendo (un tramo con `par_conductor_id` poblado y otro con `NULL` en la misma tabla, ambos pasando `TR_tramo_conexion_validar_secuencia`) · rechazo de `conductor.par_conductor_id` apuntando a un par de otro cable (`FK_conductor_par_mismo_cable`) · rechazo de reutilizar el mismo `conductor` en dos `tramo_conductor` activos de tramos distintos · rechazo de `TR_cable_validar_desactivacion` por el camino nuevo (conductor en tramo activo) y por el legacy, ambos cubiertos · rechazo de `terminacion` cuyo `posicion_terminal` pertenece a una caja distinta de `punto_conexion.caja_id` (39.9-a) · rechazo de `terminacion` en terminal de módulo cuyo canal de catálogo no coincide con `senal.canal_id` (39.9-b) · rechazo de `terminacion` en extremo instrumento/equipo (39.10) · `TR_modulo_generar_terminales` idempotente (ejecutar dos veces, sin duplicados) · `TR_modulo_generar_terminales` bloqueando cambio de catálogo con terminal ocupado · cascada `tramo_conexion→tramo_conductor→terminacion` al desactivar · bloqueo de desactivación de `conductor`/`posicion_terminal`/`terminal`/`bloque_terminal` en uso.

### 39.17 Preguntas que sigan siendo realmente bloqueantes (punto 17)

Con esta corrección, las dos preguntas que 38.15 marcaba como bloqueantes para backend **quedan cerradas** (materialización = trigger simétrico a canales, posiciones de módulo = 1 por defecto). Sigue abierto, sin bloquear el `DDL`:
1. Convención exacta de `conductor.codigo` para conductores del modelo nuevo sin dato legacy que lo sugiera (¿siempre secuencial `'1'`,`'2'`... salvo que el usuario capture un color/signo real?) — dato de captura, no de esquema.
2. Las preguntas ya heredadas de 37.20/38.15 que no dependían de esta corrección: formato `"F1-F2-3-4"`, multi-bloque `TB1`/`TB2` sin evidencia real, puentes/terminal común más allá del caso de doble-clamp ya resuelto.

### 39.18 Estado al cierre de esta corrección

Solo diseño. **No existe `015_terminaciones.sql`. No se aplicó SQL. No hay cambios en backend, frontend, tests ni commit. `001`–`014` sin modificar (como archivos) — el `ALTER`/recreación de triggers vive en el futuro `015_terminaciones.sql`, no en los archivos congelados. No se cargó data real.** El diseño de `015` queda: **no 100% aditivo** — crea 6 tablas nuevas (`conductor`, `bloque_terminal`, `terminal`, `posicion_terminal`, `tramo_conductor`, `terminacion`) + `cat.cat_modulo_io_terminal`, altera `tramo_conexion.par_conductor_id` a `NULL` y su índice, agrega una `UNIQUE` aditiva a `par_conductor`, recrea 2 triggers existentes y agrega ~8 triggers nuevos. Pendiente de aprobación final antes de escribir `015_terminaciones.sql`.

## 40. Implementación de `015_terminaciones` (CIERRE — migración aplicada)

Disparado por "IMPLEMENTACIÓN — `015_terminaciones` El diseño de `015_terminaciones` queda APROBADO." Este apartado documenta lo que realmente se construyó, marca como **superado** cualquier punto del draft (secciones 37-39) donde la implementación final difiere, y deja el estado de cierre. **Sección de referencia para entender el estado real del esquema — las secciones 36-39 documentan el proceso de diseño que llevó hasta aquí y siguen siendo válidas como historial, pero donde haya discrepancia, esta sección 40 manda.**

### 40.1 Corrección encontrada durante la implementación (no estaba en el draft 38/39)

El draft de la sección 39 (punto 17, "soft delete") diseñó los triggers `TR_bloque_terminal_validar_desactivacion`/`TR_terminal_validar_desactivacion` **solo como bloqueo** ("si existe ocupación → bloquear"), sin la mitad de cascada ("si no existe ocupación → desactivar lógicamente descendientes") que el propio pedido de implementación pedía explícitamente para esta pareja. Se detectó al ejecutar `terminaciones.api.test.ts`: desactivar un `bloque_terminal` sin ocupación dejaba sus `terminal`/`posicion_terminal` **activos** por debajo — exactamente el estado "padre inactivo, hijo activo" que el propio diseño prohíbe en el mismo párrafo para `tramo_conexion`/`tramo_conductor`/`terminacion`.

**Corregido antes de cerrar la fase**: `TR_terminal_validar_desactivacion` y `TR_bloque_terminal_validar_desactivacion` ahora combinan, en el mismo trigger, las dos mitades de la política — bloquean si hay ocupación (sin cambio), y si no la hay, cascadean (`UPDATE` sobre la tabla hija dentro del mismo cuerpo del trigger). La cascada de 2 saltos (`bloque_terminal → terminal → posicion_terminal`) se logra por disparo anidado de triggers (habilitado por defecto en SQL Server, mismo mecanismo ya documentado para `senal → ruta_conexion → tramo_conexion`), no por una tabla `@variable` compartida entre triggers. `TR_posicion_terminal_validar_desactivacion` y `TR_conductor_validar_desactivacion` se mantienen bloqueo-puro sin cambios (son hojas, sin hijos que cascadear).

Verificado en vivo contra SIEI_DEV: se recrearon ambos triggers, se limpió el residuo huérfano que había dejado la version anterior (terminales/posiciones activos bajo un bloque ya inactivo), y se confirmó con una consulta directa que tras el fix, desactivar un bloque sin ocupación cascada correctamente hasta sus posiciones.

### 40.2 Resultado final — tablas, triggers y procedimiento

Sin cambios respecto al draft de la sección 39.14/39.15 salvo el punto 40.1: `cat.cat_modulo_io_terminal`, `nucleo.conductor`, `nucleo.bloque_terminal`, `nucleo.terminal`, `nucleo.posicion_terminal`, `nucleo.tramo_conductor`, `nucleo.terminacion`; `ALTER TABLE nucleo.tramo_conexion ALTER COLUMN par_conductor_id BIGINT NULL` + índice reemplazado; `ALTER TABLE nucleo.par_conductor ADD CONSTRAINT UQ_par_conductor_id_cable_proyecto`; 2 triggers recreados (`TR_tramo_conexion_validar_secuencia`, `TR_cable_validar_desactivacion`); 9 triggers nuevos (`TR_terminal_validar_catalogo_modulo`, `TR_terminacion_validar_propietario_y_canal`, `TR_modulo_generar_terminales`, `TR_tramo_conexion_desactivar_conductores`, `TR_tramo_conductor_desactivar_terminaciones`, `TR_conductor_validar_desactivacion`, `TR_posicion_terminal_validar_desactivacion`, `TR_terminal_validar_desactivacion`, `TR_bloque_terminal_validar_desactivacion`); 1 procedimiento nuevo (`nucleo.sp_sincronizar_terminales_modulo`).

### 40.3 Backend y frontend implementados

Backend: `backend/src/routes/conductors.ts`, `backend/src/routes/bloquesTerminal.ts`, `backend/src/routes/tramoConductores.ts` (nuevos); `modules.ts` (+`GET .../terminales`, `+POST .../sync-terminales`), `moduleTypes.ts` (+`GET`/`POST .../terminals`), `connectionRoutes.ts` (`parConductorId` opcional en `POST /routes`, +`GET /routes/:id/conexionado`) modificados; montados en `server.ts`. Frontend: `components/BornerasSection.tsx` (nuevo, usado por `BoxDetailPage`/`GabineteDetailPage`), `ModuloTerminalesView` (nuevo, dentro de `GabineteDetailPage`), sección "Conexionado detallado" en `RouteDetailPage`; `api/terminaciones.ts` (nuevo) + tipos nuevos en `api/types.ts`.

**Hallazgo de implementación no anticipado en el draft**: toda inserción/actualización con `OUTPUT INSERTED.*` sin `INTO` contra una de las 6 tablas nuevas falla con el error 334 de SQL Server ("no puede tener triggers habilitados si el statement usa OUTPUT sin INTO") — las 6 tablas nuevas tienen al menos un trigger `AFTER INSERT` o `AFTER UPDATE`. Se corrigió sistemáticamente en `conductors.ts`/`bloquesTerminal.ts`/`tramoConductores.ts` usando el patrón ya establecido en el resto del repo (`DECLARE @tabla; ...OUTPUT...INTO @tabla; SELECT * FROM @tabla;`). Detectado por la suite de pruebas de API, no por inspección — confirma el valor de tener esa suite.

### 40.4 Verificación

`database/tests/027_smoke_terminaciones.sql` (34 casos) y `backend/tests/terminaciones.api.test.ts` (35 casos): **verde en ambos**, tanto contra SIEI_DEV como contra una instalación limpia `001→015` construida desde los archivos versionados (2 corridas completas: una antes y otra después del fix de 40.1, ambas verdes). Regresión completa del backend ejecutada (`signals`, `equipment`, `hierarchy`, `comm-links`, `connections`, `loops`, `projects-admin`, `users-members`, `catalogs`, `pnid-imports`, `entregables-ldi`, `equipos-instrumentacion`, `instrumento-eliminacion`, `planos`) — todas en verde. Frontend: `tsc -b` limpio, `vite build` exitoso, `oxlint` sin hallazgos.

### 40.5 Preguntas que siguen abiertas (heredadas de 37.20/38.15/39.17, sin cambio)

Convención exacta de `conductor.codigo` para conductores sin dato legacy que lo sugiera; formato legacy ambiguo `"F1-F2-3-4"`; multi-bloque `TB1`/`TB2` sin evidencia real todavía; puentes/terminal común más allá del caso de doble-clamp ya resuelto; momento exacto en que el backend decide materializar un módulo nuevo más allá del trigger automático (cubierto por el trigger + el procedimiento de sincronización, pero la política de "¿cuándo llamar sync manualmente vs. confiar en el trigger?" queda como criterio de uso, no de esquema).

### 40.6 Estado final

`015_terminaciones.sql` implementada, aplicada en SIEI_DEV y en una instalación limpia `001→015`, con backend y frontend mínimos funcionando end-to-end, tests SQL y de API en verde, y regresión completa sin romper nada de `001`–`014`. **`001`–`014` permanecen exactamente como estaban (commit `98e61bc`) — ningún archivo de migración congelada fue modificado.** Sin commit todavía (pendiente de instrucción explícita del usuario).

## 41. Revisión bloqueante final — topología GABINETE intermedio (CIERRE)

Disparado por "REVISIÓN BLOQUEANTE FINAL — TOPOLOGÍA GABINETE → MÓDULO EN 015": la primera implementación de `015` (secciones 36-40) no soportaba GABINETE como nodo intermedio de una ruta — un caso físico real (cable de campo → terminal de gabinete + cableado interno → terminal de módulo) que el usuario aprobó explícitamente durante el diagnóstico (memoria `siei-terminal-blocks-015`, punto 3A/38.10) pero cuya consecuencia sobre `TR_tramo_conexion_validar_secuencia` no se había verificado hasta este punto.

### 41.1 Regla vieja exacta encontrada (evidencia, no suposición)

Búsqueda exhaustiva confirmada por `grep` en migraciones (`001`-`015`), triggers, backend y tests: el **único** punto de bloqueo era el bloque "Punto 6" de `TR_tramo_conexion_validar_secuencia` (`001_initial_schema.sql` línea 968, recreado sin cambio funcional en `012_gabinetes.sql` línea 268 salvo `rio_id→gabinete_id`, y de nuevo en `015` con los cambios de nullability de `par_conductor_id`):

```sql
-- Punto 6: un nodo intermedio (no es el ultimo tramo) debe ser CAJA
IF EXISTS (
    SELECT 1 FROM @activos a
    JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
    WHERE a.rn < a.total AND p.caja_id IS NULL
)
BEGIN
    ROLLBACK TRANSACTION;
    THROW 51017, 'Un nodo intermedio de la ruta debe corresponder a una CAJA.', 1;
END
```

Cualquier punto intermedio (`rn < total`) con `caja_id IS NULL` — incluido uno gabinete-owned — era rechazado sin excepción. Confirmado con evidencia, no supuesto, que **ningún otro trigger** necesitaba cambio: `TR_senal_validar_canal_ruta` (`001` línea 1277, recreado en `012` línea 411) y `TR_tramo_conexion_validar_canal_ruta` (`001` línea 1373, recreado en `012` línea 522) solo validan el **nodo FINAL** de la ruta (vía `@ultimo`, `rn=1 ORDER BY numero_orden DESC` / `rn = a.total`), comparando `pd.modulo_id` contra `canal.modulo_id` y `pd.gabinete_id` (si está poblado) contra el gabinete real del canal — en la topología nueva el nodo final sigue siendo un punto de MODULO exactamente como siempre, así que ninguno de los dos necesitó tocarse. Backend: `connectionRoutes.ts` no tenía validación propia de "intermedios = solo caja" — solo traduce el `51017` de la BD a HTTP (`mapRouteSqlError`), confirmando que la única fuente de la regla era la base de datos.

### 41.2 Cambio realizado (dentro de `015`, `001`-`014` sin tocar)

Se dividió "Punto 6" en 3 chequeos dentro de la **misma** recreación de `TR_tramo_conexion_validar_secuencia` que `015` ya hacía (no una recreación adicional):

1. Un nodo estrictamente antes del penúltimo (`rn < total - 1`) sigue exigiendo CAJA sin excepción — sin cambio de fondo.
2. El **penúltimo** nodo (`rn = total - 1`, solo si `total > 1`) admite CAJA **o, novedad de 015, GABINETE** — nunca MODULO (un módulo solo puede ser el nodo final).
3. Si el penúltimo es GABINETE, el **último** debe ser un MODULO que pertenezca físicamente a ese mismo gabinete (`modulo → slot → rack → gabinete`), error nuevo `51034` — rechaza GABINETE A → MODULO de GABINETE B aunque sean del mismo proyecto.

Backend: `connectionRoutes.ts` — mensaje de `51017` actualizado para reflejar que el penúltimo ahora admite CAJA o GABINETE, y se agregó el mapeo de `51034` (`route_gabinete_modulo_mismatch`, 400). Se corrigió además, de paso, un mensaje de `51007` que todavía decía "RIO" en vez de "GABINETE" (residuo textual de antes de la migración 012, sin relación funcional con esta revisión).

### 41.3 Nueva topología permitida — las 3 familias exactas pedidas

```
A) INSTRUMENTO/EQUIPO → 0..N CAJAS → GABINETE
B) INSTRUMENTO/EQUIPO → 0..N CAJAS → MODULO
C) INSTRUMENTO/EQUIPO → 0..N CAJAS → GABINETE → MODULO (mismo gabinete)
```

Siguen rechazadas: GABINETE→CAJA, GABINETE→GABINETE, MODULO como no-final, GABINETE en cualquier posición anterior al penúltimo, y GABINETE A→MODULO de GABINETE B — todas verificadas con un caso SQL dedicado (36.4 abajo).

### 41.4 Validación "mismo gabinete del módulo"

`modulo → slot → rack → gabinete_id` comparado contra el `gabinete_id` del punto penúltimo — mismo patrón de navegación de jerarquía física ya usado en `TR_senal_validar_canal_ruta`/`TR_tramo_conexion_validar_canal_ruta` para el nodo final, reutilizado aquí para el penúltimo.

### 41.5 Casos SQL nuevos y resultado

`database/tests/027_smoke_terminaciones.sql` ampliado (no se creó un archivo nuevo — seguía sin congelar, tal como el propio pedido prefería) con los casos 28-33:

| Caso | Escenario | Resultado |
|---|---|---|
| 28a/28b | INSTRUMENTO→GABINETE→MODULO directo (sin caja), con terminaciones reales ORIGEN (terminal de gabinete)/DESTINO (terminal de módulo) | PASS |
| 29a/29b | INSTRUMENTO→CAJA→GABINETE TB1 terminal 15 (posición A, cable de campo)→[interno, posición B]→MODULO/canal correcto — caso real completo pedido explícitamente | PASS |
| 30 | GABINETE A→MODULO perteneciente a GABINETE B | PASS (rechazo `51034` confirmado) |
| 31 | INSTRUMENTO→GABINETE→CAJA→MODULO (gabinete antes del penúltimo) | PASS (rechazo `51017` confirmado) |
| 32 | INSTRUMENTO→GABINETE→GABINETE | PASS (rechazo `51034` confirmado) |
| 33 | INSTRUMENTO→MODULO→GABINETE (módulo como intermedio) | PASS (rechazo `51017` confirmado) |

**Total: 42/42 casos PASS** (34 de la implementación original + 8 de esta revisión — nota: son 6 escenarios nuevos pero 8 assertions PASS nuevas, 28 y 29 tienen 2 cada uno). Además se encontró y corrigió un **caso de prueba pre-existente desactualizado**: `database/tests/007_smoke_secuencia_ruta.sql` "CASO 2" afirmaba textualmente lo contrario de la regla ahora aprobada ("GABINETE COMO NODO INTERMEDIO DEBE SER RECHAZADO", con el mismo `@gabinete_id`/`@modulo_id` que además están relacionados entre sí por el propio fixture del archivo). Se actualizó ese caso (no una migración — un archivo de prueba, editable igual que ya se hizo en fases previas cuando una regla de negocio evoluciona con aprobación explícita) para reflejar la regla vigente, dejando documentado en el propio archivo por qué cambió y dónde vive ahora la cobertura del caso rechazado (`027`, casos 30-33).

### 41.6 Casos API nuevos y resultado

`backend/tests/terminaciones.api.test.ts` ampliado con una sección "TOPOLOGIA GABINETE INTERMEDIO": ruta INSTRUMENTO→GABINETE→MODULO (mismo gabinete) vía `POST /routes` con 2 segmentos (`parConductorId: null` en ambos) → `201`; ruta GABINETE A→MODULO de GABINETE B → `400`; `GET .../conexionado` de la ruta aceptada confirmado con **2 segmentos distintos** en el arreglo de respuesta (caja/gabinete y gabinete/módulo nunca se colapsan en una sola terminación — la respuesta ya era, por construcción, un arreglo de segmentos por `tramo_conexion`, así que este comportamiento no necesitó cambio de código, solo verificación). **38/38 PASS** (35 de la implementación original + 3 nuevas).

### 41.7 Regresiones

Además de las 14 suites de backend ya verificadas en el cierre anterior (todas re-ejecutadas de nuevo, sin cambio: verdes), se ejecutaron explícitamente `database/tests/004_smoke_ruta_directa.sql`, `005_smoke_ruta_canal.sql`, `006_smoke_ruta_caja.sql`, `007_smoke_secuencia_ruta.sql` (corregido, ver 41.5), `008_smoke_recursos_en_uso.sql`, `009_smoke_desactivar_senal.sql` y `024_smoke_gabinete_migracion.sql` contra SIEI_DEV — **todas en verde**, confirmando que instrumento→módulo, instrumento→gabinete, instrumento→caja→módulo, instrumento→caja→gabinete, N cajas→módulo y N cajas→gabinete (topologías ya existentes desde `001`/`012`) siguen funcionando exactamente igual.

### 41.8 Clean install

`001→015` reaplicado desde cero en una tercera base de datos temporal (`SIEI_CLEAN_TEST3`) con el archivo `015_terminaciones.sql` ya corregido — **15/15 migraciones con exit 0**. `007_smoke_secuencia_ruta.sql` corregido (2/2 PASS) y `027_smoke_terminaciones.sql` (42/42 PASS) ejecutados sobre esa instalación limpia. Base de datos temporal destruida al finalizar.

### 41.9 Aclaraciones del reporte anterior (punto 14 del pedido)

**Conteo de suites de regresión**: el reporte anterior dijo "13 suites adicionales" pero listó 14 (`signals, equipment, hierarchy, comm-links, connections, loops, projects-admin, users-members, catalogs, pnid-imports, entregables-ldi, equipos-instrumentacion, instrumento-eliminacion, planos`) — **el número correcto es 14**, el "13" fue un error de conteo en el texto del reporte, la lista misma siempre fue completa y correcta.

**Residuo en SIEI_DEV — origen exacto de cada uno, y si es deliberado**:
- `cat.cat_modulo_io` (catálogo global, sin `activo`, sin soft delete posible por diseño — ver `moduleTypes.ts`): cada corrida de `physical-hierarchy.api.test.ts` y de `terminaciones.api.test.ts` deja 1-3 filas de prueba (fabricante `SIEI-TEST`/`API TEST`). **Deliberado y ya documentado por el propio `physical-hierarchy.api.test.ts` antes de esta fase** ("inherente al esquema, no un residuo evitable por este test") — `terminaciones.api.test.ts` hereda exactamente el mismo patrón, no es un caso nuevo.
- `nucleo.par_conductor` (sin columna `activo` desde `001`, registro histórico permanente por diseño): `physical-connections.api.test.ts` deja pares de prueba tras desactivar su cable — **deliberado y ya documentado por ese test antes de esta fase**, sin relación con `015`.
- Catálogos de dominio abierto (`interface-types`/`com-types`/`com-media-types`, sin `activo`): `catalogs.api.test.ts` deja códigos de prueba — **deliberado y ya documentado por ese test**, sin relación con `015`.
- `nucleo.bloque_terminal`/`terminal`/`posicion_terminal` ligados a los módulos de prueba de `terminaciones.api.test.ts` (4-6 filas): mismo patrón que el primer punto — el módulo de prueba nunca se desactiva en el test (no era necesario para lo que prueba), así que su bloque/terminal/posición materializados tampoco. Nuevo en el sentido de que es específico de `015`, pero de la misma naturaleza que el resto (fixture de módulo/rack/slot de prueba nunca limpiado, patrón ya aceptado en `physical-hierarchy.api.test.ts`).
- `nucleo.conductor` de pruebas simples (CRUD directo, sin ruta): unas pocas filas por corrida sin `DELETE` explícito en el test — análogo exacto a `par_conductor`.

**¿Afecta producción o el clean install?** No, en ningún caso: (1) SIEI_DEV es explícitamente la base de datos de desarrollo/pruebas compartida, no existe todavía una base de producción; (2) el clean install parte siempre de una base de datos completamente vacía, nunca de SIEI_DEV — se verificó 3 veces de forma independiente en bases de datos temporales descartables sin ningún dato preexistente, y las 3 veces el resultado fue limpio. El residuo de SIEI_DEV es acumulación de fixtures de sesiones de prueba repetidas contra una base compartida, exactamente la misma categoría de fenómeno que el propio repositorio ya documenta para `cat_modulo_io`/`par_conductor`/catálogos abiertos desde antes de que existiera `015` — no se modificó código solo por esto, tal como el pedido autorizó explícitamente.

### 41.10 Estado final de esta revisión

**Sin commit.** `git diff --stat`: 12 archivos modificados (+1905/−18 líneas) + 8 archivos nuevos ya reportados en el cierre anterior — el único archivo adicional tocado por esta revisión es `database/tests/007_smoke_secuencia_ruta.sql` (test, no migración). `git diff --check` limpio. `001`–`014` confirmadas byte-idénticas al commit `98e61bc` (verificado de nuevo con `git diff --stat` dirigido a los 14 archivos, salida vacía). Pendiente de aprobación final del usuario antes de commit.

## 42. Auditoría final pre-commit (sin rediseño, solo correcciones de implementación)

Disparada por "AUDITORÍA FINAL DE `015_terminaciones` — PRE-COMMIT". Revisión completa del diff real, migración línea por línea, y backend/frontend, buscando defectos de implementación (no de diseño). Confirmado de nuevo: 20 archivos (12 modificados + 8 nuevos), `001`–`014` byte-idénticas a `98e61bc` (verificado con `md5sum` contra el blob de git, no solo `git status`).

**Hallazgos y correcciones** (ninguno cambia esquema, reglas de negocio ni alcance — todos son bugs de implementación del diseño ya aprobado):

1. **Path-scoping incompleto en 4 endpoints anidados** (`bloquesTerminal.ts`: `DELETE .../terminales/:id`, `POST .../terminales/:id/posiciones`, `DELETE .../terminales/:id/posiciones/:id`; `tramoConductores.ts`: `DELETE .../:id/terminaciones/:id`) — el `WHERE` solo filtraba por `proyecto_id` + el id del recurso final, sin verificar que ese recurso realmente perteneciera al padre indicado en la URL (`:bloqueId`/`:terminalId`/`:id`). No era un hueco de seguridad cross-project (`proyecto_id` seguía protegiendo eso), pero sí una inconsistencia real frente al contrato REST anidado ya establecido en `planos.ts`. **Corregido**: las 4 consultas ahora exigen también la coincidencia del padre en el `WHERE`. Verificado con un caso nuevo en `terminaciones.api.test.ts` (bloque ajeno del mismo proyecto → `404`) — **39/39 PASS** tras el fix (era 38/38 antes de agregar el caso).
2. **`ModuloTerminalesView.handleSync` sin manejo de error** (`GabineteDetailPage.tsx`) — un fallo de `POST .../sync-terminales` no se mostraba al usuario (sin `catch`, solo `finally`). **Corregido**: se agregó estado de error y `<ErrorMessage>`, consistente con el resto del archivo. `tsc -b`/`vite build`/`oxlint` verificados de nuevo, limpios.
3. **Comentarios obsoletos con "RIO"** (residuo textual de antes de la migración 012, no introducido por 015 pero en el mismo bloque de código tocado) en `connectionRoutes.ts` (cabecera del router y mensaje de error `51007`) — **corregidos** a "GABINETE", y la cabecera ahora menciona explícitamente la topología nueva (`CAJAS -> GABINETE -> MODULO`).

**No se encontraron**: FKs incorrectas, nullability incorrecta, índices redundantes o demasiado restrictivos, CHECK contradictorios, triggers no set-based, triggers sensibles a INSERT multi-fila, `OUTPUT` sin `INTO` en tabla con trigger, ciclos de trigger, soft-delete inconsistente, ni referencias vivas a `rio_id`/`par_conductor_id NOT NULL` en `015_terminaciones.sql` — confirmado por lectura completa línea por línea más `grep` dirigido.

**Regresión completa re-ejecutada tras los 3 fixes**: 15 suites de backend (14 + `terminaciones`) con conteo exacto — `signals` 35, `equipment` 20, `hierarchy` 34, `comm-links` 31, `connections` 37, `loops` 18, `projects-admin` 22, `users-members` 27, `catalogs` 49, `planos` 33, `pnid-imports` 86, `entregables-ldi` 73, `equipos-instrumentacion` 40, `instrumento-eliminacion` 24, `terminaciones` 39 — **568 PASS / 0 FAIL en total**. SQL: `004`/`005`/`006`/`007`/`008`/`009`/`024` sin cambio, `027` = **42/42**. Clean install `001→015` repetido una cuarta vez en una BD temporal nueva (`SIEI_AUDIT_FINAL`) — 15/15 exit 0, `007`=2/2, `027`=42/42, BD destruida.

**Residuo en SIEI_DEV** (tras toda la sesión de auditoría, que re-ejecutó `terminaciones.api.test.ts` varias veces más): `nucleo.conductor` 28 activos/12 inactivos, `nucleo.bloque_terminal` 19 activos/21 inactivos, `nucleo.terminal` 30/27, `nucleo.posicion_terminal` 30/27 — **`nucleo.tramo_conductor` y `nucleo.terminacion` activos: 0 en ambos**, confirmando que ninguna cascada dejó una conexión física huérfana activa. El residuo activo restante son fixtures CRUD simples (conductores sueltos sin ruta, bloques/terminales de módulos de prueba) nunca explícitamente desactivados por los tests — misma categoría, ya documentada, que `cat.cat_modulo_io`/`nucleo.par_conductor`/catálogos abiertos desde antes de `015`. Confirmado: `015_terminaciones.sql` en sí **no contiene una sola sentencia `INSERT` de datos de proyecto** — 100% DDL (tablas, índices, triggers, un procedimiento), verificado por lectura completa del archivo.

**Veredicto: APTO PARA COMMIT.**

## 43. Ajuste de diagnóstico CONTROL — contactos secos y `BORNE_JB` (preview de carga, sin cambios a `015`)

Disparado por una revisión del preview de carga de `SENALES_CONTROL` (proyecto 620, ver conversación de análisis previa, no una fase de `015` en sí). El preview había interpretado `BORNE_JB` de forma demasiado literal en el caso `620-HS-5084` (`BORNE_JB=1,2,3`, `BORNERA=F1-2`, `T_MODULO=IN-0;L2-0`), sugiriendo como hipótesis principal que el tercer borne fuera blindaje/spare que no continúa hasta el gabinete. El usuario aclaró el motivo real: para una señal de **contacto seco** (como `620-HS-5084`, un selector), el contacto necesita que se le energice con 120 V para poder producir una señal — esa alimentación puede ser interna del tablero/caja, sin cable propio que SIEI deba modelar (ni su origen aguas arriba, ni un `nucleo.cable`/`tramo_conductor` para ella).

**Interpretación retirada**: "cada número en `BORNE_JB` = un conductor que necesariamente continúa hasta el gabinete/módulo". No es una regla válida — `BORNE_JB` es evidencia de bornes físicos observados en la caja, no una lista de conductores garantizados de extremo a extremo. Tampoco se afirma automáticamente que el borne sobrante sea blindaje, spare, o alimentación — sin evidencia explícita de plano, cualquiera de esas es solo una hipótesis, no un hecho a asentar.

**Consecuencia para el criterio `TERMINATION_READY` del preview**: se retira la regla anterior ("sin `BORNERA` compuesta y sin `BORNE_JB` ⇒ COMPLETA"). El nuevo criterio exige, sin adivinar, la correspondencia real entre ambos extremos (qué borne de caja específico conecta con qué terminal específico de gabinete/módulo) — no solo que ambos conteos existan. Verificado sobre las 269 filas de señal CONTROL: ni siquiera las 62 filas donde el conteo de `BORNE_JB` coincide exactamente con el de `T_MODULO` (2 y 2, típicamente transmisores AI de 4-20mA) tienen esa correspondencia *explícita* en el dato — se sabe que hay 2 bornes y 2 terminales, pero no cuál borne es cuál terminal. Recalculado: **`TERMINATION_READY = COMPLETA` pasa de 80 a 0 de 269; `PARCIAL` pasa a 269 de 269**, con una sub-clasificación informativa (no un estado nuevo en BD) por calidad de evidencia: 62 filas con conteo coincidente (confianza alta, típicamente lazos AI/AO de 2 hilos), 117 filas con caja y conteo no coincidente (incluye el caso de alimentación interna de contacto seco), 90 filas sin caja (ruta directa instrumento/equipo→gabinete, sin evidencia de bornes de ningún tipo del lado instrumento). `SIGNAL_READY` (186 LISTA / 83 WARNING / 0 RECHAZADA) y `ROUTE_READY` (204 RESOLUBLE / 65 PARCIAL) no cambian — la nueva regla es exclusiva de la capa de terminación fina.

**Sin cambio a `015_terminaciones`**: la jerarquía `TERMINACION → TRAMO_CONDUCTOR → CONDUCTOR` se mantiene exactamente igual — toda terminación formal sigue perteneciendo obligatoriamente a un conductor físico real (`terminacion` sin `tramo_conductor` sigue sin ser válido, sin excepción). Lo que se confirma explícitamente (ya era cierto en el diseño, ahora queda documentado con este caso real) es la asimetría inversa: un `terminal`/`posicion_terminal` puede existir físicamente sin tener nunca una `terminacion` — la cadena `BLOQUE_TERMINAL → TERMINAL → POSICION_TERMINAL` sin `TERMINACION` es un estado válido, no una carga incompleta que haya que forzar a cerrar.

**Impacto en el futuro importador**: debe poder crear señal + asignar IO + crear ruta lógica aunque la capa de terminación quede `PARCIAL` — no bloquear la carga lógica de una señal por no poder modelar (ni deber hacerlo) el detalle de alimentación interna de un contacto seco, que queda deliberadamente fuera de alcance. Tampoco debe inventar `posicion_terminal.codigo` (`A`/`B`, etc.) para cerrar artificialmente una correspondencia que el dato no da — eso ya estaba establecido y se reconfirma aquí.

**Caso `620-HV-5084` reconsiderado**: la explicación de alimentación interna de 120 V, confirmada por el usuario específicamente para `620-HS-5084` (contacto seco de entrada, DI), se extiende razonablemente a `620-ZSO-5084`/`620-ZSC-5084` (mismo tipo de señal: DI de contacto seco, mismo patrón 3 bornes vs 2 terminales). **No se extiende automáticamente** a `620-HYO-5084`/`620-HYC-5084` (DO — comando de salida hacia una electroválvula, dirección de circuito distinta) cuyo desajuste es mayor y de otra naturaleza (5 bornes vs 2 terminales, y 4 vs 2 respectivamente) — esas dos señales quedan con la brecha sin explicación confirmada, pendiente de un dato adicional o de una respuesta del usuario, no asentada por analogía.

Sin cambios de esquema, sin nueva migración, sin backend, sin frontend, sin inserción de datos. Este ajuste corrige únicamente el criterio de clasificación del preview de carga de `SENALES_CONTROL` y su documentación.
