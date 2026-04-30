-- =============================================================================
-- Rebuild de buckets metrics_hourly e metrics_daily a partir do raw
-- =============================================================================
-- Quando rodar: depois de scripts/cleanup-outlier-metrics.sql, pra reconstruir
-- buckets que foram apagados pelo cleanup. Sem esse rebuild, o gráfico fica
-- num "platô" (Recharts conecta os poucos buckets restantes com linha reta).
--
-- O agregador automático (server/aggregation.ts) só processa o bucket da
-- última hora completa e usa ON CONFLICT DO NOTHING, então NÃO recria buckets
-- antigos sozinho. Este script faz o backfill explicitamente.
--
-- Cobertura:
--   metrics_hourly: últimas 7 dias (limite da retenção raw)
--   metrics_daily : últimas 8 dias (a partir do hourly já reconstruído)
--
-- Importante: rode SEMPRE em transação. Faça backup antes em produção.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) HOURLY — apaga e recria os buckets das últimas 7 dias a partir do raw
-- ---------------------------------------------------------------------------
-- Janela: [hoje - 7d 00:00, hora corrente truncada). A hora "corrente"
-- (ainda incompleta) é deixada para o agregador automático cobrir mais tarde.

DELETE FROM metrics_hourly
WHERE bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days')
  AND bucket_start <  date_trunc('hour', NOW());

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
  link_id, client_id,
  date_trunc('hour', timestamp) AS bucket_start,
  AVG(download), MAX(download), MIN(download),
  AVG(upload),   MAX(upload),   MIN(upload),
  AVG(latency),  MAX(latency),  MIN(latency),
  AVG(packet_loss), MAX(packet_loss),
  AVG(cpu_usage),   AVG(memory_usage),
  COUNT(*),
  COUNT(*) FILTER (WHERE status = 'operational'),
  COUNT(*) FILTER (WHERE status = 'degraded'),
  COUNT(*) FILTER (WHERE status = 'offline')
FROM metrics
WHERE timestamp >= date_trunc('hour', NOW() - INTERVAL '7 days')
  AND timestamp <  date_trunc('hour', NOW())
GROUP BY link_id, client_id, date_trunc('hour', timestamp);

-- ---------------------------------------------------------------------------
-- 2) DAILY — apaga e recria os buckets das últimas 8 dias a partir do hourly
-- ---------------------------------------------------------------------------
-- Inclui o dia de hoje (ainda incompleto) — o agregador vai sobrescrever
-- mais tarde com dado completo. Cobre 8 dias para pegar boundary do timezone.

DELETE FROM metrics_daily
WHERE bucket_start >= date_trunc('day', NOW() - INTERVAL '8 days')
  AND bucket_start <  date_trunc('day', NOW());

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
  link_id, client_id,
  date_trunc('day', bucket_start) AS bucket_start,
  -- AVG ponderado pelo sample_count de cada hora (mesma lógica do agregador)
  SUM(download_avg * sample_count) / NULLIF(SUM(sample_count), 0), MAX(download_max), MIN(download_min),
  SUM(upload_avg   * sample_count) / NULLIF(SUM(sample_count), 0), MAX(upload_max),   MIN(upload_min),
  SUM(latency_avg  * sample_count) / NULLIF(SUM(sample_count), 0), MAX(latency_max),  MIN(latency_min),
  SUM(packet_loss_avg * sample_count) / NULLIF(SUM(sample_count), 0), MAX(packet_loss_max),
  SUM(cpu_usage_avg   * sample_count) / NULLIF(SUM(sample_count), 0),
  SUM(memory_usage_avg * sample_count) / NULLIF(SUM(sample_count), 0),
  SUM(sample_count),
  SUM(operational_count), SUM(degraded_count), SUM(offline_count),
  CASE WHEN SUM(sample_count) > 0
    THEN (SUM(operational_count)::float / SUM(sample_count)::float) * 100
    ELSE 100
  END
FROM metrics_hourly
WHERE bucket_start >= date_trunc('day', NOW() - INTERVAL '8 days')
  AND bucket_start <  date_trunc('day', NOW())
GROUP BY link_id, client_id, date_trunc('day', bucket_start);

-- ---------------------------------------------------------------------------
-- 3) Verificação — compare antes/depois
-- ---------------------------------------------------------------------------
SELECT 'metrics_hourly buckets'  AS tabela, COUNT(*) AS total,
       MIN(bucket_start) AS desde, MAX(bucket_start) AS ate
FROM metrics_hourly
WHERE bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days');

SELECT 'metrics_daily buckets'   AS tabela, COUNT(*) AS total,
       MIN(bucket_start) AS desde, MAX(bucket_start) AS ate
FROM metrics_daily
WHERE bucket_start >= date_trunc('day', NOW() - INTERVAL '8 days');

-- Se algo parecer errado, dá ROLLBACK em vez de COMMIT.
COMMIT;
