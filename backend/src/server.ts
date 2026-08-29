import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { getDbPool } from './db/sql.js';
import { meRouter } from './routes/me.js';
import { projectsRouter } from './routes/projects.js';
import { instrumentsRouter } from './routes/instruments.js';
import { equipmentRouter } from './routes/equipment.js';
import { signalsRouter } from './routes/signals.js';
import { gabinetesRouter } from './routes/gabinetes.js';
import { racksRouter } from './routes/racks.js';
import { slotsRouter } from './routes/slots.js';
import { modulesRouter } from './routes/modules.js';
import { channelsRouter } from './routes/channels.js';
import { moduleTypesRouter } from './routes/moduleTypes.js';
import { switchesRouter } from './routes/switches.js';
import { portsRouter } from './routes/ports.js';
import { commLinksRouter } from './routes/commLinks.js';
import { boxesRouter } from './routes/boxes.js';
import { cablesRouter } from './routes/cables.js';
import { conductorPairsRouter } from './routes/conductorPairs.js';
import { connectionPointsRouter } from './routes/connectionPoints.js';
import { connectionRoutesRouter } from './routes/connectionRoutes.js';
import { loopsRouter } from './routes/loops.js';
import { pnidImportsRouter } from './routes/pnidImports.js';
import { clientsRouter } from './routes/clients.js';
import { usersRouter } from './routes/users.js';
import { membersRouter } from './routes/members.js';
import { documentacionRouter } from './routes/documentacion.js';
import { plantillasEntregableRouter } from './routes/plantillasEntregable.js';
import { configuracionesOrdenRouter } from './routes/configuracionesOrden.js';
import { entregablesRouter } from './routes/entregables.js';
import { revisionesEntregableRouter } from './routes/revisionesEntregable.js';
import { createSimpleCatalogRouter } from './lib/simpleCatalogRouter.js';
import { devAuthzRouter } from './routes/devAuthz.js';
import { tiposEntregableRouter } from './routes/tiposEntregable.js';
import { ordenTipoInstrumentoRouter } from './routes/ordenTipoInstrumento.js';
import { tiposEquipoRouter } from './routes/tiposEquipo.js';
import { tiposGabineteRouter } from './routes/tiposGabinete.js';

const app = express();

/*
 * exposedHeaders: por defecto CORS solo deja leer a JS un puñado de
 * headers "seguros" de la respuesta (ninguno de estos dos) aunque el
 * servidor los mande igual — un fetch() cross-origin (el caso real del
 * frontend en Codespaces: puertos 5173/3000 son orígenes distintos) recibe
 * el archivo pero `response.headers.get('Content-Disposition')` da null,
 * así que el nombre real del archivo (ej. "104-22043-4620003347-LDI-620-J-
 * 0001_RevA.xlsx") nunca llegaba al navegador y la descarga caía al
 * nombre de respaldo genérico. X-Archivo-Sha256 tiene el mismo problema
 * para cualquier verificación de integridad que se quiera hacer del lado
 * del cliente.
 */
app.use(cors({ exposedHeaders: ['Content-Disposition', 'X-Archivo-Sha256'] }));
app.use(express.json());


app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'SIEI API'
  });
});


app.get('/health/db', async (_req, res) => {
  try {
    const pool = await getDbPool();

    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS database_name,
        1 AS connection_ok
    `);

    res.status(200).json({
      status: 'ok',
      service: 'SIEI API',
      database: result.recordset[0].database_name,
      connection: result.recordset[0].connection_ok === 1
    });

  } catch (error) {
    console.error('Database health check failed:', error);

    res.status(503).json({
      status: 'error',
      service: 'SIEI API',
      database: 'unavailable'
    });
  }
});


app.use('/api/me', meRouter);
app.use(
  '/api/projects/:projectId/instruments',
  instrumentsRouter
);
app.use(
  '/api/projects/:projectId/equipment',
  equipmentRouter
);
app.use(
  '/api/projects/:projectId/signals',
  signalsRouter
);
app.use(
  '/api/projects/:projectId/gabinetes',
  gabinetesRouter
);
app.use(
  '/api/projects/:projectId/racks',
  racksRouter
);
app.use(
  '/api/projects/:projectId/slots',
  slotsRouter
);
app.use(
  '/api/projects/:projectId/modules',
  modulesRouter
);
app.use(
  '/api/projects/:projectId/channels',
  channelsRouter
);
app.use(
  '/api/projects/:projectId/switches',
  switchesRouter
);
app.use(
  '/api/projects/:projectId/ports',
  portsRouter
);
app.use(
  '/api/projects/:projectId/comm-links',
  commLinksRouter
);
app.use(
  '/api/projects/:projectId/boxes',
  boxesRouter
);
app.use(
  '/api/projects/:projectId/cables',
  cablesRouter
);
app.use(
  '/api/projects/:projectId/conductor-pairs',
  conductorPairsRouter
);
app.use(
  '/api/projects/:projectId/connection-points',
  connectionPointsRouter
);
app.use(
  '/api/projects/:projectId/routes',
  connectionRoutesRouter
);
app.use(
  '/api/projects/:projectId/loops',
  loopsRouter
);
app.use(
  '/api/projects/:projectId/pnid-imports',
  pnidImportsRouter
);
app.use(
  '/api/projects/:projectId/members',
  membersRouter
);
app.use(
  '/api/projects/:projectId/documentacion',
  documentacionRouter
);
app.use(
  '/api/projects/:projectId/plantillas-entregable',
  plantillasEntregableRouter
);
app.use(
  '/api/projects/:projectId/configuraciones-orden',
  configuracionesOrdenRouter
);
app.use(
  '/api/projects/:projectId/entregables/:entregableId/revisiones',
  revisionesEntregableRouter
);
app.use(
  '/api/projects/:projectId/entregables',
  entregablesRouter
);

app.use('/api/projects', projectsRouter);

/*
 * Recursos globales (sin proyecto_id) — no cuelgan de /api/projects, no
 * usan requireProjectPermission.
 */
app.use('/api/catalogs/module-types', moduleTypesRouter);

/*
 * Catálogos de dominio ABIERTO (sin seed, "no lista cerrada confirmada")
 * — admiten POST, solo es_admin_sistema.
 */
app.use(
  '/api/catalogs/interface-types',
  createSimpleCatalogRouter('cat.cat_tipo_interfaz', true)
);
app.use(
  '/api/catalogs/com-types',
  createSimpleCatalogRouter('cat.cat_tipo_com', true)
);
app.use(
  '/api/catalogs/com-media-types',
  createSimpleCatalogRouter('cat.cat_tipo_medio_com', true)
);

/*
 * Catálogos de lista CERRADA ya confirmada en los Excel de origen — solo
 * lectura, ya sembrados por la migración 001.
 */
app.use(
  '/api/catalogs/revision-states',
  createSimpleCatalogRouter('cat.cat_estado_revision', false)
);
app.use(
  '/api/catalogs/alarm-priorities',
  createSimpleCatalogRouter('cat.cat_prioridad_alarma', false)
);
app.use(
  '/api/catalogs/pnid-states',
  createSimpleCatalogRouter('cat.cat_estado_pnid', false)
);
/*
 * Estos 3 los usa directamente nucleo.senal (clase CONTROL/COM, tipo de
 * E/S, dirección de comunicación) — son parte del modelo de validación de
 * TR_senal_validar_clase, no un dominio abierto: agregar un tercer código
 * a clase_senal, por ejemplo, no tendría sentido semántico para esa
 * lógica. Igual que los tres de arriba, solo lectura.
 */
app.use(
  '/api/catalogs/signal-classes',
  createSimpleCatalogRouter('cat.cat_clase_senal', false)
);
app.use(
  '/api/catalogs/io-types',
  createSimpleCatalogRouter('cat.cat_tipo_io', false)
);
app.use(
  '/api/catalogs/com-directions',
  createSimpleCatalogRouter('cat.cat_direccion_com', false)
);

app.use('/api/catalogs/tipos-entregable', tiposEntregableRouter);
app.use('/api/catalogs/orden-tipo-instrumento', ordenTipoInstrumentoRouter);
app.use('/api/catalogs/tipos-equipo', tiposEquipoRouter);
app.use('/api/catalogs/tipos-gabinete', tiposGabineteRouter);

app.use('/api/clients', clientsRouter);
app.use('/api/users', usersRouter);

if (env.auth.mode === 'dev') {
  app.use('/api/dev/authz', devAuthzRouter);
}


/*
 * Error handler final.
 */
app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  console.error(error);

  res.status(500).json({
    error: 'internal_server_error'
  });
});


app.listen(env.port, '0.0.0.0', () => {
  console.log(`SIEI API listening on port ${env.port}`);
  console.log(`Authentication mode: ${env.auth.mode}`);
});
