# Matriz de cobertura de datos — Excel de referencia vs. modelo físico de SIEI

Auditoría campo por campo de los 5 Excel de `reference_excel/` contra `MODELO_FISICO_SIEI.md`, para verificar que el núcleo pueda representar la información real sin pérdida silenciosa antes de generar `001_initial_schema.sql`.

**Metodología**: `01_MASTER_INSTRUMENTOS_620.xlsm`, `02_MASTER_IO_620.xlsm` y `LISTA DE SENALES_620.xlsm` comparten una familia de hojas casi idénticas (`SENALES`, `SENALES_CONTROL`, `SENALES_COM`, `MASTER_SENALES`, `__UNDO_SENALES__`, etc.) — sus columnas se consolidan en **una fila por concepto**, indicando en "Aparece en" todas sus ubicaciones, para que la tabla sea legible en vez de repetir ~50 columnas cinco veces. Filas de hojas realmente distintas (`BASE_CONTEO_IO`, `Tabla_Lazos`, `PLANOS`, `EQUIPOS`, `IMPORT_PNID`, `VALIDACIONES`, etc.) se listan aparte.

**Clasificación**: `ALMACENADO` (tiene columna propia en el físico) · `DERIVADO` (se calcula/consulta, no se guarda) · `CATÁLOGO` (valor de lista cerrada, vía `CAT_*`) · `ENTREGABLE/VISTA` (reporte, no dato maestro) · `DIFERIDO` (módulo futuro ya identificado — Documentos, Trazabilidad, Matriz Causa-Efecto, Usuarios) · `DESCARTADO` (artefacto de Excel sin valor de negocio) · `SIN MODELO` (brecha real — no tiene dónde ir hoy).

---

## 1. Resumen ejecutivo

| Clasificación | Cantidad aproximada de conceptos |
|---|---|
| ALMACENADO | ~55 |
| DERIVADO | ~10 |
| CATÁLOGO | ~9 (ya definidos) + 6 candidatos nuevos identificados aquí |
| ENTREGABLE/VISTA | ~8 |
| DIFERIDO | ~14 |
| DESCARTADO | ~10 |
| **SIN MODELO** | **~28** — detallados en sección 2 |

Ninguna brecha `SIN MODELO` es de las 5 entidades núcleo ya cerradas (INSTRUMENTO/SEÑAL/CANAL/RUTA-TRAMO/LAZO como estructura) — todas son **atributos faltantes** o **un dominio completo de terminación física** (sección 3), no fallas estructurales del diseño ya aprobado.

---

## 2. Campos SIN MODELO — detalle e importancia

### 2.1 Instrumento — atributos de ingeniería no capturados

| Campo Excel | Aparece en | Significado inferido | ¿Se perdería algo importante? |
|---|---|---|---|
| ~~`TAG_WSP` (DIFERIDO — no se agrega columna, ✅ decisión explícita)~~ → **`TAG_ANTERIOR`, IMPLEMENTADO (migración 004, `database/migrations/004_pnid_import.sql`)** | IMPORT_PNID, familia SENALES, MASTER_INSTRUMENTOS, COM, Tabla_Lazos (`TAG_INSTRUMENTO_WSP`); reporte real `162281-620-Instrument List.xlsx` → columna `Tag Anterior` | Tag anterior del instrumento según una fuente/ingeniería previa (P&ID) | **Decisión revisada explícitamente al construir la importación P&ID real.** El razonamiento original seguía siendo válido — WSP es una empresa/ingeniería previa concreta, no un concepto universal — pero el reporte real de Plant 3D expone la misma idea bajo un encabezado neutral y genérico, `Tag Anterior`, que no depende de WSP como empresa. Se implementó `nucleo.instrumento.tag_anterior NVARCHAR(50) NULL`, poblado únicamente desde esa columna del reporte, **nunca autogenerado** cuando SIEI detecta un `TAG_MODIFICADO` (ese cambio ya queda registrado por el propio resultado de comparación e `integracion.importacion_pnid_resultado.diferencias`, no se duplica escribiendo encima de `tag_anterior`). El módulo general de **ORIGEN / INGENIERÍA PREVIA / TRAZABILIDAD** (de dónde viene un dato, quién lo generó, con qué tag lo identificaba esa fuente) sigue diferido tal cual — esto es un campo puntual, no una reapertura de ese módulo completo. |
| `TECNOLOGIA` | Igual que arriba | Tecnología del instrumento (ej. "N/A", presumiblemente radar/capacitivo/etc. en otros casos) | Media — dato descriptivo de ingeniería, hoy sin columna. |
| `FUNCIONAMIENTO` | Igual | Principio de accionamiento: `NEUMATICA`, `HIDRAULICA`, `ELECTRICA` | Media-alta para válvulas — describe cómo se acciona físicamente. Valores repetidos y limitados → candidato a catálogo (sección 4). |
| `CUERPO_INSTRUMENTO` | Igual | Tipo de cuerpo de válvula: `CUCHILLA`, `MARIPOSA`, `BOLA` | Media — mismo caso, candidato a catálogo. |
| `POSICION_NORMAL` / `POSICION_FALLA` | MASTER_INSTRUMENTOS | Posición normal (`NC`/`NO`) y posición ante falla (`FL` = fail-last, etc.) de una válvula | **Alta** — es información de seguridad de proceso (comportamiento ante pérdida de señal/aire), no un dato cosmético. Se perdería si no se modela. |
| `CONEXION_PROCESO` / `CONEXION_PROCESO2` | IMPORT_PNID, MASTER_INSTRUMENTOS | Tipo/tamaño de conexión a proceso (ej. `4" BRIDADO`) | Media — dato de especificación técnica del instrumento. |
| `LINEA` (a nivel de instrumento) | MASTER_INSTRUMENTOS | Línea de tubería asociada | Baja-media — ya existe a nivel de señal en algunas hojas; a nivel de instrumento parece redundante pero no está garantizado que siempre coincida. |
| `EQUIPO_ASOCIADO` | Casi todas las hojas de instrumento/señal | Texto libre con el equipo de proceso al que sirve el instrumento (ej. `620-TKS-5003`, `420-SUU-023`) | **Importante y delicado** — ver nota 🟡 abajo, es distinto del concepto ya decidido de "EQUIPO no se relaciona con INSTRUMENTO". |
| `ALIMENTACION` | MASTER_INSTRUMENTOS | Alimentación eléctrica del instrumento (ej. "120 VAC", o el instrumento es "loop powered") | **Alta** — se conecta directamente con la brecha de terminaciones/alimentación de la sección 3. |
| `N_SENALES` | MASTER_INSTRUMENTOS | Cantidad de señales del instrumento | Baja — es `DERIVADO` (se cuenta con `SELECT COUNT(*)`), no es una pérdida real. |
| `N_HILOS` | MASTER_INSTRUMENTOS | Cantidad de hilos que requiere el instrumento | Media — útil como estimado de ingeniería previo al conexionado real (que si se modela sí sería derivable, pero antes de conexionar es un dato de planeación que no tiene otro lugar). |
| `RANGO` / `UNIDAD` (a nivel instrumento) | MASTER_INSTRUMENTOS | Rango de calibración del instrumento (distinto del `rango_min/max` que ya existe a nivel de señal) | Media — puede ser redundante con el rango de la señal principal, o puede ser un dato de hoja de datos independiente; ambigüedad a resolver, no ignorar. |
| `PROTOCOLO` | MASTER_INSTRUMENTOS | Protocolo de comunicación del instrumento (HART, Profibus, etc.) | **Alta** para instrumentos COM — se relaciona directamente con `ENLACE_COM.tipo_com`, pero hoy no hay ningún lugar que lo capture a nivel de instrumento cuando el instrumento mismo (no un equipo) es quien tiene el protocolo. |
| `HOJA_DATOS` | MASTER_INSTRUMENTOS | Referencia/enlace a la hoja de datos del instrumento | Baja — documento, pertenece al futuro módulo de Documentos (DIFERIDO, no urgente). |
| `OBSERVACION` (a nivel instrumento) | MASTER_INSTRUMENTOS | Campo de texto libre | Baja pero fácil de agregar — hoy `instrumento` no tiene columna `observacion` propia (sí la tiene `senal`). |

🟡 **Nota importante sobre `EQUIPO_ASOCIADO`**: ya se confirmó explícitamente (ronda del modelo conceptual) que `EQUIPO` **no** tiene relación con `INSTRUMENTO`. La evidencia de `EQUIPO_ASOCIADO` no contradice esa regla — describe otra cosa: **a qué equipo de proceso sirve funcionalmente el instrumento** (ej. la válvula regula el nivel del tanque `620-TKS-5003`), no "qué equipo origina esta señal". Son conceptos distintos que comparten nombre por casualidad del Excel. No recomiendo reabrir la decisión ya aprobada — si se quiere conservar este dato, la opción de menor impacto es un atributo de texto libre en `instrumento` (sin FK a `EQUIPO`), y lo señalo como candidato, no como algo que ya decidí agregar.

### 2.1b Clasificación de los 6 atributos de instrumento identificados — pendientes de decisión, no eliminados de la cobertura

Ninguno de estos 6 se convierte automáticamente en columna ni en catálogo en esta ronda — se listan aquí para que no desaparezcan de la cobertura aunque su implementación quede para una migración posterior.

| Campo | Clasificación propuesta | Justificación |
|---|---|---|
| `POSICION_NORMAL` (`NC`/`NO`) | Atributo directo (texto corto) — candidato a catálogo pequeño si se confirma que el dominio de valores es cerrado y compartido entre proyectos | Solo 2 valores vistos en la muestra; insuficiente evidencia para garantizar que es un dominio universal cerrado |
| `POSICION_FALLA` (`FL`, …) | Igual que `POSICION_NORMAL` | Mismo caso — dato de seguridad de proceso, formato corto tipo código |
| `ALIMENTACION` (a nivel instrumento, ej. "120 VAC") | Atributo directo — **relacionado pero distinto** del dominio de alimentación eléctrica de la sección 6.8 (ese es sobre el conexionado físico de la alimentación; este es una descripción general del instrumento, ej. su voltaje de trabajo) | No se deben confundir: uno es "qué alimentación usa el instrumento", el otro es "por dónde física y físicamente le llega" |
| `PROTOCOLO` (HART, Profibus, Modbus, …) | Derivable / posiblemente redundante — `CAT_TIPO_INTERFAZ` **ya incluye** el valor `"4-20 mA + HART"` a nivel de señal | Antes de agregar una columna nueva a `instrumento`, verificar si el protocolo ya queda cubierto por `senal.tipo_interfaz_id` en todos los casos reales, o si existen instrumentos donde el protocolo debe registrarse aunque la señal aún no exista |
| `FUNCIONAMIENTO` (`NEUMATICA`, `HIDRAULICA`, `ELECTRICA`) | Candidato a catálogo | Valores repetidos y de dominio cerrado en toda la muestra — cumple el criterio de "dominio realmente cerrado" para justificar un `CAT_*` |
| `CUERPO_INSTRUMENTO` (`CUCHILLA`, `MARIPOSA`, `BOLA`, …) | Candidato a catálogo | Mismo caso — valores repetidos, dominio controlado por tipo de válvula |

### 2.2 Señal — atributos no capturados

| Campo Excel | Aparece en | Significado inferido | Importancia |
|---|---|---|---|
| `CLASE_ALARMA` | familia SENALES_COM/CONTROL | Clasificación de la alarma, distinta de `PRIORIDAD_ALARMA` | Media — si existe como concepto separado de prioridad, se perdería la distinción. |
| `CONEX_TIPO` | familia SENALES | Tipo de conexión de la señal (posiblemente relacionado con `TIPO_CONTACTO`, sección 3) | Media — vacío en la mayoría de filas muestreadas, pero la columna existe con intención. |
| `COMPLETITUD` | familia SENALES/MASTER_SENALES | Indicador de completitud del registro | Baja — probablemente `DERIVADO` (podría calcularse por reglas de campos obligatorios llenos), pero no se puede confirmar sin más evidencia; no descartar sin verificar. |
| `DISPR` | familia SENALES | Valor casi constante (`DISPR01`) junto a CHASIS/SLOT/MODULO | Baja — significado no determinado con certeza; posible agrupador de disposición física de gabinete, bajo impacto por ahora. |

### 2.3 Comunicaciones — hallazgos relacionados con el punto 4

| Campo Excel | Significado | Nota |
|---|---|---|
| `TIPO_DATO` (`BIT, DINT, DWORD, REAL, UDINT, UINT, WORD`) | Tipo de dato PLC de la señal comunicada | **Sin modelo** — no es lo mismo que `TIPO_IO` ni que la dirección `IN/OUT`. Es un tercer concepto ortogonal (ver sección 4). No estaba pedido explícitamente pero surge de la misma evidencia y refuerza la recomendación de separar conceptos. |
| `TAG_PLC_VENDOR` | Tag del PLC/controlador vendor en la hoja `COM` | Parece redundante con `EQUIPO`/`TAG_EQUIPO_INST` — probable duplicado, no una brecha nueva. |
| `UBICACION_GAB` | Ubicación del gabinete en la hoja `SENALES_COM` | Menor — descriptivo, sin columna hoy. |

### 2.4 Ruta/conexionado y alimentación — ver desarrollo completo en sección 3

Todo el clúster de terminación (`BORNERA`, `TB`, `REGLETA`, etc.) se detalla aparte en la sección 3 — era la brecha más significativa encontrada, **ya resuelta** con `PUNTO_CONEXION`. El clúster de alimentación (`ALIMENTACION`, `TIPO_CONTACTO`, `ES LOOP POWERED`, `Tablero/Regleta/Borneras Alimentación`) se conserva documentado en la misma sección, explícitamente **diferido** a una etapa dedicada.

---

## 3. Conexionados y terminaciones — brecha resuelta con PUNTO_CONEXION ✅

### 3.1 Qué información faltaba

El modelo anterior (`RUTA_CONEXION → TRAMO_CONEXION → PAR_CONDUCTOR → CABLE`) representaba correctamente **qué cable y qué par** ocupa cada tramo, y **por qué caja** pasa — pero no representaba en qué **terminal físico exacto** queda conectado ese conductor en cada extremo del tramo. Son datos distintos: "el par 5-6 del cable X" no es lo mismo que "el par 5-6 aterriza en la bornera F5,6 de la regleta TB-01 del módulo". **Esta brecha ya está resuelta** — ver 3.3.

Campos reales del Excel que documentan esto y que **no tienen columna hoy**:

| Campo Excel | Aparece en | Función |
|---|---|---|
| `TB`, `T_MODULO`, `TERMINAL DE MÓDULO` | familia SENALES, `BASE_CONTEO_IO` | Identificador de la regleta/bloque terminal del **módulo** (lado RIO) y el terminal específico dentro de ella (ej. `IN-0;L2-0`) → `punto_conexion.regleta`/`borne` (con `modulo_id` poblado) |
| `BORNERA`, `BORNERA DE RIO`, `TB DE RIO` | familia SENALES, `BASE_CONTEO_IO` | Número(s) de bornera dentro de la regleta del lado RIO (ej. `F1;2`) → `punto_conexion.regleta`/`bornera` (con `rio_id` poblado — 🔵 nivel independiente de `modulo_id`, ver `MODELO_FISICO_SIEI.md` 6.7) |
| `TB_CAJA`, `BORNERA_BLOQUE_CAJA`, `BORNE_JB`, `TB DE CAJA`, `BORNERA DE CAJA` | familia SENALES, `BASE_CONTEO_IO` | Mismo concepto, del lado de la caja de conexiones → `punto_conexion` (con `caja_id` poblado) |
| `B_NUM_RESERVA` | familia SENALES | Bornera(s) de reserva dentro de un bloque | `DERIVADO` — se puede consultar contando `punto_conexion` sin tramos activos que las referencien; no se modela como columna de conteo |
| `ORDEN_INST_CAJA` | familia SENALES | Orden de instalación/posición dentro de la caja | `SIN MODELO` todavía — atributo menor, no crítico, candidato a columna de `punto_conexion` si se confirma necesidad |
| `TAG_REGLETA_SLOT`, `BORNERAS_MOD` | `Tabla_Lazos` | Mismo concepto (identificador de regleta + lista de borneras usadas), formato de la plantilla de lazos | `ALMACENADO` — vía `punto_conexion.regleta`/`bornera`, una fila por punto en vez de una lista concatenada |
| `TAG DE REGLETA CAJA`, `BORNERAS CAJA` | `Tabla_Lazos` | Igual, del lado de la caja | `ALMACENADO` — igual, con `caja_id` |
| `NUMERO DE INSTRUMENTOS EN LA CAJA` | `Tabla_Lazos` | Cuántos instrumentos comparten una caja | `DERIVADO` (se cuenta vía `tramo_conexion` → `punto_conexion.caja_id`) |
| `HILOS/PARES QUE USA`, `PAR/HILOS ASIGNADOS`, `SOBRANTE` (y sus variantes `2`) | `Tabla_Lazos` | Qué pares concretos de un cable multipar quedan asignados, y cuántos quedan libres | El "asignado" ya es `ALMACENADO` (una fila de `PAR_CONDUCTOR` por par usado); el "sobrante" es `DERIVADO` (`cable.capacidad_conductores` menos pares usados) |
| `R_CABLE` | familia SENALES | Número de conductores de reserva del cable en ese punto | `DERIVADO`, mismo caso |

**✅ Todas las filas de esta tabla quedan resueltas** con `PUNTO_CONEXION` (Alternativa B, adoptada) — ver `MODELO_FISICO_SIEI.md` sección 6.7.

Además, existe un **segundo dominio completo, identificado y confirmado como real, pero explícitamente diferido a una etapa dedicada** (🔵 decisión tuya — no se descarta, no se agrega columna todavía): la **alimentación eléctrica** del instrumento, que en `Tabla_Lazos` tiene su propia ruta física paralela a la de señal. Se conservan aquí todos los campos encontrados, tal como pediste, para que no se pierdan al diseñar ese módulo:

| Campo Excel | Función | Estado |
|---|---|---|
| `TIPO_CONTACTO (SECO, ALIMENTADO)` | Si el contacto de la señal es seco (sin tensión) o alimentado | 🔵 DIFERIDO — módulo de alimentación |
| `ES LOOP POWERED ?` | Si el instrumento toma su alimentación del mismo lazo de señal (4-20 mA de 2 hilos) o necesita alimentación externa | 🔵 DIFERIDO |
| `TipoSeñalAlimentacion`, `TipoCableAlimentacion` | Tipo de señal/cable de la alimentación (cuando no es loop-powered) | 🔵 DIFERIDO |
| `Tablero Alimentación`, `Regleta Alimentación`, `Borneras Alimentación` | Ruta de terminación completa, paralela a la del conexionado de señal, para el cable de alimentación | 🔵 DIFERIDO — reutilizará `PUNTO_CONEXION` (un quinto rol `tablero_alimentacion_id` en el XOR) cuando se diseñe `RUTA_ALIMENTACION` |

### 3.2 Función que cumple esta información

Es exactamente lo que necesita un **diagrama de lazo** (loop diagram) para ser correcto y completo: de qué bornera exacta sale cada hilo, en qué regleta, y (cuando se diseñe el módulo de alimentación) de dónde viene la alimentación del instrumento si no es loop-powered.

### 3.3 Solución adoptada: PUNTO_CONEXION (Alternativa B) ✅

Desarrollo completo (tablas, cardinalidades, triggers, comparación con `CANALES_MAX`) en `MODELO_FISICO_SIEI.md` sección 6.7. Resumen de las tres alternativas evaluadas:

| Alternativa | Idea central | Estado |
|---|---|---|
| A — Texto en `TRAMO_CONEXION` | Columnas de texto libre por extremo (`bornera_origen`, `regleta_origen`, …) | Descartada — sin capacidad/reserva real, texto repetido sin integridad |
| **B — `PUNTO_CONEXION` genérico** | Entidad de terminación con pertenencia XOR (`instrumento`/`caja`/`rio`/`modulo`); `TRAMO_CONEXION.caja_id` eliminado (se deriva del punto) | **✅ Adoptada** |
| C — Jerarquía `REGLETA → BORNE` | Replica el patrón `CAT_MODULO_IO → MÓDULO → CANAL` con capacidad automática | Evolución natural de B, no descartada — se adoptará si se confirma necesidad de capacidad/reserva automática de regletas |

---

## 4. CAT_TIPO_IO vs. IN/OUT de comunicaciones — conclusión con evidencia

Se revisó `MASTER_SENALES` (hoja unificada de las 1031 señales del proyecto) cruzando `TIPO_IO` contra `HOJA_ORIGEN`:

| `TIPO_IO` | `HOJA_ORIGEN` | Filas |
|---|---|---|
| `AI`, `AO`, `DI`, `DO`, `RTD` | `SENALES_CONTROL` | mayoría — señales cableadas |
| `IN`, `OUT` | `SENALES_COM` | 760 filas — señales comunicadas |
| `AI` | `SENALES_COM` | **2 filas** (`620-SIG-000440`, `620-SIG-000441` — "PALABRA DE ALARMAS 2" y "HEARTBEAT DEL CONTROLADOR") |

Además, la hoja `SENALES_COM` tiene **tres columnas distintas** que hoy se solaparían en un único `CAT_TIPO_IO` si se junta todo: `ESTADO` (`IN`/`OUT`, dirección del dato), `TIPO_DATO` (`BIT, DINT, DWORD, REAL, UDINT, UINT, WORD`, tipo de dato PLC) y el propio `TIPO_IO` heredado de `MASTER_SENALES`.

**Conclusión**: `AI/AO/DI/DO/RTD` (tipo físico de hardware de E/S) e `IN/OUT` (dirección de una comunicación) **no representan el mismo concepto de negocio**. Son ortogonales: uno describe qué tarjeta física recibe la señal, el otro describe si el dato entra o sale por la red. La evidencia de las 2 filas "AI + SENALES_COM" refuerza esto — son casos donde incluso el propio Excel, al intentar forzar ambos conceptos en una sola columna, produjo una clasificación inconsistente (una señal de comunicaciones etiquetada como si fuera hardware analógico).

**✅ Recomendación aplicada**: se separó en dos catálogos — `CAT_TIPO_IO` (`AI, AO, DI, DO, RTD`, exclusivo de señales cableadas) y el nuevo `CAT_DIRECCION_COM` (`IN, OUT`, exclusivo de señales comunicadas). `SEÑAL.tipo_io_id` dejó de ser `NOT NULL`; se agregó `SEÑAL.direccion_com_id` (nula); la exclusión entre ambas se protege con un `CHECK` de una sola fila, sin necesitar trigger. Ver `MODELO_LOGICO_SIEI.md` sección 2.12 y `MODELO_FISICO_SIEI.md` sección 8.5. El hallazgo adicional de `TIPO_DATO` (tipo de dato PLC) sugiere un tercer catálogo `CAT_TIPO_DATO_COM` si se decide modelarlo más adelante — queda señalado, no aplicado.

---

## 5. Liberación histórica de PAR_CONDUCTOR — solución recomendada

Escenario planteado: una señal tenía ruta, la ruta deja de estar vigente, se quiere conservar el historial, y el mismo par debe quedar disponible para otra conexión.

| Alternativa | Descripción | Ventajas | Desventajas |
|---|---|---|---|
| **A — `activo` en `RUTA_CONEXION`/`TRAMO_CONEXION`** (revierte la exclusión decidida originalmente para estas dos tablas) | Mismo patrón ya usado en todo el resto del modelo (`canal`, `puerto`, `enlace_com`): `UX (par_conductor_id) WHERE activo = 1` en vez de `UNIQUE` simple. | **Consistencia total** con el mecanismo ya aprobado en el resto del núcleo — mismo comportamiento, misma forma de consultar, sin conceptos nuevos que aprender. Resuelve exactamente el escenario planteado: la fila vieja queda con `activo = 0` (historial preservado), el par queda libre para una fila nueva con `activo = 1`. | Ninguna relevante — es el mismo patrón ya extendido a 7 tablas en esta misma auditoría (sección 3, punto 3 de tu mensaje anterior). |
| **B — Vigencia con fechas** (`fecha_inicio`/`fecha_fin` en vez de `activo`) | Igual que A pero con rango temporal explícito en vez de un flag binario. | Permite responder "qué par usaba esta señal el 3 de marzo" con precisión de fecha, no solo "activo o no". | No hay evidencia de que SIEI necesite ese nivel de precisión temporal para conexionado (el módulo de trazabilidad ya está diferido); agrega dos columnas y una condición más compleja en el índice filtrado (`WHERE fecha_fin IS NULL`) sin beneficio claro hoy. |
| **C — Entidad de asignación histórica separada** (`ASIGNACION_PAR_CONDUCTOR`, distinta de `TRAMO_CONEXION`) | Mismo patrón ya evaluado (y diferido) para `ASIGNACION_CANAL`/`ASIGNACION_COM`. | Separaría "la ruta actual" de "el historial completo de asignaciones". | Sobre-ingeniería para este caso: `TRAMO_CONEXION` ya es la fila que representa la ocupación; duplicarla en una tabla de asignación aparte no aporta nada que `activo` no resuelva, y contradice el principio de no crear tablas sin necesidad demostrada. |

**✅ Alternativa A aplicada** — `activo` agregado a `ruta_conexion` y `tramo_conexion`, con los `UNIQUE` reemplazados por índices únicos filtrados (`WHERE activo = 1`), y un nuevo trigger `TR_ruta_conexion_desactivar_tramos` que propaga la desactivación de una ruta a sus tramos hijos automáticamente (documentado, no implementado). Ver `MODELO_FISICO_SIEI.md` sección 2.2.

---

## 6. Corrección aplicada — validación de CANALES_MAX

Ya corregido en `MODELO_FISICO_SIEI.md` (sección 7.1): `TR_canal_validar_capacidad` ahora documenta **dos** validaciones, no una — (1) cantidad de canales activos ≤ `canales_max`, y (2) que `numero_canal` esté dentro del rango `[0, canales_max - 1]`. La validación (1) sola no detecta un `CH99` aislado si hay pocas filas totales; se necesitan ambas. Sigue sin implementarse (solo documentado), como en toda esta etapa.

---

## 7. Validación del agrupamiento de LAZO — resultado con evidencia real

Se verificó con datos reales de `02_MASTER_IO_620.xlsm` el caso pedido explícitamente: válvula con switches y solenoides asociados.

**Caso verificado**: `620-HV-5084` (válvula cuchilla neumática).

- El instrumento `620-HV-5084` **existe** como registro completo en `MASTER_INSTRUMENTOS` (con su propio `PnPID`, P&ID, descripción) — pero **no posee ninguna señal propia**: 0 de 26 instrumentos "agrupadores" analizados tienen una fila donde `TAG_INSTRUMENTO = TAG_INSTRUMENTO_ASOCIADO`.
- Sus 5 señales reales vienen de 5 instrumentos accesorios distintos, cada uno dueño directo de su propia señal:

| Instrumento dueño | Señal | `TAG_INSTRUMENTO_ASOCIADO` |
|---|---|---|
| `620-HS-5084` (selector) | `620-HV-5084_REM` | `620-HV-5084` |
| `620-ZSO-5084` (switch abierto) | `620-HV-5084_ZIO` | `620-HV-5084` |
| `620-ZSC-5084` (switch cerrado) | `620-HV-5084_ZIC` | `620-HV-5084` |
| `620-HYO-5084` (solenoide apertura) | `620-HV-5084_HYO` | `620-HV-5084` |
| `620-HYC-5084` (solenoide cierre) | `620-HV-5084_HYC` | `620-HV-5084` |

**Resultado de la consulta** `SEÑAL WHERE instrumento_agrupador_id = (620-HV-5084)`: recupera **exactamente** las 5 señales — coincide al 100% con lo que un ingeniero esperaría ver en el diagrama de lazo de esa válvula. La regla `SEÑAL.instrumento_agrupador_id → INSTRUMENTO → LAZO` **funciona directamente, sin reglas adicionales, vistas ni relaciones nuevas**.

**Hallazgo adicional relevante (no una falla, una confirmación)**: se verificó también agrupar por `PLANO_LAZO` (el plano/dibujo) en vez de por `TAG_INSTRUMENTO_ASOCIADO`, y **31 de 36 planos analizados mezclan señales de más de un instrumento agrupador distinto** (ej. el plano `620-J-30017` contiene tanto el grupo de `620-HV-5084` como una señal suelta de `620-FIT-5047`, un transmisor de flujo no relacionado). Esto **confirma** — no contradice — la regla ya aprobada de que `PLANO` y `LAZO` son conceptos distintos con cardinalidad `1:N` (un plano contiene varios lazos): agrupar por plano habría mezclado incorrectamente dos lazos distintos en una sola consulta. Se documenta como advertencia operativa: **nunca usar `PLANO_LAZO` como sustituto de `instrumento_agrupador_id` al construir reportes o vistas** — daría resultados incorrectos.

**Conclusión**: no se requiere ningún cambio al modelo para este punto.

---

## 8. Cambios ya aplicados (acumulado de todas las rondas de auditoría)

- `MODELO_LOGICO_SIEI.md`: `SEÑAL.puerto_id` retirado, entidad `ENLACE_COM` agregada, `PUERTO`/`EQUIPO` sincronizados; `CAT_TIPO_IO` restringido a tipos físicos, nuevo `CAT_DIRECCION_COM`, `SEÑAL.tipo_io_id` ya no `NOT NULL`, `SEÑAL.direccion_com_id` agregada; nota `PLANO_LAZO ≠ LAZO` agregada a la entidad `LAZO`; **nueva entidad `PUNTO_CONEXION`** con pertenencia XOR (`instrumento`/`equipo`/`caja`/`rio`/`modulo`); `TRAMO_CONEXION.caja_id` eliminado, reemplazado por `punto_origen_id`/`punto_destino_id`.
- `MODELO_FISICO_SIEI.md`: `TR_canal_validar_capacidad` corregido (cantidad **y** rango); `activo` agregado a `ruta_conexion`/`tramo_conexion` con índices únicos filtrados y `TR_ruta_conexion_desactivar_tramos`; `CK_senal_tipo_io_direccion_excl` agregado; **`punto_conexion` especificada e implementada en el diseño** (sección 6.7); `TR_tramo_conexion_validar_secuencia` con alcance ampliado (continuidad de puntos, extremos válidos); alimentación eléctrica confirmada como diferida (6.8).
- `MATRIZ_COBERTURA_DATOS_SIEI.md`: `TAG_WSP` reclasificado explícitamente como `DIFERIDO` (sin agregar columna); clasificación directo/catálogo/derivable/diferido para los 6 atributos de instrumento (sección 2.1b); brecha de terminaciones marcada como resuelta (sección 3).

## 9. Cambios que NO se aplicaron — no bloquean `001_initial_schema.sql`

1. **Alimentación eléctrica del instrumento** como dominio de ruta separado (`RUTA_ALIMENTACION`) — explícitamente diferido a una etapa dedicada, no descartado (`MODELO_FISICO_SIEI.md` 6.8).
2. Atributos de instrumento sin columna ni catálogo: `posicion_normal`, `posicion_falla`, `alimentacion`, `protocolo`, `observacion` — clasificados en la sección 2.1b, ninguno implementado todavía. (`funcionamiento`/`cuerpo_instrumento`, listados originalmente junto a estos como "candidatos a catálogo", sí se implementaron en la migración 004 — ver sección 11 — como texto libre, no catálogo.)

## 10. Corrección de esta ronda — EQUIPO en PUNTO_CONEXION

✅ **Aplicado**: `EQUIPO` ya participa en la pertenencia de `PUNTO_CONEXION` (antes excluido por error — contradecía la regla ya confirmada de que una señal `CONTROL` con dueño `EQUIPO` también tiene conexionado físico). No cambia la cobertura de campos de Excel (no hay columnas nuevas involucradas, es una corrección de integridad estructural) — se documenta aquí solo para no perder el rastro del cambio.

Con la resolución de terminaciones, **no queda ninguna decisión estructural crítica pendiente** para generar `001_initial_schema.sql`.

## 11. Importación P&ID real (migración 004) — TAG_ANTERIOR y nuevos campos de instrumento

Al construir el módulo de importación real desde el reporte P&ID/Plant 3D (`database/migrations/004_pnid_import.sql`), se verificaron y cerraron varias filas que esta matriz dejaba pendientes:

- **`TAG_WSP` → `TAG_ANTERIOR`**: ver la fila actualizada en la sección 2 más arriba. Implementado como `nucleo.instrumento.tag_anterior`.
- **`funcionamiento` / `cuerpo_instrumento`** (sección 2.1b, antes "candidatos a catálogo, ninguno implementado"): implementados como `NVARCHAR` de texto libre, **sin catálogo**, por decisión explícita — la muestra real (1 solo proyecto, ~9% de filas pobladas, 3 y 4 valores únicos respectivamente) no alcanza para confirmar una lista cerrada universal; queda abierto para revisitar si un catálogo se justifica con evidencia de más proyectos.
- **`TECNOLOGIA`** (sección 2.1, "descriptivo, hoy sin columna"): implementado como `nucleo.instrumento.tecnologia NVARCHAR(100)`, texto libre.
- **`CONEXION_PROCESO`**: implementado como `nucleo.instrumento.conexion_proceso NVARCHAR(100)`.
- **`EQUIPO_ASOCIADO`** (sección 2, nota 🟡 — "distinto del concepto ya decidido de EQUIPO sin relación con INSTRUMENTO"): implementado como `equipo_asociado_id` (FK compuesta opcional a `nucleo.equipo`) + `equipo_asociado_tag` (texto literal del P&ID, siempre conservado). Se confirmó explícitamente que esta es una relación distinta de `senal.equipo_id` — "a qué equipo de proceso sirve el instrumento" vs. "qué equipo origina la señal" — y que no reabre la decisión de la ronda conceptual.
- **`PLANO_PNID`** (`DWG Number`) y **`LINEA` a nivel de instrumento** (`Line`, sección 2.1 nota "ambigüedad a resolver"): implementados como `plano_pnid NVARCHAR(30)` y `linea_pnid NVARCHAR(100)` — el sufijo `_pnid` es deliberado, para dejar explícito que es la línea/plano *del P&ID*, sin asumir que coincide con ningún concepto de línea a nivel de señal si llegara a existir uno.
- **`TIPO_SENAL`** del reporte P&ID (no es una fila previa de esta matriz — es una columna real del reporte de Plant 3D no anticipada en las rondas anteriores): implementado como `tipo_senal_pnid NVARCHAR(50)`, texto libre, **sin FK a ningún catálogo de señales** y **sin crear filas en `nucleo.senal`** — es una anotación del P&ID sobre la naturaleza esperada de una futura señal, no la interfaz real de una señal ya modelada (mismo principio que ya advertía `MODELO_CONCEPTUAL_SIEI.md` sección 3 sobre `TIPO_SENAL` como columna única ambigua, aplicado acá a un caso nuevo).

Ninguno de estos campos se sincroniza automáticamente si su columna no está presente en un reporte dado — ver `CLAUDE.md` sección "P&ID / Plant 3D import" para la estrategia completa de columnas conocidas/desconocidas/ausentes.
