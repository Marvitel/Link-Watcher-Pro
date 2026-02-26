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
export const db = drizzle(pool, { schema });

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
