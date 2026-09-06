import type { ComponentTableSpec } from './componentRouter.js';

/*
 * Las 17 tablas de componente del modulo Hojas de Datos, una spec por
 * tabla — columnas y largos calcados 1:1 de las migraciones 033-041.
 * `tipo` en la URL (ver server.ts) usa el mismo slug que la clave de
 * este objeto.
 */
export const COMPONENT_SPECS: Record<string, ComponentTableSpec> = {
  manometro: {
    table: 'nucleo.c_manometro',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 200 },
      { key: 'rangoMedicion', column: 'rango_medicion', maxLength: 50 },
      { key: 'exactitud', column: 'exactitud', maxLength: 50 },
      { key: 'proteccionSobrepresion', column: 'proteccion_sobrepresion', maxLength: 50 },
      { key: 'materialElementoPresion', column: 'material_elemento_presion', maxLength: 100 },
      { key: 'materialCaja', column: 'material_caja', maxLength: 100 },
      { key: 'discoSeguridad', column: 'disco_seguridad', maxLength: 50 },
      { key: 'tamanoColorDial', column: 'tamano_color_dial', maxLength: 50 },
      { key: 'escala', column: 'escala', maxLength: 50 },
      { key: 'materialAguja', column: 'material_aguja', maxLength: 100 },
      { key: 'ceroAjustable', column: 'cero_ajustable', maxLength: 50 },
      { key: 'fluidoRelleno', column: 'fluido_relleno', maxLength: 50 },
      { key: 'conexionProceso', column: 'conexion_proceso', maxLength: 100 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 }
    ]
  },

  transmisor: {
    table: 'nucleo.c_transmisor',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 100 },
      { key: 'tipoSensor', column: 'tipo_sensor', maxLength: 200 },
      { key: 'tipoMedicion', column: 'tipo_medicion', maxLength: 100 },
      { key: 'rangoAjustado', column: 'rango_ajustado', maxLength: 50 },
      { key: 'rangoTransmisor', column: 'rango_transmisor', maxLength: 50 },
      { key: 'exactitud', column: 'exactitud', maxLength: 50 },
      { key: 'repetibilidad', column: 'repetibilidad', maxLength: 30 },
      { key: 'sobrepresion', column: 'sobrepresion', maxLength: 50 },
      { key: 'alimentacion', column: 'alimentacion', maxLength: 100 },
      { key: 'consumo', column: 'consumo', maxLength: 30 },
      { key: 'senalSalida', column: 'senal_salida', maxLength: 100 },
      { key: 'protocoloComunicacion', column: 'protocolo_comunicacion', maxLength: 50 },
      { key: 'conexionElectrica', column: 'conexion_electrica', maxLength: 50 },
      { key: 'conexionProceso', column: 'conexion_proceso', maxLength: 100 },
      { key: 'ajusteZeroSpan', column: 'ajuste_zero_span', maxLength: 50 },
      { key: 'compensacionDeterioroFuente', column: 'compensacion_deterioro_fuente', maxLength: 50 },
      { key: 'inmunidadSaturacion', column: 'inmunidad_saturacion', maxLength: 50 },
      { key: 'materialCarcasa', column: 'material_carcasa', maxLength: 100 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'montaje', column: 'montaje', maxLength: 150 }
    ]
  },

  'sello-diafragma': {
    table: 'nucleo.c_sello_diafragma',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 100 },
      { key: 'materialDiafragma', column: 'material_diafragma', maxLength: 100 },
      { key: 'fluidoLlenado', column: 'fluido_llenado', maxLength: 50 },
      { key: 'conexionInstrumento', column: 'conexion_instrumento', maxLength: 50 },
      { key: 'conexionProceso', column: 'conexion_proceso', maxLength: 100 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  'cuerpo-valvula': {
    table: 'nucleo.c_cuerpo_valvula',
    cardinality: 'uno',
    fields: [
      { key: 'tipoCuerpo', column: 'tipo_cuerpo', maxLength: 200 },
      { key: 'tamanoNominal', column: 'tamano_nominal', maxLength: 20 },
      { key: 'presionTrabajoCwp', column: 'presion_trabajo_cwp', maxLength: 30 },
      { key: 'clasePresionBrida', column: 'clase_presion_brida', maxLength: 30 },
      { key: 'tipoConexion', column: 'tipo_conexion', maxLength: 200 },
      { key: 'materialCuerpo', column: 'material_cuerpo', maxLength: 100 },
      { key: 'recubrimientoExterior', column: 'recubrimiento_exterior', maxLength: 100 },
      { key: 'marcado', column: 'marcado', maxLength: 100 },
      { key: 'posicionNormal', column: 'posicion_normal', maxLength: 20 },
      { key: 'ruidoMaxDb', column: 'ruido_max_db', type: 'decimal' },
      { key: 'ruidoOperador', column: 'ruido_operador', maxLength: 5 },
      { key: 'ruidoDistanciaM', column: 'ruido_distancia_m', type: 'decimal' },
      { key: 'posicionMontaje', column: 'posicion_montaje', maxLength: 20 },
      { key: 'trimTipo', column: 'trim_tipo', maxLength: 100 },
      { key: 'direccionFlujo', column: 'direccion_flujo', maxLength: 50 },
      { key: 'caracteristicaFlujo', column: 'caracteristica_flujo', maxLength: 50 },
      { key: 'recorridoObturador', column: 'recorrido_obturador', maxLength: 30 },
      { key: 'materialObturador', column: 'material_obturador', maxLength: 100 },
      { key: 'materialMangas', column: 'material_mangas', maxLength: 100 },
      { key: 'materialVastago', column: 'material_vastago', maxLength: 100 },
      { key: 'materialAsiento', column: 'material_asiento', maxLength: 100 },
      { key: 'materialSello', column: 'material_sello', maxLength: 100 },
      { key: 'materialSelloVastago', column: 'material_sello_vastago', maxLength: 100 },
      { key: 'cvValvula', column: 'cv_valvula', type: 'decimal' },
      { key: 'claseHermeticidad', column: 'clase_hermeticidad', maxLength: 50 }
    ]
  },

  actuador: {
    table: 'nucleo.c_actuador',
    cardinality: 'uno',
    fields: [
      { key: 'tipoActuador', column: 'tipo_actuador', maxLength: 100 },
      { key: 'accionFalla', column: 'accion_falla', maxLength: 50 },
      { key: 'principioOperacion', column: 'principio_operacion', maxLength: 100 },
      { key: 'presionTrabajo', column: 'presion_trabajo', maxLength: 50 },
      { key: 'alimentacion', column: 'alimentacion', maxLength: 100 },
      { key: 'tiempoAperturaCierre', column: 'tiempo_apertura_cierre', maxLength: 30 },
      { key: 'conexionActuador', column: 'conexion_actuador', maxLength: 50 },
      { key: 'recorridoActuador', column: 'recorrido_actuador', maxLength: 50 },
      { key: 'torque', column: 'torque', maxLength: 50 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  'interruptor-posicion': {
    table: 'nucleo.c_interruptor_posicion',
    cardinality: 'muchos',
    fields: [
      { key: 'tecnologia', column: 'tecnologia', maxLength: 100 },
      { key: 'tipoContacto', column: 'tipo_contacto', maxLength: 30 },
      { key: 'corrienteContacto', column: 'corriente_contacto', maxLength: 50 },
      { key: 'cantidadContactos', column: 'cantidad_contactos', maxLength: 20 },
      { key: 'conexionElectrica', column: 'conexion_electrica', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'posicionConmutacion', column: 'posicion_conmutacion', maxLength: 50 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  'unidad-control': {
    table: 'nucleo.c_unidad_control',
    cardinality: 'uno',
    fields: [
      { key: 'tipoMontaje', column: 'tipo_montaje', maxLength: 30 },
      { key: 'voltajeOperacion', column: 'voltaje_operacion', maxLength: 30 },
      { key: 'consumoW', column: 'consumo_w', maxLength: 30 },
      { key: 'presionOperacion', column: 'presion_operacion', maxLength: 30 },
      { key: 'accionFalla', column: 'accion_falla', maxLength: 50 }
    ]
  },

  'set-aire': {
    table: 'nucleo.c_set_aire',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 50 },
      { key: 'rangoPresion', column: 'rango_presion', maxLength: 30 },
      { key: 'conexionNeumatica', column: 'conexion_neumatica', maxLength: 50 },
      { key: 'cantidad', column: 'cantidad', maxLength: 20 },
      { key: 'manometro', column: 'manometro', maxLength: 100 },
      { key: 'reguladorVelocidad', column: 'regulador_velocidad', maxLength: 50 },
      { key: 'kitPuestaTierra', column: 'kit_puesta_tierra', maxLength: 50 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  solenoide: {
    table: 'nucleo.c_solenoide',
    cardinality: 'muchos',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 50 },
      { key: 'funcion', column: 'funcion', maxLength: 50 },
      { key: 'cantidadValvulas', column: 'cantidad_valvulas', maxLength: 20 },
      { key: 'voltajeOperacion', column: 'voltaje_operacion', maxLength: 30 },
      { key: 'conexionNeumatica', column: 'conexion_neumatica', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  envolvente: {
    table: 'nucleo.c_envolvente',
    cardinality: 'muchos',
    fields: [
      { key: 'funcion', column: 'funcion', maxLength: 50 },
      { key: 'tipoMontaje', column: 'tipo_montaje', maxLength: 30 },
      { key: 'dimensionesWhd', column: 'dimensiones_whd', maxLength: 50 },
      { key: 'material', column: 'material', maxLength: 100 },
      { key: 'espesor', column: 'espesor', maxLength: 30 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'placaMontaje', column: 'placa_montaje', maxLength: 50 },
      { key: 'voltaje', column: 'voltaje', maxLength: 30 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  'selector-maniobra': {
    table: 'nucleo.c_selector_maniobra',
    cardinality: 'muchos',
    fields: [
      { key: 'funcion', column: 'funcion', maxLength: 50 },
      { key: 'tipo', column: 'tipo', maxLength: 100 },
      { key: 'tipoContacto', column: 'tipo_contacto', maxLength: 30 },
      { key: 'corrienteContacto', column: 'corriente_contacto', maxLength: 50 },
      { key: 'cantidadContactos', column: 'cantidad_contactos', maxLength: 20 },
      { key: 'ranuraCandado', column: 'ranura_candado', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  posicionador: {
    table: 'nucleo.c_posicionador',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 100 },
      { key: 'accion', column: 'accion', maxLength: 30 },
      { key: 'tipoMontaje', column: 'tipo_montaje', maxLength: 30 },
      { key: 'senalControl', column: 'senal_control', maxLength: 50 },
      { key: 'senalPosicion', column: 'senal_posicion', maxLength: 50 },
      { key: 'protocoloComunicacion', column: 'protocolo_comunicacion', maxLength: 50 },
      { key: 'medidorPresion', column: 'medidor_presion', maxLength: 100 },
      { key: 'funcionDiagnostico', column: 'funcion_diagnostico', maxLength: 100 },
      { key: 'materialCarcasa', column: 'material_carcasa', maxLength: 100 },
      { key: 'conexionNeumaticaCantidad', column: 'conexion_neumatica_cantidad', maxLength: 50 },
      { key: 'conexionElectricaCantidad', column: 'conexion_electrica_cantidad', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  sensor: {
    table: 'nucleo.c_sensor',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 200 },
      { key: 'materialSensor', column: 'material_sensor', maxLength: 100 },
      { key: 'materialLiner', column: 'material_liner', maxLength: 100 },
      { key: 'montajeConfiguracion', column: 'montaje_configuracion', maxLength: 200 },
      { key: 'posicionMontaje', column: 'posicion_montaje', maxLength: 50 },
      { key: 'requerimientoTuberiaRecta', column: 'requerimiento_tuberia_recta', maxLength: 50 },
      { key: 'frecuenciaOperacion', column: 'frecuencia_operacion', maxLength: 30 },
      { key: 'conexionProceso', column: 'conexion_proceso', maxLength: 100 },
      { key: 'anguloHaz', column: 'angulo_haz', maxLength: 20 },
      { key: 'deadBand', column: 'dead_band', maxLength: 30 },
      { key: 'rangoMedicion', column: 'rango_medicion', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  indicador: {
    table: 'nucleo.c_indicador',
    cardinality: 'muchos',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 100 },
      { key: 'esIntegrado', column: 'es_integrado', type: 'bit' },
      { key: 'alimentacion', column: 'alimentacion', maxLength: 100 },
      { key: 'consumoElectrico', column: 'consumo_electrico', maxLength: 30 },
      { key: 'pantalla', column: 'pantalla', maxLength: 100 },
      { key: 'escala', column: 'escala', maxLength: 50 },
      { key: 'teclado', column: 'teclado', maxLength: 50 },
      { key: 'entradaCable', column: 'entrada_cable', maxLength: 50 },
      { key: 'conexionElectrica', column: 'conexion_electrica', maxLength: 50 },
      { key: 'configuracionLocal', column: 'configuracion_local', maxLength: 50 },
      { key: 'longitudMaxCable', column: 'longitud_max_cable', maxLength: 30 },
      { key: 'materialCarcasa', column: 'material_carcasa', maxLength: 100 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'montaje', column: 'montaje', maxLength: 100 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  'fuente-radioactiva': {
    table: 'nucleo.c_fuente_radioactiva',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 300 },
      { key: 'elementoRadioactivo', column: 'elemento_radioactivo', maxLength: 50 },
      { key: 'intensidadRadiacion', column: 'intensidad_radiacion', maxLength: 100 },
      { key: 'actividadMaxima', column: 'actividad_maxima', maxLength: 50 },
      { key: 'materialBlindaje', column: 'material_blindaje', maxLength: 50 },
      { key: 'mecanismoBloqueoShutter', column: 'mecanismo_bloqueo_shutter', maxLength: 50 },
      { key: 'asasManipulacion', column: 'asas_manipulacion', maxLength: 50 },
      { key: 'conexionProceso', column: 'conexion_proceso', maxLength: 100 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  baliza: {
    table: 'nucleo.c_baliza',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 200 },
      { key: 'tipoIluminacion', column: 'tipo_iluminacion', maxLength: 50 },
      { key: 'colorLente', column: 'color_lente', maxLength: 30 },
      { key: 'energiaDestello', column: 'energia_destello', maxLength: 30 },
      { key: 'materialCarcasa', column: 'material_carcasa', maxLength: 100 },
      { key: 'materialLente', column: 'material_lente', maxLength: 100 },
      { key: 'voltajeAlimentacion', column: 'voltaje_alimentacion', maxLength: 30 },
      { key: 'consumoElectrico', column: 'consumo_electrico', maxLength: 30 },
      { key: 'tipoMontaje', column: 'tipo_montaje', maxLength: 50 },
      { key: 'conexionElectrica', column: 'conexion_electrica', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'vidaUtil', column: 'vida_util', maxLength: 30 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  },

  sirena: {
    table: 'nucleo.c_sirena',
    cardinality: 'uno',
    fields: [
      { key: 'tipo', column: 'tipo', maxLength: 200 },
      { key: 'intensidadSonora', column: 'intensidad_sonora', maxLength: 50 },
      { key: 'material', column: 'material', maxLength: 100 },
      { key: 'tonos', column: 'tonos', maxLength: 100 },
      { key: 'volumen', column: 'volumen', maxLength: 30 },
      { key: 'voltajeAlimentacion', column: 'voltaje_alimentacion', maxLength: 30 },
      { key: 'consumoElectrico', column: 'consumo_electrico', maxLength: 30 },
      { key: 'tipoMontaje', column: 'tipo_montaje', maxLength: 50 },
      { key: 'conexionElectrica', column: 'conexion_electrica', maxLength: 50 },
      { key: 'gradoProteccion', column: 'grado_proteccion', maxLength: 20 },
      { key: 'modelo', column: 'modelo', maxLength: 100 }
    ]
  }
};
