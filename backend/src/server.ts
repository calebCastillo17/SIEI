import express from 'express';
import cors from 'cors';

import { env } from './config/env.js';
import { getDbPool } from './db/sql.js';

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


app.listen(env.port, '0.0.0.0', () => {
  console.log(`SIEI API listening on port ${env.port}`);
});
