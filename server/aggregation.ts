import { db } from "./db";
import { metrics, metricsHourly, metricsDaily } from "@shared/schema";
import { sql, and, gte, lt, eq } from "drizzle-orm";

const RETENTION_RAW_DAYS = 7;
const RETENTION_HOURLY_DAYS = 30;
const RETENTION_DAILY_DAYS = 180;

export async function aggregateHourlyMetrics(): Promise<number> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const bucketStart = new Date(hourAgo);
  bucketStart.setMinutes(0, 0, 0);
  const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);

  const result = await db.execute(sql`
    INSERT INTO metrics_hourly (
      link_id, client_id, bucket_start,
      download_avg, download_max, download_min,
      upload_avg, upload_max, upload_min,
      latency_avg, latency_max, latency_min,
      packet_loss_avg, packet_loss_max,
      cpu_usage_avg, memory_usage_avg,
      sample_count, operational_count, degraded_count, offline_count
    )
    SELECT 
      link_id, client_id, ${bucketStart}::timestamp,
      AVG(download), MAX(download), MIN(download),
      AVG(upload), MAX(upload), MIN(upload),
      AVG(latency), MAX(latency), MIN(latency),
      AVG(packet_loss), MAX(packet_loss),
      AVG(cpu_usage), AVG(memory_usage),
      COUNT(*),
      COUNT(*) FILTER (WHERE status = 'operational'),
      COUNT(*) FILTER (WHERE status = 'degraded'),
      COUNT(*) FILTER (WHERE status = 'offline')
    FROM metrics
    WHERE timestamp >= ${bucketStart} AND timestamp < ${bucketEnd}
    GROUP BY link_id, client_id
    ON CONFLICT DO NOTHING
  `);

  console.log(`[Aggregation] Hourly metrics aggregated for bucket ${bucketStart.toISOString()}`);
  return 0;
}

export async function aggregateDailyMetrics(): Promise<number> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const bucketStart = new Date(dayAgo);
  bucketStart.setHours(0, 0, 0, 0);
  const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    INSERT INTO metrics_daily (
      link_id, client_id, bucket_start,
      download_avg, download_max, download_min,
      upload_avg, upload_max, upload_min,
      latency_avg, latency_max, latency_min,
      packet_loss_avg, packet_loss_max,
      cpu_usage_avg, memory_usage_avg,
      sample_count, operational_count, degraded_count, offline_count,
      uptime_percentage
    )
    SELECT 
      link_id, client_id, ${bucketStart}::timestamp,
      AVG(download_avg), MAX(download_max), MIN(download_min),
      AVG(upload_avg), MAX(upload_max), MIN(upload_min),
      AVG(latency_avg), MAX(latency_max), MIN(latency_min),
      AVG(packet_loss_avg), MAX(packet_loss_max),
      AVG(cpu_usage_avg), AVG(memory_usage_avg),
      SUM(sample_count),
      SUM(operational_count), SUM(degraded_count), SUM(offline_count),
      CASE WHEN SUM(sample_count) > 0 
        THEN (SUM(operational_count)::float / SUM(sample_count)::float) * 100 
        ELSE 100 
      END
    FROM metrics_hourly
    WHERE bucket_start >= ${bucketStart} AND bucket_start < ${bucketEnd}
    GROUP BY link_id, client_id
    ON CONFLICT DO NOTHING
  `);

  console.log(`[Aggregation] Daily metrics aggregated for bucket ${bucketStart.toISOString()}`);
  return 0;
}

export async function cleanupOldMetrics(): Promise<{ raw: number; hourly: number; daily: number }> {
  const now = new Date();
  
  const rawCutoff = new Date(now.getTime() - RETENTION_RAW_DAYS * 24 * 60 * 60 * 1000);
  const hourlyCutoff = new Date(now.getTime() - RETENTION_HOURLY_DAYS * 24 * 60 * 60 * 1000);
  const dailyCutoff = new Date(now.getTime() - RETENTION_DAILY_DAYS * 24 * 60 * 60 * 1000);

  const rawResult = await db.execute(sql`
    DELETE FROM metrics WHERE timestamp < ${rawCutoff}
  `);

  const hourlyResult = await db.execute(sql`
    DELETE FROM metrics_hourly WHERE bucket_start < ${hourlyCutoff}
  `);

  const dailyResult = await db.execute(sql`
    DELETE FROM metrics_daily WHERE bucket_start < ${dailyCutoff}
  `);

  const rawDeleted = (rawResult as any).rowCount || 0;
  const hourlyDeleted = (hourlyResult as any).rowCount || 0;
  const dailyDeleted = (dailyResult as any).rowCount || 0;

  console.log(`[Cleanup] Deleted metrics - Raw: ${rawDeleted}, Hourly: ${hourlyDeleted}, Daily: ${dailyDeleted}`);
  
  return { raw: rawDeleted, hourly: hourlyDeleted, daily: dailyDeleted };
}

let aggregationInterval: NodeJS.Timeout | null = null;

export function startAggregationJobs() {
  console.log("[Aggregation] Starting aggregation jobs...");
  
  aggregateHourlyMetrics().catch(err => console.error("[Aggregation] Initial hourly error:", err));
  
  aggregationInterval = setInterval(async () => {
    const now = new Date();
    
    if (now.getMinutes() === 5) {
      await aggregateHourlyMetrics().catch(err => console.error("[Aggregation] Hourly error:", err));
    }
    
    if (now.getHours() === 1 && now.getMinutes() === 5) {
      await aggregateDailyMetrics().catch(err => console.error("[Aggregation] Daily error:", err));
      await cleanupOldMetrics().catch(err => console.error("[Cleanup] Error:", err));
    }
  }, 60 * 1000);

  console.log("[Aggregation] Jobs scheduled - Hourly at :05, Daily+Cleanup at 01:05");
}

export function stopAggregationJobs() {
  if (aggregationInterval) {
    clearInterval(aggregationInterval);
    aggregationInterval = null;
    console.log("[Aggregation] Jobs stopped");
  }
}
