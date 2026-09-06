/*
 * Registro de las 17 tablas de componente del módulo Hojas de Datos —
 * espejo del backend (backend/src/lib/componentSpecs.ts), pero con
 * etiquetas en español para armar la UI genérica de forma dinámica en
 * vez de 17 formularios hechos a mano. Los slugs y campos son
 * exactamente los mismos que usa la API (ver componentRouter.ts).
 */

export interface CampoSpec {
  key: string;
  label: string;
  tipo?: 'texto' | 'decimal' | 'booleano';
}

export interface ComponenteSpec {
  slug: string;
  nombre: string;
  cardinalidad: 'uno' | 'muchos';
  campos: CampoSpec[];
}

/** Etiquetas compartidas por muchos componentes — evita repetir la
 * traducción de los mismos nombres de campo una y otra vez. */
const ETIQUETAS_COMUNES: Record<string, string> = {
  tipo: 'Tipo',
  modelo: 'Modelo',
  gradoProteccion: 'Grado de protección',
  conexionElectrica: 'Conexión eléctrica',
  conexionProceso: 'Conexión a proceso',
  alimentacion: 'Alimentación',
  material: 'Material',
  materialCarcasa: 'Material de la carcasa',
  voltajeAlimentacion: 'Voltaje de alimentación',
  voltajeOperacion: 'Voltaje de operación',
  consumoElectrico: 'Consumo eléctrico',
  tipoMontaje: 'Tipo de montaje',
  funcion: 'Función',
  escala: 'Escala',
  cantidad: 'Cantidad',
  tipoContacto: 'Tipo de contacto',
  corrienteContacto: 'Corriente de contacto',
  cantidadContactos: 'Cantidad de contactos',
  presionTrabajo: 'Presión de trabajo',
  accionFalla: 'Acción de falla',
  protocoloComunicacion: 'Protocolo de comunicación'
};

function etiqueta(key: string): string {
  if (ETIQUETAS_COMUNES[key]) return ETIQUETAS_COMUNES[key];
  // Humaniza camelCase -> "Palabra Palabra" como respaldo genérico.
  const espaciado = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return espaciado.charAt(0).toUpperCase() + espaciado.slice(1);
}

function campos(keys: Array<string | [string, 'decimal' | 'booleano']>): CampoSpec[] {
  return keys.map((k) => {
    const [key, tipo] = Array.isArray(k) ? k : [k, undefined];
    return { key, label: etiqueta(key), tipo: tipo ?? 'texto' };
  });
}

export const COMPONENTES: ComponenteSpec[] = [
  {
    slug: 'manometro', nombre: 'Manómetro', cardinalidad: 'uno',
    campos: campos(['tipo', 'rangoMedicion', 'exactitud', 'proteccionSobrepresion', 'materialElementoPresion', 'materialCaja', 'discoSeguridad', 'tamanoColorDial', 'escala', 'materialAguja', 'ceroAjustable', 'fluidoRelleno', 'conexionProceso', 'gradoProteccion'])
  },
  {
    slug: 'transmisor', nombre: 'Transmisor', cardinalidad: 'uno',
    campos: campos(['tipo', 'tipoSensor', 'tipoMedicion', 'rangoAjustado', 'rangoTransmisor', 'exactitud', 'repetibilidad', 'sobrepresion', 'alimentacion', 'consumo', 'senalSalida', 'protocoloComunicacion', 'conexionElectrica', 'conexionProceso', 'ajusteZeroSpan', 'compensacionDeterioroFuente', 'inmunidadSaturacion', 'materialCarcasa', 'gradoProteccion', 'montaje'])
  },
  {
    slug: 'sello-diafragma', nombre: 'Sello de diafragma', cardinalidad: 'uno',
    campos: campos(['tipo', 'materialDiafragma', 'fluidoLlenado', 'conexionInstrumento', 'conexionProceso', 'modelo'])
  },
  {
    slug: 'cuerpo-valvula', nombre: 'Cuerpo de válvula', cardinalidad: 'uno',
    campos: campos(['tipoCuerpo', 'tamanoNominal', 'presionTrabajoCwp', 'clasePresionBrida', 'tipoConexion', 'materialCuerpo', 'recubrimientoExterior', 'marcado', 'posicionNormal', ['ruidoMaxDb', 'decimal'], 'ruidoOperador', ['ruidoDistanciaM', 'decimal'], 'posicionMontaje', 'trimTipo', 'direccionFlujo', 'caracteristicaFlujo', 'recorridoObturador', 'materialObturador', 'materialMangas', 'materialVastago', 'materialAsiento', 'materialSello', 'materialSelloVastago', ['cvValvula', 'decimal'], 'claseHermeticidad'])
  },
  {
    slug: 'actuador', nombre: 'Actuador', cardinalidad: 'uno',
    campos: campos(['tipoActuador', 'accionFalla', 'principioOperacion', 'presionTrabajo', 'alimentacion', 'tiempoAperturaCierre', 'conexionActuador', 'recorridoActuador', 'torque', 'modelo'])
  },
  {
    slug: 'interruptor-posicion', nombre: 'Interruptor de posición', cardinalidad: 'muchos',
    campos: campos(['tecnologia', 'tipoContacto', 'corrienteContacto', 'cantidadContactos', 'conexionElectrica', 'gradoProteccion', 'posicionConmutacion', 'modelo'])
  },
  {
    slug: 'unidad-control', nombre: 'Unidad de control neumática', cardinalidad: 'uno',
    campos: campos(['tipoMontaje', 'voltajeOperacion', 'consumoW', 'presionOperacion', 'accionFalla'])
  },
  {
    slug: 'set-aire', nombre: 'Set de aire', cardinalidad: 'uno',
    campos: campos(['tipo', 'rangoPresion', 'conexionNeumatica', 'cantidad', 'manometro', 'reguladorVelocidad', 'kitPuestaTierra', 'modelo'])
  },
  {
    slug: 'solenoide', nombre: 'Solenoide', cardinalidad: 'muchos',
    campos: campos(['tipo', 'funcion', 'cantidadValvulas', 'voltajeOperacion', 'conexionNeumatica', 'gradoProteccion', 'modelo'])
  },
  {
    slug: 'envolvente', nombre: 'Envolvente / caja', cardinalidad: 'muchos',
    campos: campos(['funcion', 'tipoMontaje', 'dimensionesWhd', 'material', 'espesor', 'gradoProteccion', 'placaMontaje', 'voltaje', 'modelo'])
  },
  {
    slug: 'selector-maniobra', nombre: 'Selector / maniobra', cardinalidad: 'muchos',
    campos: campos(['funcion', 'tipo', 'tipoContacto', 'corrienteContacto', 'cantidadContactos', 'ranuraCandado', 'gradoProteccion', 'modelo'])
  },
  {
    slug: 'posicionador', nombre: 'Posicionador', cardinalidad: 'uno',
    campos: campos(['tipo', 'accion', 'tipoMontaje', 'senalControl', 'senalPosicion', 'protocoloComunicacion', 'medidorPresion', 'funcionDiagnostico', 'materialCarcasa', 'conexionNeumaticaCantidad', 'conexionElectricaCantidad', 'gradoProteccion', 'modelo'])
  },
  {
    slug: 'sensor', nombre: 'Sensor', cardinalidad: 'uno',
    campos: campos(['tipo', 'materialSensor', 'materialLiner', 'montajeConfiguracion', 'posicionMontaje', 'requerimientoTuberiaRecta', 'frecuenciaOperacion', 'conexionProceso', 'anguloHaz', 'deadBand', 'rangoMedicion', 'gradoProteccion', 'modelo'])
  },
  {
    slug: 'indicador', nombre: 'Indicador', cardinalidad: 'muchos',
    campos: campos(['tipo', ['esIntegrado', 'booleano'], 'alimentacion', 'consumoElectrico', 'pantalla', 'escala', 'teclado', 'entradaCable', 'conexionElectrica', 'configuracionLocal', 'longitudMaxCable', 'materialCarcasa', 'gradoProteccion', 'montaje', 'modelo'])
  },
  {
    slug: 'fuente-radioactiva', nombre: 'Fuente radioactiva', cardinalidad: 'uno',
    campos: campos(['tipo', 'elementoRadioactivo', 'intensidadRadiacion', 'actividadMaxima', 'materialBlindaje', 'mecanismoBloqueoShutter', 'asasManipulacion', 'conexionProceso', 'modelo'])
  },
  {
    slug: 'baliza', nombre: 'Baliza', cardinalidad: 'uno',
    campos: campos(['tipo', 'tipoIluminacion', 'colorLente', 'energiaDestello', 'materialCarcasa', 'materialLente', 'voltajeAlimentacion', 'consumoElectrico', 'tipoMontaje', 'conexionElectrica', 'gradoProteccion', 'vidaUtil', 'modelo'])
  },
  {
    slug: 'sirena', nombre: 'Sirena', cardinalidad: 'uno',
    campos: campos(['tipo', 'intensidadSonora', 'material', 'tonos', 'volumen', 'voltajeAlimentacion', 'consumoElectrico', 'tipoMontaje', 'conexionElectrica', 'gradoProteccion', 'modelo'])
  }
];
