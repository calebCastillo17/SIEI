import sql from 'mssql';
import { env } from '../config/env.js';

const config: sql.config = {
  user: env.db.user,
  password: env.db.password,
  server: env.db.server,
  port: env.db.port,
  database: env.db.name,

  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate
  },

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getDbPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}
