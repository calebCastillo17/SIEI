/**
 * Tipos que reflejan exactamente lo que devuelven hoy los endpoints del
 * backend (ver backend/src/routes/me.ts, projects.ts, instruments.ts) —
 * no son un contrato aspiracional, son lo que el código de esos archivos
 * realmente serializa.
 */

export type ProjectRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface ProjectPermissions {
  write: boolean;
  deactivate: boolean;
  administer: boolean;
}

/** Proyecto tal como aparece en GET /api/me (más liviano: sin name/active). */
export interface MeProjectAccess {
  id: string;
  codigo: string;
  role: ProjectRole;
  permissions: ProjectPermissions;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    nombre: string;
    esAdminSistema: boolean;
  };
  projects: MeProjectAccess[];
}

/** Proyecto tal como aparece en GET /api/projects y GET /api/projects/:id. */
export interface Project {
  id: string;
  clientId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  access: {
    role: ProjectRole;
    permissions: ProjectPermissions;
  };
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}

/**
 * Instrumento tal como lo devuelve GET (lista y detalle) — incluye las
 * columnas agregadas por la importación P&ID (ver database/migrations/
 * 004_pnid_import.sql y backend/src/routes/instruments.ts). `pnpid`,
 * `fuentePnpid` y `estadoPnidId` los administra solo el flujo de
 * importación (o acceso directo a la base): no viajan en InstrumentInput.
 */
export interface Instrument {
  id: string;
  projectId: string;
  estadoPnidId: string | null;
  tagInstrumento: string;
  pnpid: string | null;
  fuentePnpid: string | null;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
  tagAnterior: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  conexionProceso: string | null;
  planoPnid: string | null;
  lineaPnid: string | null;
  tipoSenalPnid: string | null;
  // listado (migración 044) — dato de contenido: false significa "se
  // guarda igual, pero no se muestra" (Master ni LDI), no un borrado.
  listado: boolean;
  equipoAsociadoId: string | null;
  equipoAsociadoTag: string | null;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
  /** Calculado (no una columna en la base, ver instruments.ts) — solo
   * GET lista/detalle lo devuelven, no viene en la respuesta de POST/PATCH
   * (que igual el frontend nunca renderiza directo, siempre refresca con
   * un GET después). true si algún otro instrumento activo lo señala como
   * su `instrumentoAsociadoId` — o sea, es la cabeza de un grupo. */
  esCabezaDeGrupo?: boolean;
  /** Calculado — el tag del PADRE del grupo al que pertenece este
   * instrumento (su propio tag si es cabeza, o `instrumentoAsociadoTag` si
   * es hijo). `null` si no pertenece a ningún grupo. */
  grupoTag?: string | null;
  /** Calculado, solo en GET lista — tags de los instrumentos HIJOS de
   * este (los que apuntan a este vía su propio `instrumentoAsociadoId`),
   * unidos por coma. Puramente de visualización para el listado del
   * Master con `soloPadres=true` — nunca se guarda, se recalcula siempre
   * al vuelo. `null` si no tiene hijos. */
  hijosTags?: string | null;
  /** Módulo Hojas de Datos (migraciones 030/032) — contexto compartido
   * (sitio/tubería) y la ficha técnica deduplicada, si esta señal ya fue
   * cargada desde una Hoja de Datos real. */
  sitioId: string | null;
  tuberiaId: string | null;
  fichaTecnicaId: string | null;
  fechaAgregado: string | null;
  fechaUltimaRevision: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface InstrumentsListResponse {
  projectId: string;
  instruments: Instrument[];
}

export interface InstrumentResponse {
  instrument: Instrument;
}

/**
 * POST/PATCH/DELETE de instrumentos devuelven un subconjunto de campos más
 * chico que GET (ver instruments.ts) — no se tipa como Instrument completo
 * para no fingir que trae campos que esas respuestas no incluyen. Solo se
 * usa `id`/`projectId` de la respuesta para navegar y luego se vuelve a
 * pedir el detalle completo con GET.
 */
export interface InstrumentMutationResponse {
  instrument: {
    id: string;
    projectId: string;
  };
}

/** DELETE .../instruments/:id con `{ eliminarDefinitivamente: true }`
 * (migración 011) — borrado físico real, solo permitido cuando el
 * instrumento tiene estado P&ID = NO_EXISTE_EN_PNID. Nunca vuelve a
 * existir. */
export interface InstrumentEliminacionResponse {
  eliminado: true;
  instrumentId: string;
  tagInstrumento: string;
  limpieza: {
    resultadosPnidBorrados: number;
    resultadosPnidDesvinculados: number;
    asociacionesInstrumentoAsociadoLimpiadas: number;
    filasRevisionEntregableDesvinculadas: number;
    /** Señales que tenían a este instrumento como dueño directo — quedan
     * activas con `duenoAusente: true` (migración 016), no se borran. */
    senalesMarcadasSinDueno: number;
    /** Señales que solo tenían a este instrumento como agrupador (no como
     * dueño) — se les limpia `instrumentoAgrupadorId`, sin marcarlas. */
    senalesAgrupadorDesvinculado: number;
    /** punto_conexion propio del instrumento, borrado físicamente (ya no
     * bloquea la eliminación como lazo/enlace_com). */
    puntosConexionEliminados: number;
    /** tramo_conexion que usaba esos puntos como origen/destino, borrado
     * físicamente junto con ellos. */
    tramosConexionEliminados: number;
    /** ruta_conexion que se quedó sin tramos activos por lo anterior —
     * se desactiva (no se borra), conservando el historial señal↔ruta. */
    rutasConexionDesactivadas: number;
  };
}

/**
 * Campos que POST/PATCH de instrumentos aceptan (ver instruments.ts).
 * `pnpid`/`fuentePnpid` NO están acá a propósito: el backend rechaza con
 * 400 si esas claves siquiera están presentes en el body — los administra
 * únicamente la importación P&ID.
 */
export interface InstrumentInput {
  tagInstrumento: string;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
  tagAnterior: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  conexionProceso: string | null;
  planoPnid: string | null;
  lineaPnid: string | null;
  tipoSenalPnid: string | null;
  // listado (migración 044) — dato de contenido: false significa "se
  // guarda igual, pero no se muestra" (Master ni LDI), no un borrado.
  // Opcional acá: el alta manual normal la omite y el backend la deja en
  // true por defecto — solo el importador P&ID (server-side) la fija en
  // false explícitamente.
  listado?: boolean;
  equipoAsociadoId: string | null;
  equipoAsociadoTag: string | null;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
}

/** Equipo tal como lo devuelve GET (ver equipment.ts). Catálogo curado a
 * mano — nunca se puebla automáticamente desde un reporte P&ID (migración
 * 007). `tipoEquipoCodigo`/`tipoEquipoNombre` vienen ya resueltos (join
 * contra cat.cat_tipo_equipo), igual patrón que otras entidades con un
 * catálogo referenciado. */
export interface Equipment {
  id: string;
  projectId: string;
  tagEquipo: string;
  descripcion: string | null;
  sistema: string | null;
  nodo: string | null;
  panel: string | null;
  planoPnid: string | null;
  tipoEquipoId: string | null;
  tipoEquipoCodigo: string | null;
  tipoEquipoNombre: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface EquipmentListResponse {
  projectId: string;
  equipment: Equipment[];
}

/** Instrumento con equipoAsociadoTag (texto del P&ID) pero sin
 * equipoAsociadoId todavía. A diferencia de tuberías, acá el P&ID nunca
 * escribe solo — esto es una SUGERENCIA que hay que aprobar a mano
 * (GET .../instruments/pendientes-equipo). */
export interface PendienteEquipo {
  instrumentId: string;
  tagInstrumento: string;
  equipoAsociadoTag: string;
  equipoSugeridoId: string | null;
  equipoSugeridoTag: string | null;
  equipoSugeridoDescripcion: string | null;
}

export interface PendientesEquipoResponse {
  projectId: string;
  pendientes: PendienteEquipo[];
}

export interface EquipmentResponse {
  equipment: Equipment;
}

/**
 * POST/PATCH/DELETE de equipos devuelven un subconjunto más chico que GET
 * (ver equipment.ts) — igual que instrumentos, solo se usa `id` de la
 * respuesta para navegar y se vuelve a pedir el detalle con GET.
 */
export interface EquipmentMutationResponse {
  equipment: {
    id: string;
    projectId: string;
  };
}

/** Campos que POST/PATCH de equipos aceptan (ver equipment.ts). */
export interface EquipmentInput {
  tagEquipo: string;
  descripcion: string | null;
  sistema: string | null;
  nodo: string | null;
  panel: string | null;
  planoPnid: string | null;
  tipoEquipoId: string | null;
}

/** cat.cat_tipo_equipo (migración 007) — catálogo global, solo lectura,
 * lista cerrada por ahora (ELECTRICO / INSTRUMENTACION). No reutiliza
 * CatalogItem: su columna de texto es `nombre`, no `descripcion`. */
export interface TipoEquipo {
  id: string;
  codigo: string;
  nombre: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface TiposEquipoResponse {
  items: TipoEquipo[];
}

/** Fila de cualquiera de los catálogos simples (ver lib/simpleCatalogRouter.ts). */
export interface CatalogItem {
  id: string;
  codigo: string;
  descripcion: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CatalogListResponse {
  items: CatalogItem[];
}

/** POST devuelve una forma más chica que GET: su OUTPUT INSERTED no trae
 * updated_at (ver simpleCatalogRouter.ts) — recién creado, siempre sería
 * null de todas formas, así que no se re-tipa como CatalogItem completo. */
export interface CatalogItemMutationResponse {
  item: {
    id: string;
    codigo: string;
    descripcion: string | null;
    createdAt: string;
  };
}

/** Body de POST para los 3 catálogos de dominio ABIERTO (interface-types,
 * com-types, com-media-types) — los otros 6 son de lista CERRADA, solo
 * lectura (ver lib/simpleCatalogRouter.ts). Sin PATCH/DELETE en ningún
 * caso: no hay `activo` para desactivar, y editar/borrar un código ya
 * referenciado rompería FKs existentes. */
export interface CatalogInput {
  codigo: string;
  descripcion: string | null;
}

export type SignalClassCode = 'CONTROL' | 'COM';

/** Señal tal como la devuelve GET (ver signals.ts serializeSignal). */
export interface Signal {
  id: string;
  projectId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  instrumentoAgrupadorId: string | null;
  claseSenalId: string;
  claseSenalCodigo: SignalClassCode;
  tipoIoId: string | null;
  tipoIoCodigo: string | null;
  direccionComId: string | null;
  direccionComCodigo: string | null;
  tipoInterfazId: string | null;
  canalId: string | null;
  estadoRevisionId: string | null;
  prioridadAlarmaId: string | null;
  tagSenal: string | null;
  codigoSenal: string | null;
  /** Migración 048 — último texto crudo de la columna "Tag" de la fila de
   * señal del reporte P&ID (ej. "S620-PI-5053"). Puramente informativo,
   * gestionado por el motor de reimportación de señales — no editable
   * desde este formulario. */
  tagPnid: string | null;
  /** Servicio DE LA SEÑAL (migración 028) — más granular que
   * instrumento.servicio; el único disponible cuando el dueño es un
   * equipo (nucleo.equipo no tiene columna servicio propia). Dato
   * manual, nunca derivado. */
  servicio: string | null;
  causaAlarma: boolean | null;
  tipoDatoComId: string | null;
  tipoDatoComCodigo: string | null;
  esLoopPowered: boolean | null;
  nombreCorto: string | null;
  descripcion: string | null;
  rangoMin: number | null;
  rangoMax: number | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  valorNormal: string | null;
  unidadIngenieria: string | null;
  retardo: string | null;
  enclavamiento: string | null;
  observacion: string | null;
  /** Migración 016 — true solo cuando el instrumento que era su dueño fue
   * eliminado definitivamente (nunca alcanzable de otra forma). */
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SignalsListResponse {
  projectId: string;
  signals: Signal[];
}

export interface SignalResponse {
  signal: Signal;
}

/**
 * POST/PATCH/DELETE de señales devuelven formas más chicas que GET en
 * algunos casos (ver signals.ts) — igual que con instrumentos, solo se usa
 * `id` de la respuesta para navegar y se vuelve a pedir el detalle con GET.
 */
export interface SignalMutationResponse {
  signal: {
    id: string;
    projectId: string;
  };
}

/**
 * Campos que POST/PATCH de señales aceptan (ver SIGNAL_FIELDS en
 * signals.ts). instrumentoId/equipoId son XOR: exactamente uno de los dos
 * al crear (lo exige CK_senal_origen_xor en la base).
 */
export interface SignalInput {
  tagSenal: string | null;
  claseSenalId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  instrumentoAgrupadorId: string | null;
  tipoIoId: string | null;
  direccionComId: string | null;
  tipoInterfazId: string | null;
  canalId: string | null;
  estadoRevisionId: string | null;
  prioridadAlarmaId: string | null;
  codigoSenal: string | null;
  /** Migración 048 — solo lectura, ver comentario en la interfaz Signal.
   * No forma parte de SIGNAL_FIELDS: aunque viaje en el payload, el
   * backend lo ignora si se intenta cambiar por acá. */
  tagPnid: string | null;
  servicio: string | null;
  causaAlarma: boolean | null;
  tipoDatoComId: string | null;
  esLoopPowered: boolean | null;
  nombreCorto: string | null;
  descripcion: string | null;
  rangoMin: number | null;
  rangoMax: number | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  valorNormal: string | null;
  unidadIngenieria: string | null;
  retardo: string | null;
  enclavamiento: string | null;
  observacion: string | null;
}

/* ---- Jerarquía física de E/S: GABINETE -> Rack -> Slot -> Módulo -> Canal
 * (GABINETE, ex RIO, migración 012 — RIO ya no es el concepto padre, es
 * uno de varios tipos posibles: RIO / CONTROL / COMUNICACION, ver
 * cat.cat_tipo_gabinete). --- */

export interface Gabinete {
  id: string;
  projectId: string;
  tagGabinete: string;
  /** Nomenclatura anterior del mismo gabinete físico, si existe evidencia
   * — nullable, no participa en identidad (mismo patrón que
   * instrumento.tagAnterior). */
  tagAnterior: string | null;
  descripcion: string | null;
  active: boolean;
  tipoGabineteId: string | null;
  tipoGabineteCodigo: string | null;
  tipoGabineteNombre: string | null;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface GabinetesListResponse {
  projectId: string;
  gabinetes: Gabinete[];
}

export interface GabineteResponse {
  gabinete: Gabinete;
}

export interface GabineteInput {
  tagGabinete: string;
  tagAnterior: string | null;
  descripcion: string | null;
  /** Obligatorio en creación — un gabinete nuevo siempre elige su tipo
   * explícitamente, nunca hereda uno tácito. */
  tipoGabineteId: string;
}

/** cat.cat_tipo_gabinete (migración 012) — catálogo global, solo lectura,
 * lista cerrada por ahora (RIO / CONTROL / COMUNICACION). No reutiliza
 * CatalogItem: su columna de texto es `nombre`, no `descripcion` (mismo
 * patrón que TipoEquipo). */
export interface TipoGabinete {
  id: string;
  codigo: string;
  nombre: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface TiposGabineteResponse {
  items: TipoGabinete[];
}

export interface Rack {
  id: string;
  projectId: string;
  gabineteId: string;
  numeroRack: number;
  /** Tope de slots que este rack físico acepta (migración 017) — null =
   * sin límite fijado. Se valida en el backend al crear un slot nuevo. */
  limiteSlots: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface RacksListResponse {
  projectId: string;
  racks: Rack[];
}

export interface Slot {
  id: string;
  projectId: string;
  rackId: string;
  numeroSlot: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SlotsListResponse {
  projectId: string;
  slots: Slot[];
}

/** Módulo instalado en un slot — trae fabricante/modelo/canalesMax ya
 * resueltos desde cat.cat_modulo_io (ver modules.ts). */
export interface PhysicalModule {
  id: string;
  projectId: string;
  slotId: string;
  catalogoModuloId: string;
  fabricante: string;
  modelo: string;
  tipoIoCodigo: string;
  canalesMax: number;
  /** Etiqueta del módulo (migración 017), ej. "DI-03" — sugerida por el
   * backend al crear (tipo + posición entre los de su mismo tipo en el
   * rack, saltando los que no tienen tag), editable libremente después. */
  tag: string | null;
  /** Etiqueta del surge protector OPCIONAL de este módulo, ej. "DISPR-02"
   * — null significa que este módulo no lleva uno, no "falta ponerle
   * nombre". Numeración independiente, mismo criterio de "salta los que
   * no tienen". */
  surgeProtectorTag: string | null;
  /** Plano de conexionado donde este módulo está (o va a quedar)
   * dibujado (migración 024) — null mientras no se haya asignado
   * todavía. Todos los módulos con el mismo planoId deben pertenecer al
   * mismo gabinete, validado por TR_modulo_validar_plano_gabinete. */
  planoId: string | null;
  /** Código del plano de planoId, ya resuelto (evita un round-trip extra
   * para mostrarlo). Null si planoId es null. */
  planoCodigoPlano: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ModulesListResponse {
  projectId: string;
  modules: PhysicalModule[];
}

/** Canal — SOLO LECTURA, lo administra el trigger del módulo (ver channels.ts). */
export interface Channel {
  id: string;
  projectId: string;
  moduloId: string;
  numeroCanal: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ChannelsListResponse {
  projectId: string;
  channels: Channel[];
}

/** Fila del catálogo global cat.cat_modulo_io (ver moduleTypes.ts). */
export interface ModuleType {
  id: string;
  fabricante: string;
  modelo: string;
  tipoIoId: string;
  tipoIoCodigo: string;
  canalesMax: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface ModuleTypesListResponse {
  moduleTypes: ModuleType[];
}

/* ---- Comunicaciones: Switch -> Puerto -> Enlace_com ------------------- */

export interface SwitchEntity {
  id: string;
  projectId: string;
  tagSwitch: string;
  descripcion: string | null;
  marcaModelo: string | null;
  /** Gabinete que contiene físicamente este switch, si corresponde — NULL
   * si el switch no está dentro de ningún gabinete modelado (migración
   * 012, relación opcional). */
  gabineteId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SwitchesListResponse {
  projectId: string;
  switches: SwitchEntity[];
}

export interface SwitchResponse {
  switch: SwitchEntity;
}

export interface SwitchInput {
  tagSwitch: string;
  descripcion: string | null;
  marcaModelo: string | null;
  gabineteId: string | null;
}

export interface Port {
  id: string;
  projectId: string;
  switchId: string;
  numeroPuerto: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PortsListResponse {
  projectId: string;
  ports: Port[];
}

export interface CommLink {
  id: string;
  projectId: string;
  equipoId: string | null;
  instrumentoId: string | null;
  puertoId: string;
  tipoComId: string | null;
  tipoMedioId: string | null;
  tagMedio: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CommLinksListResponse {
  projectId: string;
  commLinks: CommLink[];
}

export interface CommLinkInput {
  equipoId: string | null;
  instrumentoId: string | null;
  puertoId: string;
  tipoComId: string | null;
  tipoMedioId: string | null;
  tagMedio: string | null;
}

/* ---- Conexionado físico: Caja/Cable/Par_conductor/Punto/Ruta ---------- */

export interface Box {
  id: string;
  projectId: string;
  tagCaja: string;
  /** TAG histórico previo (migración 023) — mismo patrón que
   * instrumento.tagAnterior/gabinete.tagAnterior. Se completa cuando el
   * TAG provisional de una caja se reemplaza por el definitivo. */
  tagAnterior: string | null;
  descripcion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface BoxesListResponse {
  projectId: string;
  boxes: Box[];
}

export interface BoxResponse {
  box: Box;
}

export interface BoxInput {
  tagCaja: string;
  descripcion: string | null;
  tagAnterior?: string | null;
}

export interface Cable {
  id: string;
  projectId: string;
  tagCable: string;
  tipoCable: string | null;
  capacidadConductores: number;
  /** Migración 029 — clasificación estructurada de tipoCable (texto libre
   * históricamente, ej. "1-12p#18 AWG+SH"). Todos NULL en un cable
   * todavía sin clasificar — nunca se fuerza. */
  tipoConstruccionId: string | null;
  cantidadUnidades: number | null;
  calibre: string | null;
  apantallado: boolean | null;
  /** Solo en GET (list/:id) — cuántos de los capacidadConductores ya
   * tienen un tramo_conductor activo. undefined en la respuesta de
   * POST/PATCH (ahí no se calcula). capacidadConductores - conductoresEnUso
   * = libres/sin conectar. */
  conductoresEnUso?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CablesListResponse {
  projectId: string;
  cables: Cable[];
}

export interface CableResponse {
  cable: Cable;
}

export interface CableInput {
  tagCable: string;
  tipoCable: string | null;
  capacidadConductores: number;
  tipoConstruccionId: string | null;
  cantidadUnidades: number | null;
  calibre: string | null;
  apantallado: boolean | null;
}

export interface ConductorPair {
  id: string;
  projectId: string;
  cableId: string;
  numeroPar: number;
  /** Derivado: hay un tramo_conexion activo que lo usa. No es un campo propio. */
  inUse: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConductorPairsListResponse {
  projectId: string;
  conductorPairs: ConductorPair[];
}

export type ConnectionPointOwnerField =
  | 'instrumentoId'
  | 'equipoId'
  | 'cajaId'
  | 'gabineteId'
  | 'moduloId';

export interface ConnectionPoint {
  id: string;
  projectId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  cajaId: string | null;
  gabineteId: string | null;
  moduloId: string | null;
  regleta: string | null;
  bornera: string | null;
  borne: string | null;
  lado: string | null;
  circuito: string | null;
  hilo: string | null;
  descripcion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConnectionPointsListResponse {
  projectId: string;
  connectionPoints: ConnectionPoint[];
}

/** Exactamente uno de los 5 campos de dueño debe tener valor (XOR). */
export interface ConnectionPointInput {
  instrumentoId: string | null;
  equipoId: string | null;
  cajaId: string | null;
  gabineteId: string | null;
  moduloId: string | null;
  regleta: string | null;
  bornera: string | null;
  borne: string | null;
  lado: string | null;
  circuito: string | null;
  hilo: string | null;
  descripcion: string | null;
}

export interface RouteSegment {
  id: string;
  routeId: string;
  numeroOrden: number;
  /**
   * NULL desde la migración 015 (nucleo.tramo_conexion.par_conductor_id
   * ahora es opcional): un tramo del modelo nuevo declara sus
   * conductores aparte, uno a uno, vía tramo-conductores — ver
   * api/terminaciones.ts y la sección "Conexionado" de RouteDetailPage.
   */
  parConductorId: string | null;
  puntoOrigenId: string;
  puntoDestinoId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConnectionRoute {
  id: string;
  projectId: string;
  senalId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

/** GET /:routeId trae la ruta con sus tramos anidados (ver connectionRoutes.ts). */
export interface ConnectionRouteWithSegments extends ConnectionRoute {
  segments: RouteSegment[];
}

export interface RoutesListResponse {
  projectId: string;
  routes: ConnectionRoute[];
}

export interface RouteResponse {
  route: ConnectionRouteWithSegments;
}

/** Body de POST /routes — ver connectionRoutes.ts: un solo INSERT atómico.
 * parConductorId es opcional desde 015: null/ausente crea un tramo del
 * modelo nuevo (sin par legacy). */
export interface RouteSegmentInput {
  parConductorId: string | null;
  puntoOrigenId: string;
  puntoDestinoId: string;
}

export interface RouteInput {
  senalId: string;
  segments: RouteSegmentInput[];
}

/* ---- Terminaciones (migración 015): conductor, bloque_terminal,
   terminal, posicion_terminal, tramo_conductor, terminacion ---------- */

export interface Conductor {
  id: string;
  projectId: string;
  cableId: string;
  codigo: string;
  orden: number | null;
  parConductorId: string | null;
  active: boolean;
  /** Derivado: hay un tramo_conductor activo que lo usa. */
  inUse: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConductorsListResponse {
  projectId: string;
  conductors: Conductor[];
}

export interface ConductorResponse {
  conductor: Conductor;
}

export interface ConductorInput {
  cableId: string;
  codigo: string;
  orden?: number | null;
  parConductorId?: string | null;
}

export interface PosicionTerminal {
  id: string;
  projectId: string;
  terminalId: string;
  codigo: string;
  active: boolean;
  /** Derivado: hay una terminacion activa ocupándola. */
  inUse: boolean;
}

export interface TerminalConBloque {
  id: string;
  projectId: string;
  bloqueTerminalId: string;
  numero: string;
  catalogoModuloIoTerminalId: string | null;
  active: boolean;
  posiciones?: PosicionTerminal[];
}

export interface BloqueTerminal {
  id: string;
  projectId: string;
  cajaId: string | null;
  gabineteId: string | null;
  moduloId: string | null;
  /** Dueño EQUIPO (migración 026) — el panel propio de un equipo (ej. un
   * armario de variador) que recibe el cable de campo directo, sin ser
   * una caja real — pedido explícito del usuario. */
  equipoId: string | null;
  codigo: string;
  descripcion: string | null;
  /** Plano de conexionado donde este bloque está (o va a quedar) dibujado
   * (migración 025, mismo concepto que PhysicalModule.planoId) — null
   * mientras no se haya asignado. Todos los bloques con el mismo planoId
   * deben pertenecer al mismo dueño (caja/gabinete/módulo/equipo). */
  planoId: string | null;
  /** Código del plano de planoId, ya resuelto. Null si planoId es null. */
  planoCodigoPlano: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface BloqueTerminalConTerminales extends BloqueTerminal {
  terminales: TerminalConBloque[];
}

export interface BloquesTerminalListResponse {
  projectId: string;
  bloquesTerminal: BloqueTerminal[];
}

export interface BloqueTerminalResponse {
  bloqueTerminal: BloqueTerminalConTerminales;
}

/** XOR: exactamente uno de cajaId/gabineteId/equipoId (moduloId nunca se
 * crea a mano, ver bloquesTerminal.ts). equipoId es migración 026. */
export interface BloqueTerminalInput {
  cajaId?: string | null;
  gabineteId?: string | null;
  equipoId?: string | null;
  codigo: string;
  descripcion?: string | null;
}

export interface ModuloTerminalesResponse {
  bloqueTerminal: { id: string; codigo: string; descripcion: string | null; active: boolean } | null;
  terminales: Array<{
    id: string;
    numero: string;
    numeroCanal: number | null;
    ordenTerminal: number | null;
    posiciones: PosicionTerminal[];
  }>;
}

export interface TramoConductor {
  id: string;
  projectId: string;
  tramoConexionId: string;
  conductorId: string;
  active: boolean;
}

export type TerminacionExtremo = 'ORIGEN' | 'DESTINO';

export interface Terminacion {
  id: string;
  projectId: string;
  tramoConductorId: string;
  posicionTerminalId: string;
  extremo: TerminacionExtremo;
  active: boolean;
}

export interface TramoConductorConTerminaciones extends TramoConductor {
  terminaciones: Terminacion[];
}

export interface TramoConductorResponse {
  tramoConductor: TramoConductorConTerminaciones;
}

/** GET /routes/:id/conexionado — árbol de solo lectura tramo -> conductor -> terminación. */
export interface ConexionadoTerminacion {
  id: string;
  extremo: TerminacionExtremo;
  posicionTerminal: { id: string; codigo: string };
  terminal: { id: string; numero: string };
  bloqueTerminal: { id: string; codigo: string; cajaId: string | null; gabineteId: string | null; moduloId: string | null };
}

export interface ConexionadoConductor {
  tramoConductorId: string;
  conductorId: string;
  conductorCodigo: string;
  /** Tag del cable físico al que pertenece este conductor. */
  cableTag: string;
  terminaciones: ConexionadoTerminacion[];
}

export interface ConexionadoSegmento {
  tramoConexionId: string;
  numeroOrden: number;
  conductores: ConexionadoConductor[];
}

export interface RouteConexionadoResponse {
  routeId: string;
  conexionado: ConexionadoSegmento[];
}

/* ---- Lazo (documento de lazo de un instrumento) ------------------------ */

export interface Loop {
  id: string;
  projectId: string;
  instrumentoId: string;
  codigoDocumento: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface LoopsListResponse {
  projectId: string;
  loops: Loop[];
}

export interface LoopResponse {
  loop: Loop;
}

export interface LoopInput {
  instrumentoId: string;
  codigoDocumento: string | null;
}

/* ---- Administración: Clientes + Proyectos ------------------------------ */

/** Fila de nucleo.cliente (ver clients.ts). Solo es_admin_sistema puede
 * crear/editar/desactivar; GET es abierto a cualquier usuario autenticado. */
export interface Client {
  id: string;
  nombre: string;
  codigoInterno: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ClientsListResponse {
  clients: Client[];
}

export interface ClientResponse {
  client: Client;
}

export interface ClientInput {
  nombre: string;
  codigoInterno: string | null;
}

/** Body de POST /api/projects (ver projects.ts) — distinto de PATCH, que
 * solo admite code/name (no se puede mover un proyecto de cliente). */
export interface ProjectCreateInput {
  clientId: string;
  code: string;
  name: string;
}

export interface ProjectUpdateInput {
  code: string;
  name: string;
}

/* ---- Administración: Usuarios (registro global) ------------------------ */

/** Fila de seguridad.usuario tal como la expone /api/users — todo el
 * router requiere es_admin_sistema, incluso GET (ver users.ts). Nunca
 * incluye esAdminSistema/authIssuer/authSubject: ese privilegio no se
 * expone ni se administra por acá (CLAUDE.md, "Security model"). */
export interface AppUser {
  id: string;
  email: string;
  nombre: string;
  esAdminSistema: boolean;
  hasSignedIn: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface UsersListResponse {
  users: AppUser[];
}

export interface UserResponse {
  user: AppUser;
}

export interface UserInput {
  email: string;
  nombre: string;
}

/* ---- Administración: Miembros de un proyecto ---------------------------- */

/** Fila de seguridad.usuario_proyecto_rol vista desde un proyecto (ver
 * members.ts). GET requiere solo 'read'; POST/PATCH/DELETE requieren
 * 'administer' (ADMIN de ESE proyecto, o es_admin_sistema). */
export interface Member {
  usuarioId: string;
  email: string;
  nombre: string;
  projectId: string;
  role: ProjectRole;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface MembersListResponse {
  projectId: string;
  members: Member[];
}

export interface MemberResponse {
  member: Member;
}

/** `nombre` solo hace falta si el email todavía no existe como usuario —
 * el backend pre-registra uno nuevo en el mismo paso (ver members.ts). */
export interface MemberInput {
  email: string;
  nombre: string | null;
  rol: ProjectRole;
}

/* ---- Importación de Instrumentos desde P&ID / Plant 3D ----------------
 * Tipos que reflejan exactamente backend/src/routes/pnidImports.ts. Dos
 * formas de "resultado" distintas y NO intercambiables: la de PREVIEW
 * (`PnidPreviewResultado`, trae `filaIndex`) y la del detalle GET
 * (`PnidDetailResultado`, trae `id`/`numeroFila`/`aplicado`/`aplicadoAt`).
 * No inventar un tipo único que las mezcle. */

export type PnidImportEstado = 'PREVISUALIZADO' | 'APLICADO' | 'DESCARTADO' | 'ERROR';

export interface PnidImportCounts {
  sinCambios: number;
  nuevos: number;
  tagModificado: number;
  datosModificados: number;
  pnpidActualizado: number;
  excluidosListado: number;
  noExisteReporte: number;
  requiereRevision: number;
}

export interface PnidPreviousImportRef {
  importacionId: string;
  fechaCarga: string;
  estado: PnidImportEstado;
}

export interface PnidImportWarnings {
  missingKnownColumns: string[];
  unknownColumns: string[];
  archivoYaImportadoAntes?: PnidPreviousImportRef;
}

/** `createdBy`/`appliedBy` son solo el ID numérico del usuario (string) —
 * el backend no expone nombre/email en esta respuesta (ver comentario en
 * PnidImportsPage). No inventar una resolución a nombre acá. */
export interface PnidImport {
  id: string;
  projectId: string;
  nombreArchivo: string;
  hashArchivo: string;
  fuente: string;
  estado: PnidImportEstado;
  totalFilas: number;
  totalListadoTrue: number;
  conteos: PnidImportCounts;
  advertencias: PnidImportWarnings;
  fechaCarga: string;
  fechaAplicacion: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface PnidFieldDiff {
  campo: string;
  anterior: string | null;
  nuevo: string | null;
}

/** Para REQUIERE_REVISION/TAG_DUPLICADO/TAG_VACIO el backend manda una
 * explicación en prosa en vez de un arreglo de diffs por campo. */
export type PnidDiferencias = PnidFieldDiff[] | { detalle: string } | null;

/** Todos los campos mapeados de la fila fuente (no solo los que cambiaron
 * respecto al instrumento existente) — claves = PnidField (ver
 * pnidLabels.ts). null si no hay fila fuente (NO_EXISTE_EN_PNID). */
export type PnidDatosPropuestos = Record<string, string | null> | null;

/** Recursos que un instrumento NO_EXISTE_EN_PNID tiene hoy, calculados en
 * vivo — advertencia informativa, nunca elimina nada por sí misma.
 * senalesActivas por sí solas NO bloquean la eliminación definitiva
 * (migración 016 — la señal queda "sin dueño"); puntosConexion/lazos/
 * enlacesCom SÍ la siguen bloqueando por completo (instruments.ts). */
export interface PnidRecursosEnRiesgo {
  senalesActivas: number;
  puntosConexion: number;
  lazos: number;
  enlacesCom: number;
}

/** Forma de cada resultado dentro de la respuesta de POST /preview. */
export interface PnidPreviewResultado {
  filaIndex: number | null;
  pnpid: string | null;
  tagInstrumento: string | null;
  instrumentoId: string | null;
  resultado: string;
  diferencias: PnidDiferencias;
  requiereRevision: boolean;
  /** Solo poblado para resultado = NO_EXISTE_EN_PNID con al menos uno de
   * los cuatro recursos > 0. null en cualquier otro caso. */
  recursosEnRiesgo: PnidRecursosEnRiesgo | null;
  datosPropuestos: PnidDatosPropuestos;
}

/** Forma de cada resultado dentro de GET /:importId (detalle). */
export interface PnidDetailResultado {
  id: string;
  importacionId: string;
  filaId: string | null;
  numeroFila: number | null;
  pnpid: string | null;
  tagInstrumento: string | null;
  instrumentoId: string | null;
  /** Migración 046 — solo poblado para resultado = ES_SENAL cuando ya está
   * vinculada a una señal existente (motor de reimportación). null para
   * el resto de resultados y para una ES_SENAL todavía sin vincular. */
  senalId: string | null;
  resultado: string;
  diferencias: PnidDiferencias;
  requiereRevision: boolean;
  aplicado: boolean;
  aplicadoAt: string | null;
  /** Recalculado en vivo contra el estado actual — ver PnidRecursosEnRiesgo. */
  recursosEnRiesgo: PnidRecursosEnRiesgo | null;
  datosPropuestos: PnidDatosPropuestos;
}

export interface PnidImportsListResponse {
  projectId: string;
  imports: PnidImport[];
}

export interface PnidPreviewResponse {
  import: PnidImport;
  resultados: PnidPreviewResultado[];
}

export interface PnidImportDetailResponse {
  import: PnidImport;
  resultados: PnidDetailResultado[];
}

/** POST /:importId/apply devuelve una forma angosta (sin conteos) — hay
 * que volver a pedir el detalle con GET para ver el resumen posterior. */
export interface PnidApplyResponse {
  import: {
    id: string;
    projectId: string;
    estado: PnidImportEstado;
  };
}

export interface PnidDiscardResponse {
  import: {
    id: string;
    projectId: string;
    estado: PnidImportEstado;
  };
}

/*
 * Entregables / LDI (migración 006) — reflejan exactamente lo que
 * serializan backend/src/routes/{documentacion,plantillasEntregable,
 * entregables,revisionesEntregable,tiposEntregable}.ts.
 */

export interface TipoEntregable {
  id: string;
  codigo: string;
  descripcion: string;
  disciplina: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface TiposEntregableResponse {
  items: TipoEntregable[];
}

/** nucleo.proyecto_documentacion — 1:1 con el proyecto, metadatos de
 * carátula. Todo NULL si el proyecto todavía no cargó nada (ver GET). */
export interface ProyectoDocumentacion {
  projectId: string;
  codigoProyectoCumbra: string | null;
  codigoProyectoCliente: string | null;
  tituloCaratula: string | null;
  etapaCodigo: string | null;
  etapaNombre: string | null;
  afe: string | null;
  vp: string | null;
  jefeDisciplina: string | null;
  liderProyecto: string | null;
  gerenteIngenieriaConstruccion: string | null;
  inicialesPorDefault: string | null;
  inicialesRevisadoDefault: string | null;
  inicialesAprobadoDefault: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DocumentacionResponse {
  documentacion: ProyectoDocumentacion;
}

export type DocumentacionInput = Partial<
  Omit<ProyectoDocumentacion, 'projectId' | 'createdAt' | 'updatedAt'>
>;

export interface PlantillaEntregable {
  id: string;
  projectId: string;
  tipoEntregableId: string;
  nombreArchivo: string;
  archivoHash: string;
  tamanioBytes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
}

export interface PlantillasListResponse {
  projectId: string;
  plantillas: PlantillaEntregable[];
}

export interface PlantillaMutationResponse {
  plantilla: PlantillaEntregable;
}

/** Los mismos 12 campos válidos que backend/src/lib/ldi/order.ts
 * CAMPOS_ORDEN_VALIDOS — si el backend agrega uno nuevo, agregarlo acá y
 * a CAMPO_LABELS en OrderCriteriaEditor.tsx es lo único que hace falta. */
export type OrdenCampo =
  | 'sistema'
  | 'nodo'
  | 'tag'
  | 'tag_anterior'
  | 'servicio'
  | 'tipo'
  | 'tecnologia'
  | 'locacion'
  | 'equipo_asociado'
  | 'instrumento_asociado'
  | 'orden_instrumentos_asociados'
  | 'pnid';

export interface CriterioOrden {
  campo: OrdenCampo;
  direccion: 'ASC' | 'DESC';
}

export interface Entregable {
  id: string;
  projectId: string;
  tipoEntregableId: string;
  numeroDocumento: string;
  componenteEtapa: string | null;
  componenteProyecto: string | null;
  componenteCliente: string | null;
  componenteTipo: string | null;
  componenteArea: string | null;
  componenteDisciplina: string | null;
  componenteCorrelativo: string | null;
  titulo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface EntregablesListResponse {
  projectId: string;
  entregables: Entregable[];
}

export interface EntregableResponse {
  entregable: Entregable;
}

export interface EntregableInput {
  tipoEntregableId: string;
  componenteArea?: string | null;
  componenteDisciplina?: string | null;
  componenteCorrelativo: string;
  titulo?: string | null;
}

export type RevisionEstado = 'BORRADOR' | 'EMITIDA' | 'DESCARTADA';

export interface RevisionEntregable {
  id: string;
  projectId: string;
  entregableId: string;
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
  estado: RevisionEstado;
  configuracionOrdenId: string | null;
  criteriosAplicados: CriterioOrden[] | null;
  plantillaId: string | null;
  archivoId: string | null;
  emitidaBy: string | null;
  emitidaAt: string | null;
  descartadaBy: string | null;
  descartadaAt: string | null;
  /** Fila fija (32-36) de la carátula, asignada una sola vez al emitir y
   * nunca recalculada después (migración 010) — `null` si nunca se emitió
   * o si ya fue expulsada de la ventana de 5 revisiones visibles. */
  filaCaratula: number | null;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
}

export interface RevisionesListResponse {
  projectId: string;
  entregableId: string;
  revisiones: RevisionEntregable[];
}

/** Las 20 columnas del LDI ya resueltas — ver backend/src/lib/ldi/
 * snapshot.ts. Genérico a propósito en el backend (JSON), tipado acá solo
 * para este entregable. */
export interface LdiSnapshotRow {
  tag: string;
  descripcion: string;
  tipo: string;
  tecnologia: string;
  conexionProceso: string;
  instrumentoAsociado: string;
  linea: string;
  equipoAsociado: string;
  servicio: string;
  locacion: string;
  sistema: string;
  hojaDeDatos: string;
  pnid: string;
  diagramaDeLazo: string;
  planoDeUbicacion: string;
  marcaModelo: string;
  comentarios: string;
  nodo: string;
  rev: string;
}

export interface RevisionFila {
  item: number;
  instrumentoId?: string;
  snapshot: LdiSnapshotRow;
}

export interface RevisionCaratulaHistorial {
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
}

export interface MetadatosSnapshot {
  proyectoCumbra: string | null;
  proyectoCliente: string | null;
  titulo: string | null;
  etapaCodigo: string | null;
  etapaNombre: string | null;
  afe: string | null;
  vp: string | null;
  jefeDisciplina: string | null;
  liderProyecto: string | null;
  gerenteIngenieriaConstruccion: string | null;
  numeroDocumento: string;
  revisionesMostradasEnCaratula?: RevisionCaratulaHistorial[];
}

export interface RevisionDetailResponse {
  revision: RevisionEntregable;
  metadatosSnapshot: MetadatosSnapshot | null;
  filas: RevisionFila[];
}

/** Forma común de POST (crear BORRADOR) y PATCH (editar/regenerar
 * preview) — ambos devuelven el preview persistido completo. */
export interface RevisionMutationResponse {
  revision: RevisionEntregable;
  metadatosSnapshot: MetadatosSnapshot;
  totalFilas: number;
  filas: RevisionFila[];
}

export interface RevisionEmitirResponse {
  revision: RevisionEntregable;
  archivo: {
    id: string;
    nombreArchivo: string;
    archivoHash: string;
    tamanioBytes: number;
  };
}

export interface RevisionCreateInput {
  codigoRevision: string;
  fecha?: string;
  descripcion: string;
  inicialesPor?: string;
  inicialesRevisado?: string;
  inicialesAprobado?: string;
  criterios?: CriterioOrden[];
  configuracionOrdenId?: string;
}

export type RevisionUpdateInput = Partial<RevisionCreateInput>;

/** DELETE .../revisiones/:id sobre una EMITIDA/DESCARTADA con
 * `eliminarDefinitivamente: true` (migración 009) — borrado físico real,
 * nunca vuelve a existir. */
export interface RevisionEliminacionResponse {
  eliminado: true;
  revisionId: string;
  estadoAnterior: RevisionEstado;
}

/* ---- Planos (migración 014) — identidad del dibujo de ingeniería,
 * separada a propósito de ENTREGABLE/REVISION_ENTREGABLE. Las
 * asociaciones a gabinete/caja son N:M reales (ver planos.ts backend),
 * nunca 1:1. --- */

export interface Plano {
  id: string;
  projectId: string;
  codigoPlano: string | null;
  codigoAnterior: string | null;
  descripcion: string;
  active: boolean;
  tipoPlanoId: string | null;
  tipoPlanoCodigo: string | null;
  tipoPlanoDescripcion: string | null;
  /** Letra de revisión del documento (migración 022), texto libre — ej. "B". */
  revision: string | null;
  /** Calculado (no una columna) a partir del segundo segmento de
   * codigoPlano — "ELECTRICIDAD" (código con "-E-"), "INSTRUMENTACION"
   * (código con "-J-"), o null si no aplica ninguna de las dos "por
   * ahora" (ver planos.ts). */
  disciplina: 'ELECTRICIDAD' | 'INSTRUMENTACION' | null;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PlanoGabineteAsociado {
  gabineteId: string;
  tagGabinete: string;
  tipoGabineteCodigo: string | null;
}

export interface PlanoCajaAsociada {
  cajaId: string;
  tagCaja: string;
}

/** GET/POST/PATCH de un plano individual, y las asociaciones, siempre
 * devuelven el detalle completo (incluye gabinetes/cajas ya resueltos) —
 * ver fetchPlanoDetail en planos.ts backend. */
export interface PlanoDetail extends Plano {
  gabinetes: PlanoGabineteAsociado[];
  cajas: PlanoCajaAsociada[];
}

export interface PlanosListResponse {
  projectId: string;
  planos: Plano[];
}

export interface PlanoResponse {
  plano: PlanoDetail;
}

/** DELETE devuelve una forma más chica, igual que gabinetes/instrumentos. */
export interface PlanoMutationResponse {
  plano: {
    id: string;
    projectId: string;
    codigoPlano: string | null;
    active: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

/** codigoPlano/codigoAnterior son opcionales y deliberadamente sin
 * unicidad (ver docs/DIAGNOSTICO_SENALES_GABINETES.md sección 35). */
export interface PlanoInput {
  codigoPlano: string | null;
  codigoAnterior: string | null;
  descripcion: string;
  tipoPlanoId: string;
  revision?: string | null;
}

/* ---- Sección CONTROL (vistas de solo lectura, ver controlOverview.ts) -- */

export interface ControlSignalDueno {
  tipo: 'instrumento' | 'equipo';
  id: string;
  tag: string;
  descripcion: string | null;
  // Solo cuando tipo === 'instrumento':
  tipoInstrumento?: string | null;
  servicio?: string | null;
  sistema?: string | null;
  ubicacion?: string | null;
  nodo?: string | null;
  pnpid?: string | null;
  planoPnid?: string | null;
  tecnologia?: string | null;
  funcionamiento?: string | null;
  cuerpoInstrumento?: string | null;
  linea?: string | null;
  equipoAsociadoTag?: string | null;
  // Solo cuando tipo === 'equipo':
  panel?: string | null;
}

export interface ControlSignalIo {
  canalId: string;
  numeroCanal: number;
  moduloId: string | null;
  fabricante: string | null;
  modelo: string | null;
  numeroSlot: number | null;
  numeroRack: number | null;
  gabineteId: string | null;
  tagGabinete: string | null;
  tipoGabineteCodigo: string | null;
}

export type EstadoConexionado = 'IO_PENDIENTE' | 'RUTA_PENDIENTE' | 'RUTA_CARGADA';

export interface ControlSignal {
  id: string;
  codigoSenal: string | null;
  tagSenal: string | null;
  nombreCorto: string | null;
  descripcion: string | null;
  tipoIoCodigo: string | null;
  /** Servicio DE LA SEÑAL (migración 028) — más granular que
   * dueno.servicio (el del instrumento en general); el único que existe
   * cuando el dueño es un equipo, ya que nucleo.equipo no tiene esa
   * columna propia. */
  servicio: string | null;
  dueno: ControlSignalDueno | null;
  agrupador: { id: string; tag: string } | null;
  io: ControlSignalIo | null;
  cajaTag: string | null;
  rutaId: string | null;
  estadoConexionado: EstadoConexionado;
  /** true solo cuando el instrumento que era su dueño fue eliminado
   * definitivamente (migración 016) — la señal sigue activa, sin dueño. */
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
}

export interface ControlRutaNodo {
  tipo: 'instrumento' | 'equipo' | 'caja' | 'gabinete' | 'modulo' | 'desconocido';
  tag: string;
  extra?: string;
}

export interface ControlSignalDetail extends ControlSignal {
  rutaNodos: ControlRutaNodo[];
}

export interface ControlSignalsResponse {
  projectId: string;
  signals: ControlSignal[];
}

export interface ControlCanalSenal {
  id: string;
  codigoSenal: string | null;
  tagSenal: string | null;
  nombreCorto: string | null;
  duenoTag: string | null;
  duenoTipo: 'instrumento' | 'equipo' | null;
  agrupadorTag: string | null;
  cajaTag: string | null;
  /** Cable real del tramo de campo (instrumento -> caja) — null si la
   * ruta todavía no tiene conductor/terminación cargados (o no pasa por
   * ninguna caja). Los tramos caja -> gabinete -> módulo no tienen cable
   * propio documentado todavía. */
  cableTagCampo: string | null;
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
  estadoConexionado: EstadoConexionado;
}

export interface ControlCanal {
  id: string;
  numeroCanal: number;
  senal: ControlCanalSenal | null;
  estado: 'OCUPADO' | 'RESERVA';
}

export interface ControlGrupo {
  clave: string;
  tipo: 'agrupador' | 'individual';
  gabinetes: string[];
  nMiembros: number;
  miembros: ControlSignal[];
}

export interface ControlGroupsResponse {
  projectId: string;
  grupos: ControlGrupo[];
}

export interface ControlModulo {
  id: string;
  fabricante: string | null;
  modelo: string | null;
  tipoIoCodigo: string | null;
  canales: ControlCanal[];
}

export interface ControlSlot {
  id: string;
  numeroSlot: number;
  modulo: ControlModulo | null;
}

export interface ControlRack {
  id: string;
  numeroRack: number;
  slots: ControlSlot[];
}

export interface ControlGabinete {
  id: string;
  tagGabinete: string;
  tipoGabineteCodigo: string;
  racks: ControlRack[];
}

export interface ControlHardwareResponse {
  projectId: string;
  gabinetes: ControlGabinete[];
}

/* ---- Hardware de CAJAS (GET /control/cajas) — segunda etapa de la ruta
 * de Control, sin rack/slot/módulo: la cadena real es POSICION_TERMINAL
 * <- TERMINACION <- TRAMO_CONDUCTOR <- TRAMO_CONEXION <- RUTA_CONEXION <-
 * SEÑAL (migración 015), no un canal_id directo. */

export interface ControlPosicionSenal {
  id: string;
  codigoSenal: string | null;
  tagSenal: string | null;
  nombreCorto: string | null;
  duenoTag: string | null;
  duenoTipo: 'instrumento' | 'equipo' | null;
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
  /** Código del conductor real que aterriza acá, y el cable al que
   * pertenece — null si por alguna razón la terminación no resolvió
   * conductor/cable (no debería pasar en datos reales). */
  conductorCodigo: string | null;
  tagCable: string | null;
  /** Gabinete/RIO al que esta señal continúa en realidad (resuelto vía su
   * propio canal_id, no vía el tramo que pasa por esta caja) — la caja es
   * solo un nodo intermedio de la ruta física completa (instrumento ->
   * caja -> gabinete -> módulo). Null si la señal todavía no tiene
   * canal_id asignado. */
  destinoGabineteTag: string | null;
}

export interface ControlPosicion {
  id: string;
  codigo: string;
  senal: ControlPosicionSenal | null;
  estado: 'OCUPADO' | 'RESERVA';
}

export interface ControlTerminal {
  id: string;
  numero: string;
  posiciones: ControlPosicion[];
}

export interface ControlBloqueTerminal {
  id: string;
  codigo: string;
  planoId: string | null;
  planoCodigoPlano: string | null;
  terminales: ControlTerminal[];
}

/** Señal que aterriza en un panel — mismos campos para los dos tipos de
 * panel (CAJA/EQUIPO); `conductorCodigo` solo está presente para una
 * señal de una CAJA (aterriza en un borne con conductor real) — un panel
 * eléctrico (EQUIPO) no tiene ese detalle, no hay TB modelado ahí. */
export interface ControlPanelSenal {
  id: string;
  codigoSenal: string | null;
  tagSenal: string | null;
  nombreCorto: string | null;
  duenoTag: string | null;
  duenoTipo: 'instrumento' | 'equipo' | null;
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
  conductorCodigo?: string | null;
  tagCable: string | null;
  destinoGabineteTag: string | null;
}

/**
 * Panel unificado (pedido explícito del usuario: "ya no lo llamaremos
 * cajas sino panel... dentro de los paneles pueden ir cajas, o estos
 * paneles eléctricos") — un mismo rol dentro de una ruta física
 * (instrumento/equipo -> PANEL -> gabinete -> módulo), con dos variantes:
 *   - `tipo: 'CAJA'`: una caja real, con TB/bornes modelados (`bloques`
 *     no-null, con el detalle POSICION_TERMINAL <- TERMINACION).
 *   - `tipo: 'EQUIPO'`: un panel eléctrico (ej. el armario de un
 *     variador) — un EQUIPO que ocupa el mismo rol pero sin bornes/TB
 *     modelados ("no tiene TB o no nos interesa, solamente se sabe que
 *     llega") — `bloques` siempre null acá.
 * `cantidadSenales`/`cantidadCables`/`gabinetesTags` son un resumen común
 * a los dos tipos, pensado para listar/filtrar sin entrar al detalle.
 */
export interface ControlPanelUnificado {
  id: string;
  tipo: 'CAJA' | 'EQUIPO';
  tag: string;
  cantidadSenales: number;
  cantidadCables: number;
  gabinetesTags: string[];
  senales: ControlPanelSenal[];
  bloques: ControlBloqueTerminal[] | null;
}

export interface ControlCajasResponse {
  projectId: string;
  paneles: ControlPanelUnificado[];
}

/* ---- Ruteo (GET /control/ruteo) — el árbol completo RIO->rack->módulo->
 * canal->caja->instrumento/equipo en una sola llamada, calcado del
 * esquema de celdas combinadas del Excel maestro del usuario (hoja
 * SENALES). Fusiona /hardware + /cajas + la cadena de conexionado, con
 * "reserva" de cable siempre CALCULADA (capacidad - en uso), nunca un
 * dato importado. */

export interface RuteoCable {
  tag: string;
  tipoCable: string | null;
  capacidad: number | null;
  enUso: number;
  /** capacidad - enUso, null si el cable no tiene capacidad registrada. */
  reserva: number | null;
}

export interface RuteoBorne {
  /** Número del borne en el TB de la caja (lo que el Excel llama
   * BORNE_JB) — el mismo borne físico admite dos landings. Cuando
   * `estimado` es true, este número es una numeración de continuidad
   * (máximo real + 1, +2, ...), no necesariamente el mismo que asignaría
   * el Excel real (esa es una secuencia corrida por caja+TB completo que
   * ese archivo no tiene cacheada). */
  numero: string;
  /** Posición A ocupada — el cable caja->instrumento/equipo. */
  campoOcupado: boolean;
  /** Posición B ocupada — el cable RIO->caja. */
  rioOcupado: boolean;
  /** true = este borne todavía no tiene terminación real cargada, pero el
   * tipo de señal lo necesita (ej. HYO necesita 5, solo hay 2 cableados)
   * — agregado por el backend (padBornesCaja) con una numeración de
   * continuidad, no una real confirmada; la UI lo pinta semitransparente
   * en vez de con un texto aparte (pedido explícito del usuario: "no le
   * pongas pendiente, solo ponlos... pero así como medio transparentes"). */
  estimado?: boolean;
}

export interface RuteoHilo {
  /** Terminal propio del módulo (de fábrica) para este canal — ej. "IN-0". */
  numero: string;
}

export interface RuteoSenal {
  id: string;
  codigoSenal: string | null;
  tagSenal: string | null;
  nombreCorto: string | null;
  /** DESTINO de la hoja SENALES del Excel ("la descripción corta de la
   * señal") — vive en nucleo.senal.descripcion. Distinto de `duenoServicio`
   * (más largo, con contexto del equipo/instrumento) y de `nombreCorto`
   * (solo el sufijo del tag, ej. "RDY"). */
  destino: string | null;
  duenoTag: string | null;
  duenoTipo: 'instrumento' | 'equipo' | null;
  duenoNodo: string | null;
  /** Servicio del instrumento dueño — nucleo.equipo no tiene esta
   * columna, así que siempre es null cuando el dueño es un equipo. */
  duenoServicio: string | null;
  duenoAusente: boolean;
  /** Migración 047 — true cuando esta señal está vinculada a un reporte
   * P&ID (codigo_senal = PnPID) pero su PnPID no aparece en el último
   * reporte importado. Nunca se borra ni se desvincula por esto — se
   * apaga solo si el PnPID vuelve a aparecer en un import posterior. */
  sinMatchPnid: boolean;
  estadoConexionado: 'RUTA_PENDIENTE' | 'RUTA_CARGADA';
  cableRio: RuteoCable | null;
  cajaTag: string | null;
  /** Cuando la ruta no pasa por una caja real (bloque_terminal todavía no
   * soporta dueño equipo — ver CLAUDE.md, migración 015), el panel físico
   * donde aterriza el cable (ej. "620-AFM-5005") — el ORIGEN del tramo,
   * el mismo rol que cumple un instrumento en una ruta con caja. Puede
   * ser un tag distinto del "dueño" de la señal (`duenoTag`, ej. la
   * bomba real) o coincidir, según el proyecto. Sin bornes: se resuelve
   * directo vía punto_conexion, no hay bloque_terminal posible acá. */
  equipoPanelTag: string | null;
  bloqueCajaCodigo: string | null;
  bornes: RuteoBorne[];
  cableCampo: RuteoCable | null;
}

export interface RuteoCanal {
  id: string;
  numeroCanal: number;
  hilos: RuteoHilo[];
  /** Bornes reales del TB propio del módulo (dentro del gabinete, prefijo
   * "F") — calculados por regla (2 para DI/DO, 4 para AI/AO/RTD), no un
   * dato materializado todavía (ver controlOverview.ts). */
  bornera: RuteoHilo[];
  estado: 'OCUPADO' | 'RESERVA';
  senal: RuteoSenal | null;
}

export interface RuteoModulo {
  id: string;
  tag: string | null;
  fabricante: string | null;
  modelo: string | null;
  surgeProtectorTag: string | null;
  bloqueTerminalCodigo: string | null;
  tipoIoCodigo: string | null;
  canales: RuteoCanal[];
}

export interface RuteoSlot {
  id: string;
  numeroSlot: number;
  modulo: RuteoModulo | null;
}

export interface RuteoRack {
  id: string;
  numeroRack: number;
  slots: RuteoSlot[];
}

export interface RuteoGabinete {
  id: string;
  tagGabinete: string;
  tipoGabineteCodigo: string;
  racks: RuteoRack[];
}

export interface ControlRuteoResponse {
  projectId: string;
  gabinetes: RuteoGabinete[];
}

export interface ControlPlanoAsociacion {
  entidadTipo: 'gabinete' | 'caja';
  entidadId: string;
  entidadTag: string;
  planoId: string;
  codigoPlano: string | null;
  descripcion: string;
  tipoPlanoCodigo: string;
}

export interface ControlPlanosResponse {
  projectId: string;
  planos: ControlPlanoAsociacion[];
}

/* ---- Módulo Hojas de Datos (HD) — migraciones 030-041 ------------------ */

export interface Documento {
  id: string;
  projectId: string;
  codigoDocumento: string | null;
  descripcion: string;
  tipoDocumentoId: string;
  revision: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface DocumentosListResponse {
  projectId: string;
  documentos: Documento[];
}

export interface DocumentoResponse {
  documento: Documento;
}

export interface DocumentoInput {
  codigoDocumento: string | null;
  descripcion: string;
  tipoDocumentoId: string;
  revision: string | null;
}

export interface Nota {
  id: string;
  projectId: string;
  documentoId: string;
  numero: number;
  texto: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface NotasListResponse {
  notas: Nota[];
}

export interface FichaTecnica {
  id: string;
  projectId: string;
  documentoId: string | null;
  fabricanteId: string | null;
  modelo: string | null;
  codigoReferencia: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface FichasTecnicasListResponse {
  projectId: string;
  fichasTecnicas: FichaTecnica[];
}

export interface FichaTecnicaResponse {
  fichaTecnica: FichaTecnica;
}

export interface FichaTecnicaInput {
  documentoId: string | null;
  fabricanteId: string | null;
  modelo: string | null;
  codigoReferencia: string | null;
}

export type ValorRequisito = 'REQUERIDO' | 'NO_REQUERIDO' | 'NO_APLICA';

export interface FichaTecnicaRequisito {
  id: string;
  projectId: string;
  fichaTecnicaId: string;
  requisitoId: string;
  valor: ValorRequisito;
  detalle: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface MarcaAceptable {
  id: string;
  projectId: string;
  fichaTecnicaId: string;
  componente: string;
  fabricanteId: string;
  preferente: boolean | null;
  notasRef: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface Sitio {
  id: string;
  projectId: string;
  altitudMsnm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  humedadRelativaPct: number | null;
  medioAmbiente: string | null;
  cicloTrabajo: string | null;
  clasificacionArea: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface SitioInput {
  altitudMsnm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  humedadRelativaPct: number | null;
  medioAmbiente: string | null;
  cicloTrabajo: string | null;
  clasificacionArea: string | null;
}

export interface Tuberia {
  id: string;
  projectId: string;
  tagLinea: string | null;
  tagAnterior: string | null;
  tamanoDiametro: string | null;
  materialTuberia: string | null;
  materialRevestimiento: string | null;
  espesorRevestimiento: string | null;
  schedule: string | null;
  normaBridas: string | null;
  caraBridas: string | null;
  conexionInstrumento: string | null;
  // Solo viene poblado en GET (lista/detalle) — cuántos instrumentos
  // activos usan esta tubería. Determina si "Eliminar" puede ofrecerse.
  tagsAsociados?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface TuberiasListResponse {
  projectId: string;
  tuberias: Tuberia[];
}

export interface TuberiaResponse {
  tuberia: Tuberia;
}

export type TuberiaInput = Omit<Tuberia, 'id' | 'projectId' | 'active' | 'createdAt' | 'updatedAt' | 'tagsAsociados'>;

/** Instrumento cuya línea de P&ID no coincide con su tubería en HD (CAMBIO)
 * o que nunca tuvo tubería vinculada (FALTANTE). Ver GET .../tuberias/pendientes. */
export interface PendienteTuberia {
  instrumentId: string;
  tagInstrumento: string;
  lineaPnid: string;
  tuberiaId: string | null;
  tagLineaActual: string | null;
  tipo: 'CAMBIO' | 'FALTANTE';
}

export interface PendientesTuberiaResponse {
  projectId: string;
  pendientes: PendienteTuberia[];
}

export interface TagProceso {
  id: string;
  projectId: string;
  instrumentoId: string;
  variable: string;
  valorMin: string | null;
  valorNominal: string | null;
  valorMax: string | null;
  unidad: string | null;
  rangoCalibradoCampo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface TagProcesoInput {
  variable: string;
  valorMin: string | null;
  valorNominal: string | null;
  valorMax: string | null;
  unidad: string | null;
  rangoCalibradoCampo: string | null;
}

/** Fila de cualquiera de las 17 tablas de componente (c_manometro,
 * c_transmisor, etc., migraciones 033-041) — forma genérica, ver
 * lib/componentSpecs.ts para los campos reales de cada tipo. */
export interface ComponenteItem {
  id: string;
  proyectoId: string;
  fichaTecnicaId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  [campo: string]: unknown;
}

export interface ComponentesListResponse {
  items: ComponenteItem[];
}

export interface ComponenteResponse {
  item: ComponenteItem;
}

/** cat.cat_requisito — mismo shape que CatalogItem + `categoria` propia
 * (no reutiliza createSimpleCatalogRouter en el backend, ver
 * requisitos.ts). */
export interface RequisitoCatalogItem extends CatalogItem {
  categoria: string | null;
}

export interface RequisitosCatalogListResponse {
  items: RequisitoCatalogItem[];
}
