import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { getDbPool } from './db/sql.js';
import { meRouter } from './routes/me.js';
import { projectsRouter } from './routes/projects.js';
import { instrumentsRouter } from './routes/instruments.js';
import { equipmentRouter } from './routes/equipment.js';
import { signalsRouter } from './routes/signals.js';
import { riosRouter } from './routes/rios.js';
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
import { clientsRouter } from './routes/clients.js';
import { devAuthzRouter } from './routes/devAuthz.js';

const app = express();

app.use(cors());
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
  '/api/projects/:projectId/rios',
  riosRouter
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

app.use('/api/projects', projectsRouter);

/*
 * Recursos globales (sin proyecto_id) — no cuelgan de /api/projects, no
 * usan requireProjectPermission.
 */
app.use('/api/catalogs/module-types', moduleTypesRouter);
app.use('/api/clients', clientsRouter);

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
