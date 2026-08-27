# Modelo conceptual del núcleo de SIEI

Etapa: **modelo conceptual** (entidades, propósito y cardinalidades). **No** es un modelo físico: no incluye tablas, columnas, tipos de dato, índices ni claves técnicas. Se basa en las reglas de negocio confirmadas durante la etapa de descubrimiento, documentadas en `ANALISIS_EXCEL_SIEI.md` (entregado por chat durante la conversación de análisis de los Excel de referencia; no versionado todavía en este repositorio — pregunta pendiente si conviene incorporarlo también a `docs/`).

**Nota de sincronización**: este documento se corrigió para no contradecir `MODELO_FISICO_SIEI.md` (referencia vigente ante cualquier contradicción). Correcciones aplicadas: SWITCH ya no se modela como una hipótesis de EQUIPO — es una entidad propia (2.11c); las señales de comunicaciones ya no se conectan directo a PUERTO — lo hacen a través de `EQUIPO`/`INSTRUMENTO → ENLACE_COM → PUERTO → SWITCH` (2.11d); `CONEXIONADO` ya no está limitado a 0..2 tramos (2.15); se agregó `PUNTO_CONEXION` como el punto real donde termina cada tramo, perteneciente por XOR a `INSTRUMENTO`/`CAJA`/`RIO`/`MÓDULO` (2.14b); se agregó `CLASE_SEÑAL` como clasificación explícita CONTROL/COM (2.6b). No se rediseñó nada más — el resto del modelo conceptual permanece igual.

**Leyenda de confianza** (igual que en el análisis funcional):
- 🔵 **Regla confirmada** por el usuario — prevalece sobre cualquier otra consideración.
- 🟢 **Evidencia** estructural de los Excel analizados, no contradicha por ninguna regla confirmada.
- 🟡 **Hipótesis** — no determinada todavía; no bloquea el modelo conceptual pero debe resolverse antes o durante el diseño físico.

---

## 1. Alcance de este modelo

Concepto raíz: **PROYECTO** (todo el núcleo cuelga, directa o transitivamente, de un proyecto — 🔵 datos de ingeniería exclusivos por proyecto).

Entidades cubiertas: `CLIENTE, PROYECTO, INSTRUMENTO, EQUIPO, SEÑAL, TIPO/CLASIFICACIÓN DE SEÑAL, RIO, RACK, SLOT, MÓDULO, CANAL, PUERTO, CAJA, CABLE, PAR/CONDUCTOR, CONEXIONADO, LAZO` sobre la lista mínima pedida, más las extensiones agregadas durante el diseño físico y ahora sincronizadas aquí: `SWITCH` (2.11c), `ENLACE_COM` (2.11d), `PUNTO_CONEXION` (2.14b), `CLASE_SEÑAL` (2.6b).

Explícitamente **fuera de alcance** en este documento (se modelarán en sus propios módulos más adelante): Matriz Causa-Efecto, Trazabilidad/Ingeniería previa, Documentos/Entregables/Revisiones, atributos definitivos de Cliente/Proyecto (etapas, alcance contractual, disciplinas, convenciones de nomenclatura).

---

## 2. Entidades

### 2.1 CLIENTE

**Propósito**: organización/empresa contratante, dueña de uno o más proyectos gestionados en SIEI. Es el nivel más alto de agrupación organizacional del modelo.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | 1 : N | 🔵 confirmada (un cliente puede tener múltiples proyectos) |

🔵 **Confirmado**: todo proyecto requiere obligatoriamente un cliente — no existe proyecto sin cliente asociado. Atributos propios de CLIENTE (razón social, código interno, etc.) quedan diferidos al módulo Cliente/Proyecto.

---

### 2.2 PROYECTO

**Propósito**: contexto que delimita y aísla los datos de ingeniería de un trabajo específico; unidad central de particionamiento de todo el modelo (soporte multiproyecto).

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| CLIENTE | N : 1 (obligatorio) | 🔵 confirmada |
| INSTRUMENTO | 1 : N | 🔵 confirmada |
| EQUIPO | 1 : N | 🔵 confirmada |
| RIO | 1 : N | 🔵 confirmada |
| CAJA | 1 : N | 🔵 confirmada |
| CABLE | 1 : N | 🔵 confirmada |
| LAZO | 1 : N | 🔵 confirmada |

`SEÑAL`, `RACK`, `SLOT`, `MÓDULO`, `CANAL`, `PAR/CONDUCTOR` y `CONEXIONADO` heredan el proyecto **transitivamente** a través de su entidad padre — no necesitan una relación directa propia con PROYECTO a nivel conceptual (si conviene como atajo de consulta a nivel físico es una decisión de diseño posterior, no una regla de negocio).

🔵 **Confirmado**: el prefijo del TAG **no** determina el proyecto — la pertenencia a PROYECTO es siempre un dato explícito en cada entidad, nunca inferido de un texto.

🟡 **Fuera de alcance de este modelo** (diferido): estructura de etapas/alcance contractual (Ingeniería/Procura/Construcción) como sub-conceptos de PROYECTO.

---

### 2.3 INSTRUMENTO

**Propósito**: dispositivo de campo con identidad de ingeniería propia (transmisor, válvula, switch de posición, solenoide, manómetro, etc.), normalmente originado desde el P&ID, que puede originar una o más señales y ser el punto de anclaje de un lazo.

**Relaciones**:
| Con | Cardinalidad | Rol | Estado |
|---|---|---|---|
| PROYECTO | N : 1 | — | 🔵 confirmada |
| SEÑAL | 1 : 0..N | "dueño directo" de la señal | 🔵 confirmada (uno de los dos orígenes posibles de una señal) |
| SEÑAL | 1 : 0..N | "conjunto funcional / agrupador de lazo" (vía `TAG_INSTRUMENTO_ASOCIADO`) | 🔵 confirmada y validada con ejemplos reales (`620-HV-5075/5084` agrupando switches y solenoides) |
| LAZO | 0..1 : 1 | — | 🔵 confirmada, **incluyendo la opcionalidad**: no todo instrumento tiene lazo. Casos confirmados sin lazo: instrumentos cuya señal es por comunicación (COM), e instrumentos que pertenecen a un equipo *vendor* (paquete de un proveedor, ya integrado/probado por el fabricante, donde SIEI no genera diagrama de lazo propio). |

🔵 **Confirmado**: `TAG_INSTRUMENTO` es único **dentro del proyecto**, no globalmente en SIEI, y **no** es la clave primaria interna — el instrumento se identifica internamente por un id propio, independiente del tag.

🔵 **Confirmado**: `PnPID` es un identificador **externo**, de una fuente de importación concreta (ej. Plant 3D en el proyecto 620) — es un atributo/referencia externa del instrumento, no su identidad interna ni una entidad propia.

**Nota de diseño importante**: no existe relación directa `INSTRUMENTO → CAJA` ni `INSTRUMENTO → RIO`. La ruta física de una señal se obtiene siempre recorriendo `SEÑAL → CONEXIONADO → …`, nunca como atajo almacenado en INSTRUMENTO.

---

### 2.4 EQUIPO

**Propósito**: activo de planta/tablero que no es un instrumento de campo en sentido ISA (ej. variador de velocidad, relé de protección de motor, UPS), pero que puede originar señales — típicamente de estado eléctrico o de comunicaciones. 🔵 **No incluye infraestructura de comunicaciones** (switches de red) — esa es `SWITCH`, una entidad propia, ver 2.11c.

**Relaciones**:
| Con | Cardinalidad | Rol | Estado |
|---|---|---|---|
| PROYECTO | N : 1 | — | 🔵 confirmada |
| SEÑAL | 1 : 0..N | "dueño directo" de la señal | 🔵 confirmada |
| INSTRUMENTO | *(ninguna)* | — | 🔵 confirmado explícitamente: **EQUIPO no se relaciona con INSTRUMENTO** |
| LAZO | *(ninguna)* | — | 🔵 confirmado explícitamente: **EQUIPO no tiene lazo** — los lazos son exclusivos de instrumentos |

🔵 **Confirmado**: una señal originada en un EQUIPO sí participa igual del conexionado físico (cable/caja/canal) que una originada en un INSTRUMENTO — la diferencia entre ambos orígenes está en el "dueño" de la señal y en que solo el camino vía INSTRUMENTO habilita la agrupación en LAZO; el conexionado en sí es una relación de la SEÑAL, no del INSTRUMENTO/EQUIPO.

---

### 2.5 SEÑAL

**Propósito**: unidad atómica de información de instrumentación y control — un punto de dato individual (una medición, un estado, una alarma, un mando) que se origina en un instrumento o en un equipo, tiene una clasificación de tipo, y puede tener una ruta física de conexionado hacia el sistema de control.

**Relaciones**:
| Con | Cardinalidad | Rol | Estado |
|---|---|---|---|
| INSTRUMENTO **o** EQUIPO | N : 1 | "dueño directo" — **mutuamente excluyente (XOR)** | 🔵 confirmada |
| INSTRUMENTO | N : 0..1 | "conjunto funcional / agrupador de lazo" | 🔵 confirmada (exclusivo de INSTRUMENTO, nunca EQUIPO) |
| CLASE_SEÑAL | N : 1 | clasificación explícita CONTROL/COM — ver 2.6b | 🔵 confirmada — no se infiere de otros atributos |
| TIPO/CLASIFICACIÓN DE SEÑAL | N : 1 (×2 o ×3 catálogos según clase) | ver 2.6 | 🔵 confirmada la distinción |
| CANAL | 1 : 0..1 | — (exclusivo de señales CONTROL) | 🔵 confirmada (relación 1:1 cuando el canal está ocupado; ver 2.10) |
| CONEXIONADO | 1 : 0..N | — (exclusivo de señales CONTROL) | 🔵 confirmada — cantidad de tramos sin tope estructural (corregido; antes se documentaba un tope de 2, ver 2.15) |
| LAZO | N : 0..1 | — | 🔵 confirmada (una señal pertenece a lo sumo a un lazo, a través de su instrumento agrupador) |

🔵 **Confirmado**: una señal puede originarse en un INSTRUMENTO **o** en un EQUIPO, nunca en ambos a la vez.

🟡 **Hipótesis**: una señal cuyo dueño directo es un EQUIPO (sin instrumento agrupador) — ¿puede de todas formas tener `LAZO`, o el concepto de lazo queda automáticamente excluido para ella? Se deduce que sí queda excluida (LAZO depende de INSTRUMENTO), pero no está dicho explícitamente para el caso borde de una señal-de-equipo aislada.

---

### 2.6 TIPO / CLASIFICACIÓN DE SEÑAL

**Propósito**: en el Excel actual, varios conceptos distintos se mezclaban bajo el nombre `TIPO_SENAL`. El modelo de SIEI los separa explícitamente en catálogos de clasificación relacionados con SEÑAL:

1. **Tipo de I/O físico** (`TIPO_IO`): `DI / DO / AI / AO / RTD` — 🔵 **corregido**: exclusivamente para señales `CONTROL`, ya no incluye `IN`/`OUT`.
2. **Tipo/característica de la señal o interfaz** (`TIPO_INTERFAZ`): `4-20 mA`, `4-20 mA + HART`, `120 VAC`, `COMUNICADA`, y otros según el proyecto.
3. **Dirección de comunicación** (`DIRECCION_COM`) — 🔵 **nuevo catálogo**: `IN`/`OUT`, exclusivo de señales `COM`. Se separó de `TIPO_IO` porque son conceptos de negocio distintos (uno describe hardware físico, el otro dirección de un dato en red) — evidencia real: el propio Excel llegó a clasificar por error una señal COM como `AI`, mezclando ambos.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| SEÑAL (catálogo 1: tipo I/O) | 1 : 0..N | 🔵 opcional — solo señales CONTROL |
| SEÑAL (catálogo 2: tipo de interfaz) | 1 : N | 🔵 confirmada (aclaración: `TIPO_SENAL` no es AI/AO/DI/DO) |
| SEÑAL (catálogo 3: dirección de comunicación) | 1 : 0..N | 🔵 opcional — solo señales COM |

🔵 **Confirmado**: todos son catálogos universales de SIEI (no configurables por proyecto/cliente) — ver `MODELO_FISICO_SIEI.md` sección 2.7, que cierra la pregunta que aquí quedaba abierta.

---

### 2.6b CLASE_SEÑAL (extensión: clasificación explícita CONTROL / COM)

**Propósito**: 🔵 **confirmado**: SIEI no debe inferir si una señal es de control o de comunicaciones a partir de `TIPO_IO`/`DIRECCION_COM`/`CANAL`/`TIPO_INTERFAZ` — debe existir una clasificación explícita, independiente y obligatoria en toda señal.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| SEÑAL | 1 : N (obligatoria) | 🔵 confirmada |

Valores iniciales: `CONTROL` (señales cableadas/hardwired — usan `TIPO_IO`, `CANAL`, `CONEXIONADO`) y `COM` (señales comunicadas — usan `DIRECCION_COM`, `ENLACE_COM`/`PUERTO`/`SWITCH`, nunca `CANAL` ni `CONEXIONADO`). Catálogo universal, mismo tratamiento que el resto de `CAT_*`.

---

### 2.7 RIO

**Propósito**: gabinete/panel de entrada-salida remota (Remote I/O) — punto de concentración físico de tarjetas de control en campo, que se conecta al sistema de control central.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | N : 1 | 🔵 confirmada |
| RACK | 1 : N | 🟢 evidencia estructural (jerarquía RIO→chasis→slot→módulo→canal vista en los 5 Excel) |
| CONEXIONADO | 1 : 0..N | 🟢 evidencia (destino final de los tramos que llegan al panel) |

---

### 2.8 RACK (chasis)

**Propósito**: subdivisión física dentro de un RIO — el bastidor/chasis que aloja los módulos de I/O (visto en Excel como "CHASIS 0", "CHASIS 1", etc.).

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| RIO | N : 1 | 🟢 evidencia |
| SLOT | 1 : N | 🟢 evidencia |

---

### 2.9 SLOT

**Propósito**: posición física dentro de un rack/chasis donde se instala (o podría instalarse) un módulo de I/O.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| RACK | N : 1 | 🟢 evidencia |
| MÓDULO | 1 : 0..1 | 🟢 evidencia (un slot puede estar vacío o tener un módulo instalado) |

---

### 2.10 MÓDULO

**Propósito**: tarjeta física de I/O instalada en un slot; su modelo de hardware determina su tipo (DI/DO/AI/AO/RTD) y su capacidad de canales.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| SLOT | N : 1 | 🟢 evidencia |
| CANAL | 1 : N | 🔵 confirmada (la cantidad depende del modelo/catálogo de hardware, **no** es una regla fija universal por tipo de I/O — ej. hoy DI/DO=16, AI/AO=8, pero eso es característica del módulo, no constante de SIEI) |

🟡 **Hipótesis**: si el "modelo de módulo" (fabricante, referencia, canales máximos por tipo) debe modelarse como un catálogo de referencia propio (`CATÁLOGO_MODULO`) relacionado con MÓDULO, o si basta con que MÓDULO tenga esa característica embebida — no es una entidad pedida explícitamente en el alcance de este documento, se deja como nota para el diseño físico.

---

### 2.11 CANAL

**Propósito**: punto físico de conexión de I/O dentro de un módulo (ej. canal 0 a 15) — la unidad más pequeña de la jerarquía `RIO → RACK → SLOT → MÓDULO → CANAL`, y el punto donde una señal físicamente "entra" al sistema de control.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| MÓDULO | N : 1 | 🟢 evidencia |
| SEÑAL | 1 : 0..1 | 🔵 confirmada — **un canal recibe una sola señal** (1:1 estricto cuando está ocupado); dos señales en el mismo canal vigente = conflicto/inconsistencia, no un caso válido |

**Decisión conceptual**: no se modela una entidad "IO" separada — la asignación de I/O física es directamente la relación `SEÑAL ── CANAL`. Esto simplifica una hipótesis que había quedado abierta en la ronda anterior del análisis (`SEÑAL──IO──CANAL`), colapsándola en una sola relación directa. Esta relación aplica **solo a señales de control** (hardwired); las señales de comunicaciones usan `PUERTO` en su lugar — ver 2.11b.

---

### 2.11b PUERTO (extensión: conectividad de señales de comunicaciones)

🔵 **Regla confirmada**: las señales de comunicaciones (COM) **no** se conectan a un `CANAL` como las señales de control, y **no** usan el dominio de `CONEXIONADO`/`CABLE`/`PAR-CONDUCTOR` — usan una infraestructura de comunicaciones separada (ver 2.11c/2.11d). El cable de una señal COM suele ser un **patch/cable de red que concentra varias señales** sobre una misma conexión física.

**Propósito de `PUERTO`**: punto de conexión de red (ej. puerto de un switch industrial) — el equivalente funcional de `CANAL` para señales de comunicaciones, pero con una diferencia clave: **puede concentrar varias señales a la vez**, no una sola.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| SWITCH | N : 1 | 🔵 **corregido** — ver 2.11c: `SWITCH` es una entidad propia, no una instancia de `EQUIPO` |
| ENLACE_COM | 1 : 0..1 | 🔵 un puerto está en uso por, a lo sumo, un enlace activo a la vez — ver 2.11d |

🔵 **Corregido**: `SEÑAL` **ya no se conecta directo a `PUERTO`** — se conecta a través de su dueño (`EQUIPO`/`INSTRUMENTO`), que a su vez tiene un `ENLACE_COM` hacia el `PUERTO`. Varias señales del mismo equipo comparten así el mismo puerto sin repetir la relación por cada una — ver 2.11d.

---

### 2.11c SWITCH (extensión: infraestructura de comunicaciones)

🔵 **Regla confirmada**: un switch de red es **infraestructura de comunicaciones**, no un `EQUIPO` de proceso/control ni un subtipo de `EQUIPO` — queda como entidad propia, sin relación con `INSTRUMENTO` ni `LAZO`.

**Propósito**: dispositivo de red que expone puertos usados por señales comunicadas.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | N : 1 | 🔵 confirmada |
| PUERTO | 1 : N | 🔵 confirmada |

---

### 2.11d ENLACE_COM (extensión: conexión física entre EQUIPO/INSTRUMENTO y PUERTO)

**Propósito**: 🔵 confirmado con evidencia real (varias señales COM de un mismo equipo comparten idéntico medio físico) — el enlace de comunicaciones pertenece al **equipo o instrumento**, no a cada señal individual. Es el punto donde se concentra qué puerto/switch usa un equipo, y todas sus señales COM lo heredan.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| EQUIPO **o** INSTRUMENTO | 0..1 : 1 | mutuamente excluyente (XOR), mismo patrón que el origen de SEÑAL | 🔵 confirmada — el caso INSTRUMENTO es minoritario (instrumento con red nativa, sin equipo intermedio) |
| PUERTO | N : 1 | 🔵 confirmada |

Conceptualmente: `SEÑAL (COM) ── EQUIPO/INSTRUMENTO (mismo dueño del origen) ── ENLACE_COM ── PUERTO ── SWITCH`.

---

### 2.12 CAJA

**Propósito**: caja de conexiones / junction box intermedia en campo, donde convergen los cables de una o varias señales antes de continuar hacia el RIO. Es **opcional** en la ruta de una señal.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | N : 1 | 🔵 confirmada |
| PUNTO_CONEXION | 1 : 0..N | 🔵 **corregido** — la caja ya no se relaciona directo con `CONEXIONADO`; sus puntos de terminación existen como `PUNTO_CONEXION` propios (ver 2.14b), y `CONEXIONADO` los referencia a través de ellos |

🔵 **Confirmado**: no existe relación directa `CAJA ── INSTRUMENTO` ni `CAJA ── RIO` — la caja participa siempre a través de sus `PUNTO_CONEXION`.

---

### 2.13 CABLE

**Propósito**: elemento físico de cableado (con una capacidad de conductores/pares determinada) que transporta una o más señales a lo largo de un tramo de la ruta de conexionado (instrumento/equipo↔caja, caja↔RIO, o instrumento/equipo↔RIO directo).

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | N : 1 | 🔵 confirmada |
| PAR/CONDUCTOR | 1 : N | 🔵 confirmada — cable multiconductor/multipar |
| CONEXIONADO | 1 : N | 🔵 confirmada — un mismo cable físico puede materializar el tramo de varias señales distintas (cada una por su propio par), por eso `CABLE ── CONEXIONADO` es 1:N y no 1:1 |

🔵 **Confirmado explícitamente**: **no** debe modelarse `CABLE → 1 SEÑAL` — un cable puede transportar varias señales mediante sus pares/conductores.

---

### 2.14 PAR / CONDUCTOR

**Propósito**: unidad interna de un cable multiconductor/multipar — el hilo, par trenzado o conductor específico dentro de un cable físico, que efectivamente transporta la señal en un tramo de conexionado. Puede estar libre (de reserva) o asignado.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| CABLE | N : 1 | 🔵 confirmada |
| CONEXIONADO | 1 : 0..1 | 🟢/🔵 — un par se usa, como máximo, en un tramo/señal a la vez; puede no estar asignado (par de reserva) |

---

### 2.14b PUNTO_CONEXION (extensión: terminación física real)

**Propósito**: 🔵 confirmado — extremo físico real de una conexión (una regleta/bornera/borne concreto), necesario para representar conexionados de RIO/caja y diagramas de lazo con el detalle real de dónde termina cada tramo, sin depender solo de "qué cable/par" usa.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| INSTRUMENTO **o** EQUIPO **o** CAJA **o** RIO **o** MÓDULO | 0..N : 1 | pertenencia mutuamente excluyente (XOR) | 🔵 confirmada — ✅ **`EQUIPO` corregido en esta ronda**: una señal `CONTROL` cuyo dueño directo es un `EQUIPO` también participa del conexionado físico (ya confirmado en 2.4), así que necesita su propio punto de origen — excluirlo era una contradicción con esa regla ya aprobada. 🔵 **RIO y MÓDULO son pertenencias independientes**: una bornera puede ser del gabinete RIO sin ser de un módulo de I/O específico |
| CONEXIONADO | 1 : 0..N | 🔵 confirmada — un punto puede ser origen o destino de varios tramos a lo largo del tiempo. El punto de origen del primer tramo de una ruta debe ser, exactamente, el dueño real de la señal (el mismo `INSTRUMENTO`/`EQUIPO`, no cualquiera) |

---

### 2.15 CONEXIONADO

**Propósito**: entidad "puente" que materializa **un tramo** de la ruta física de una señal, entre dos `PUNTO_CONEXION`. Es el mecanismo por el cual se reconstruye la ruta completa de una señal (instrumento → [caja opcional] → RIO/módulo) **sin** que la señal, el instrumento o la caja tengan campos redundantes — la ruta se obtiene siempre recorriendo el conexionado, nunca leyendo un atajo almacenado en otra entidad.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| SEÑAL | N : 1 | 🔵 confirmada — cada tramo pertenece a una señal; una señal tiene 0..N tramos |
| CABLE | N : 1 | 🔵 confirmada — cada tramo recorre un cable físico |
| PAR/CONDUCTOR | N : 1 | 🔵 confirmada — el tramo usa específicamente ese par/conductor dentro del cable |
| PUNTO_CONEXION (origen) | N : 1 | 🔵 **corregido** — reemplaza la relación directa a `CAJA` |
| PUNTO_CONEXION (destino) | N : 1 | 🔵 **corregido** — reemplaza la relación directa a `CANAL`; si el punto de destino pertenece a una `CAJA`, el tramo es intermedio; si pertenece a `RIO`/`MÓDULO`, es el tramo final |

**Cardinalidad clave que resume toda la ruta**: `SEÑAL (1) ── (0..N) CONEXIONADO` 🔵 **corregido** — sin tope estructural de tramos (antes se documentaba un máximo de 2; el máximo observado hoy es un hecho de negocio actual, no una restricción de diseño). El caso hoy más común sigue siendo `Caso A` (instrumento → RIO directo, 1 tramo) o `Caso B` (instrumento → caja → RIO, 2 tramos).

🔵 **Nota de implementación** (sin afectar el nivel conceptual): en el modelo lógico/físico, `CONEXIONADO` se materializa como el par `RUTA_CONEXION` (cabecera por señal) + `TRAMO_CONEXION` (un tramo ordenado por fila) — ambos con soporte de historial (`activo`), de forma que una ruta que deja de estar vigente puede desactivarse conservando su registro, y el par/conductor que usaba queda libre para una ruta nueva.

---

### 2.16 LAZO

**Propósito**: conjunto documental/funcional que agrupa todas las señales relacionadas con **un** instrumento (incluidas las de su conjunto funcional asociado — ej. switches y solenoides de una válvula), usado para generar el entregable "diagrama de lazo". Tiene un identificador interno estable y, por separado, un código de documento visible.

**Relaciones**:
| Con | Cardinalidad | Estado |
|---|---|---|
| PROYECTO | N : 1 | 🔵 confirmada |
| INSTRUMENTO | N : 1 | 🔵 confirmada — **un lazo es siempre de un solo instrumento** (nunca de varios) |
| SEÑAL | 1 : N | 🔵 confirmada — un lazo agrupa varias señales (las del instrumento como dueño directo, más las de su conjunto funcional asociado) |

🔵 **Confirmado**: `código_documento_visible ≠ identificador_interno` — el lazo tiene un id técnico estable para relaciones internas, y por separado un código de documento (ej. de plano) visible para el usuario, que respeta convenciones de cliente/proyecto (diferidas al módulo de Documentos).

🔵 **Confirmado (nota de alcance, fuera de las 16 entidades pero relevante)**: un documento de tipo "plano de diagrama de lazo" puede contener **varios lazos** (`PLANO 1 : N LAZO`) — cada lazo sigue siendo de un único instrumento; varios instrumentos en un mismo plano son varios lazos distintos compartiendo un documento, no un lazo con varios instrumentos.

🟡 **Hipótesis**: si todo INSTRUMENTO tiene obligatoriamente un LAZO, o solo algunos (ver 2.3).

---

## 3. Qué conceptos de Excel NO deberían convertirse en entidades independientes

| Concepto en Excel | Por qué no es una entidad propia |
|---|---|
| `IMPORT_PNID` | ~~Staging efímero de una importación puntual — no es dato persistente del núcleo.~~ **🔵 Decisión sustituida (migración 004, `database/migrations/004_pnid_import.sql`)**: al construirse la importación real desde el reporte P&ID/Plant 3D, el snapshot de cada importación pasó a ser **persistente para siempre**, para auditoría — `integracion.importacion_pnid` / `importacion_pnid_fila` / `importacion_pnid_resultado`. La entrada original se conserva tachada, no se borra, para que quede constancia de que la decisión existió y por qué cambió: sin un caso de importación real todavía, "efímero" parecía suficiente; con el caso real, la trazabilidad de qué cambió y cuándo importa más que el ahorro de espacio. |
| `SENALES_CONTROL` / `SENALES_COM` (salidas de Power Query) | Son particiones por origen de una misma entidad `SEÑAL` — en SIEI, `SEÑAL` es una única entidad con atributos/clasificación (2.6), no dos tablas separadas por tipo de origen. |
| `MASTER_SENALES` (unión de las dos anteriores) | Colapsa igualmente en la entidad única `SEÑAL`; la capa de "estado de revisión" que trae podría ser un atributo de `SEÑAL`, pero la hoja en sí no es una entidad. |
| `RESUMEN_SENALES`, `RESUMEN_CONTEO_IO`, `RESUMEN`, `COMPARATIVO_WSP`, `LISTA_IO`, `LISTA_COM`, `DASHBOARD` | Reportes/vistas calculadas a partir del modelo — se generan, no se almacenan como entidades propias. |
| "WSP" | No es una entidad — es un caso particular del concepto genérico de "ingeniería previa/procedencia", diferido a un módulo de trazabilidad futuro, fuera de este núcleo. **🔵 Precisión (migración 004)**: el módulo general de "ingeniería previa/procedencia" sigue diferido — no se agregó ninguna columna `tag_wsp` ni nada específico de WSP como empresa. Lo que sí se implementó es un campo mucho más acotado y genérico, `tag_anterior` en `INSTRUMENTO` (columna `nucleo.instrumento.tag_anterior`), poblado desde la columna `Tag Anterior` del reporte P&ID — una referencia de "tag anterior según el P&ID", utilizable en cualquier proyecto, no un concepto WSP-específico. No reabre el módulo diferido; es un campo puntual que el import P&ID necesitaba ya. |
| `CODIGO_LAZO` como clave | No es la identidad interna del lazo — es su código de documento visible (ver 2.16), conceptualmente distinto del id interno. |
| `TAG_INSTRUMENTO` / `TAG_SENAL` como clave | Son atributos naturales y potencialmente mutables — la identidad interna de cada entidad es siempre un id propio, no el tag. |
| `TIPO_SENAL` como columna única | Debe descomponerse en (al menos) dos catálogos de clasificación relacionados con `SEÑAL` (ver 2.6), no una sola columna ambigua que mezcle tipo de I/O con tipo de interfaz. |
| `PnPID` como identidad universal | Es un atributo/referencia externa de `INSTRUMENTO`, específico de una fuente de importación — no una entidad ni la PK. |
| `VALIDACIONES` (log de auditoría) | Podría modelarse a futuro como un registro de eventos asociado a `INSTRUMENTO`/`SEÑAL`, pero no forma parte del núcleo estructural de este documento. |
| `Carátula` / `Índice` (portada de cada libro) | Son metadatos de documento/entregable — pertenecen conceptualmente a un futuro módulo de Documentos, no al núcleo de ingeniería. |
| `MATRIZ` (causa-efecto) | Diferido a su propio módulo (Matriz Causa-Efecto), no forma parte de este núcleo. |
| `CLAVE DE MÓDULO` (`gabinete|chasis|slot`, usada para conteo en `LISTA DE SEÑALES`) | Es una clave compuesta derivada para agregación/reporte — se resuelve navegando la jerarquía `RIO → RACK → SLOT → MÓDULO` ya modelada, no requiere entidad propia. |
| Hoja `EQUIPOS` (catálogo con `TAG_EQUIPO_INST`, `PANEL`, `SISTEMA`, `NODO`, `P&ID`) | Corresponde directamente a la entidad `EQUIPO` ya incluida en este modelo — no es un concepto adicional. |

---

## 4. Diagrama conceptual (Mermaid)

```mermaid
erDiagram
    CLIENTE ||--o{ PROYECTO : "🔵 1 cliente : N proyectos"

    PROYECTO ||--o{ INSTRUMENTO : "🔵"
    PROYECTO ||--o{ EQUIPO : "🔵"
    PROYECTO ||--o{ RIO : "🔵"
    PROYECTO ||--o{ CABLE : "🔵"
    PROYECTO ||--o{ CAJA : "🔵"
    PROYECTO ||--o{ LAZO : "🔵"

    INSTRUMENTO |o..o{ SEÑAL : "🔵 dueño directo (XOR con EQUIPO)"
    EQUIPO |o..o{ SEÑAL : "🔵 dueño directo (XOR con INSTRUMENTO)"
    INSTRUMENTO |o..o{ SEÑAL : "🔵 conjunto funcional / agrupador de lazo"
    INSTRUMENTO |o--o| LAZO : "🔵 1 lazo = 1 instrumento, opcional (no todo instrumento tiene lazo)"

    SEÑAL }o--|| CLASE_SEÑAL : "🔵 CONTROL o COM, obligatoria"
    SEÑAL }o--o| TIPO_IO : "🔵 opcional, solo CONTROL"
    SEÑAL }o--|| TIPO_INTERFAZ : "🔵"
    SEÑAL }o--o| DIRECCION_COM : "🔵 opcional, solo COM"

    SEÑAL |o--o| CANAL : "🔵 control, 1:1 estricto si ocupado"
    CANAL }o--|| MODULO : "🟢"
    MODULO }o--|| SLOT : "🟢"
    SLOT }o--|| RACK : "🟢"
    RACK }o--|| RIO : "🟢"

    INSTRUMENTO |o--o| ENLACE_COM : "🔵 XOR con EQUIPO, minoritario"
    EQUIPO |o--o| ENLACE_COM : "🔵 XOR con INSTRUMENTO"
    ENLACE_COM }o--|| PUERTO : "🔵"
    PUERTO }o--|| SWITCH : "🔵 SWITCH ≠ EQUIPO"

    SEÑAL |o..o{ CONEXIONADO : "🔵 0..N tramos, sin tope"
    CONEXIONADO }o--|| CABLE : "🔵"
    CONEXIONADO }o--|| PAR_CONDUCTOR : "🔵"
    CONEXIONADO }o--|| PUNTO_CONEXION : "🔵 origen"
    CONEXIONADO }o--|| PUNTO_CONEXION : "🔵 destino"
    INSTRUMENTO |o--o{ PUNTO_CONEXION : "🔵 XOR pertenencia"
    EQUIPO |o--o{ PUNTO_CONEXION : "🔵 XOR pertenencia"
    CAJA |o--o{ PUNTO_CONEXION : "🔵 XOR pertenencia"
    RIO |o--o{ PUNTO_CONEXION : "🔵 XOR pertenencia"
    MODULO |o--o{ PUNTO_CONEXION : "🔵 XOR pertenencia"
    CABLE ||--o{ PAR_CONDUCTOR : "🔵 multiconductor"

    LAZO ||--o{ SEÑAL : "🔵 agrupa varias señales"
```

---

## 5. Resumen de cardinalidades del núcleo

| Relación | Cardinalidad | Estado |
|---|---|---|
| CLIENTE ── PROYECTO | 1 : N, cliente obligatorio | 🔵 |
| PROYECTO ── INSTRUMENTO | 1 : N | 🔵 |
| PROYECTO ── EQUIPO | 1 : N | 🔵 |
| PROYECTO ── RIO / CAJA / CABLE / LAZO | 1 : N (cada una) | 🔵 |
| INSTRUMENTO ── SEÑAL (dueño directo) | 1 : 0..N | 🔵 |
| EQUIPO ── SEÑAL (dueño directo) | 1 : 0..N | 🔵 |
| INSTRUMENTO ── SEÑAL (dueño **o** equipo dueño) | XOR | 🔵 |
| INSTRUMENTO ── SEÑAL (conjunto funcional / lazo) | 1 : 0..N | 🔵 |
| EQUIPO ── INSTRUMENTO | *(sin relación)* | 🔵 |
| EQUIPO ── LAZO | *(sin relación)* | 🔵 |
| INSTRUMENTO ── LAZO | 0..1 : 1, **opcional** (no todo instrumento tiene lazo: instrumentos por COM o de equipo *vendor* no lo tienen) | 🔵 |
| LAZO ── SEÑAL | 1 : N | 🔵 |
| SEÑAL ── CLASE_SEÑAL | N : 1, obligatoria | 🔵 explícita, no inferida |
| SEÑAL ── TIPO_IO | N : 0..1 | 🔵 opcional, solo señales CONTROL |
| SEÑAL ── TIPO_INTERFAZ | N : 1 | 🔵 |
| SEÑAL ── DIRECCION_COM | N : 0..1 | 🔵 opcional, solo señales COM |
| SEÑAL ── CANAL (señales CONTROL) | 0..1 : 0..1 (1:1 si ocupado) | 🔵 |
| CANAL ── MÓDULO ── SLOT ── RACK ── RIO | N : 1 en cada nivel | 🟢 |
| MÓDULO ── CANAL | 1 : N (capacidad según catálogo hardware) | 🔵 |
| INSTRUMENTO/EQUIPO ── ENLACE_COM | 0..1 : 1, XOR | 🔵 (el enlace es del dueño de la señal COM, no de cada señal) |
| ENLACE_COM ── PUERTO | N : 1 | 🔵 |
| PUERTO ── SWITCH | N : 1 | 🔵 (SWITCH es entidad propia, no EQUIPO) |
| SEÑAL ── CONEXIONADO | 1 : 0..N, sin tope | 🔵 |
| CONEXIONADO ── CABLE | N : 1 | 🔵 |
| CONEXIONADO ── PAR/CONDUCTOR | N : 1 | 🔵 (dominio exclusivo de señales CONTROL — no aplica a cables de red/patch, resuelto) |
| CONEXIONADO ── PUNTO_CONEXION (origen/destino) | N : 1 (×2 roles) | 🔵 |
| INSTRUMENTO/EQUIPO/CAJA/RIO/MÓDULO ── PUNTO_CONEXION | 1 : 0..N, XOR | 🔵 |
| CABLE ── PAR/CONDUCTOR | 1 : N | 🔵 |
| CABLE ── CONEXIONADO | 1 : N | 🔵 |

---

## 6. Hipótesis — estado final

Todas las hipótesis que quedaban abiertas en este documento ya se resolvieron durante el diseño lógico/físico:

1. ✅ **Resuelta**: un switch de comunicaciones **no** se modela como `EQUIPO` — es la entidad propia `SWITCH` (2.11c), y la conexión pasa por `ENLACE_COM` (2.11d), no directo desde `SEÑAL`.
2. ✅ **Resuelta**: `PAR/CONDUCTOR` y `CONEXIONADO` **no** aplican a señales de comunicaciones — es un dominio exclusivo de señales `CONTROL` (2.6b). Las señales COM usan `ENLACE_COM`/`PUERTO`/`SWITCH`, sin conductor dedicado.
3. ✅ **Resuelta**: los catálogos (`TIPO_IO`, `TIPO_INTERFAZ`, `DIRECCION_COM`, `CLASE_SEÑAL`, catálogo de módulos de hardware) son **universales** para todo SIEI, no configurables por cliente/proyecto — confirmado en `MODELO_FISICO_SIEI.md` sección 2.7.

No quedan hipótesis abiertas pendientes en el modelo conceptual del núcleo. Las brechas de terminaciones detalladas (regleta/bornera/borne) y el dominio de alimentación eléctrica del instrumento, detectados en una auditoría posterior de cobertura de datos, se documentan en `MATRIZ_COBERTURA_DATOS_SIEI.md` — la primera ya está resuelta conceptualmente con `PUNTO_CONEXION` (2.14b); la segunda queda diferida a un módulo futuro.
