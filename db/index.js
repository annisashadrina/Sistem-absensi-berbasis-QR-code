import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbClient = null;

export async function getDb() {
  if (dbClient) return dbClient;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.trim() !== '') {
    // External PostgreSQL connection
    const { default: pg } = await import('pg');
    const { Pool } = pg;
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    dbClient = {
      type: 'pg',
      async query(sql, params = []) {
        const res = await pool.query(sql, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount
        };
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      }
    };
    console.log('[DB] Connected to external PostgreSQL via DATABASE_URL');
  } else {
    // Embedded PGlite instance (full PostgreSQL in WebAssembly, stored locally)
    const { PGlite } = await import('@electric-sql/pglite');
    const { default: fs } = await import('fs');
    const dataDir = path.resolve(__dirname, '../data/postgres');
    fs.mkdirSync(dataDir, { recursive: true });
    const pglite = new PGlite(dataDir);

    dbClient = {
      type: 'pglite',
      async query(sql, params = []) {
        const res = await pglite.query(sql, params);
        return {
          rows: res.rows,
          rowCount: res.rows ? res.rows.length : 0
        };
      },
      async exec(sql) {
        await pglite.exec(sql);
      },
      async close() {
        await pglite.close();
      }
    };
    console.log('[DB] Using local embedded PostgreSQL (PGlite) in ./data/postgres');
  }

  return dbClient;
}

export default { getDb };
