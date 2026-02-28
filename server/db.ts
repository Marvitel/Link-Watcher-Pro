import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('connect', (client) => {
  client.query("SET timezone = 'UTC'");
});

export const db = drizzle(pool, { schema });

export async function ensureTimezoneCorrection(): Promise<void> {
  const client = await pool.connect();
  try {
    const check = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'created_at'
        AND data_type = 'timestamp without time zone'
      ) as needs_fix
    `);
    if (!check.rows[0]?.needs_fix) return;

    const tzCheck = await client.query("SHOW timezone");
    const currentTz = tzCheck.rows[0]?.TimeZone;
    if (currentTz === 'UTC' || currentTz === 'GMT') {
      console.log(`[DB] Session timezone already UTC, checking if BRT correction marker exists`);
    }

    const markerCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = '_timezone_migration' 
      ) as exists
    `);
    
    if (!markerCheck.rows[0]?.exists) {
      const serverTzCheck = await client.query(`
        SELECT current_setting('timezone') as server_tz,
               (SELECT setting FROM pg_settings WHERE name = 'timezone') as pg_tz
      `);
      const pgTz = serverTzCheck.rows[0]?.pg_tz;
      console.log(`[DB] PostgreSQL server timezone: ${pgTz}`);
      
      if (pgTz && pgTz !== 'UTC' && pgTz !== 'GMT') {
        console.log(`[DB] Production database has timezone ${pgTz} — correcting existing timestamps to UTC`);
        
        const tables = [
          { table: 'audit_logs', columns: ['created_at'] },
        ];
        
        for (const { table, columns } of tables) {
          for (const col of columns) {
            try {
              const result = await client.query(`
                UPDATE ${table} SET ${col} = ${col} + interval '3 hours'
                WHERE ${col} IS NOT NULL
              `);
              console.log(`[DB] Corrected ${result.rowCount} rows in ${table}.${col}`);
            } catch (err: any) {
              console.error(`[DB] Failed to correct ${table}.${col}: ${err.message}`);
            }
          }
        }
      }
      
      await client.query(`CREATE TABLE IF NOT EXISTS _timezone_migration (applied_at timestamp DEFAULT now())`);
      await client.query(`INSERT INTO _timezone_migration VALUES (now())`);
      console.log(`[DB] Timezone correction completed and marked`);
    }
  } catch (err: any) {
    console.error(`[DB] Timezone correction error: ${err.message}`);
  } finally {
    client.release();
  }
}

export async function ensurePerformanceIndexes(): Promise<void> {
  const indexStatements = [
    `CREATE INDEX IF NOT EXISTS idx_metrics_link_timestamp ON metrics (link_id, timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_metrics_hourly_link_bucket ON metrics_hourly (link_id, bucket_start DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_metrics_daily_link_bucket ON metrics_daily (link_id, bucket_start DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_traffic_interface_metrics_link_ts ON traffic_interface_metrics (link_id, timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_events_link_timestamp ON events (link_id, timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_incidents_link_closed ON incidents (link_id, closed_at)`,
    `CREATE INDEX IF NOT EXISTS idx_incidents_link_opened ON incidents (link_id, opened_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_link_cpes_link ON link_cpes (link_id)`,
    `CREATE INDEX IF NOT EXISTS idx_link_cpes_cpe ON link_cpes (cpe_id)`,
    `CREATE INDEX IF NOT EXISTS idx_links_client ON links (client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_links_status ON links (status)`,
  ];

  const client = await pool.connect();
  try {
    for (const stmt of indexStatements) {
      try {
        await client.query(stmt);
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.error(`[DB] Index creation warning: ${err.message}`);
        }
      }
    }
    console.log(`[DB] Performance indexes verified (${indexStatements.length} indexes)`);
  } finally {
    client.release();
  }
}
