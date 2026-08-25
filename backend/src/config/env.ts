import 'dotenv/config';

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

export const env = {
  port: Number(process.env.PORT ?? 3000),

  db: {
    server: process.env.DB_SERVER ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 1433),
    name: process.env.DB_NAME ?? 'SIEI_DEV',
    user: process.env.DB_USER ?? 'sa',

    // En desarrollo puede venir de SIEI_SA_PASSWORD.
    password: required(
      'DB_PASSWORD or SIEI_SA_PASSWORD',
      process.env.DB_PASSWORD || process.env.SIEI_SA_PASSWORD
    ),

    encrypt: toBoolean(process.env.DB_ENCRYPT, false),
    trustServerCertificate: toBoolean(
      process.env.DB_TRUST_SERVER_CERTIFICATE,
      true
    )
  }
};
