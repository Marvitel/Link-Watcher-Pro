-- =============================================================================
-- Rebuild de buckets metrics_hourly e metrics_daily a partir do raw
-- =============================================================================
-- Quando rodar: depois de scripts/cleanup-outlier-metrics.sql, pra reconstruir
-- buckets que foram apagados pelo cleanup. Sem esse rebuild, o gráfico fica
-- num "platô" porque o agregador automático só processa o bucket da última
-- hora completa (com ON CONFLICT DO NOTHING) e não recria buckets antigos.
--
-- Cobertura:
--   metrics_hourly: últimos 7 dias (limite da retenção raw)
--   metrics_daily : últimos 8 dias (a partir do hourly já reconstruído)
--
-- Bonus: deduplica buckets históricos. Como a tabela metrics_hourly não tem
-- UNIQUE (link_id, bucket_start), o agregador acumulou cópias do mesmo bucket
-- em cada execução (`ON CONFLICT DO NOTHING` só evita conflito no id auto-
-- gerado, que nunca conflita). Isso atrapalha o gráfico — múltiplas séries
-- sobrepostas no mesmo timestamp.
--
-- Princípio: só apaga (link, hora) que pode ser reconstruído pelo raw atual.
-- Buckets de links sem raw recente são preservados (ex: links pausados, ou
-- coleta intermitente).
--
-- Importante: rode SEMPRE em transação. Faça backup antes em produção.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) HOURLY — recria buckets das últimas 7 dias
-- ---------------------------------------------------------------------------
-- Apaga só buckets onde HÁ raw correspondente; preserva buckets de links cujo
-- raw já caiu pela retenção mas o bucket histórico ainda é válido.

DELETE FROM metrics_hourly mh
WHERE mh.bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days')
  AND mh.bucket_start <  date_trunc('hour', NOW())
  AND EXISTS (
    SELECT 1 FROM metrics m
    WHERE m.link_id   =  mh.link_id
      AND m.timestamp >= mh.bucket_start
      AND m.timestamp <  mh.bucket_start + INTERVAL '1 hour'
  );

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
GROUP BY link_id, client_id, date_trunc('hour', timestamp)
ON CONFLICT (link_id, bucket_start) DO UPDATE SET
  client_id         = EXCLUDED.client_id,
  download_avg      = EXCLUDED.download_avg,
  download_max      = EXCLUDED.download_max,
  download_min      = EXCLUDED.download_min,
  upload_avg        = EXCLUDED.upload_avg,
  upload_max        = EXCLUDED.upload_max,
  upload_min        = EXCLUDED.upload_min,
  latency_avg       = EXCLUDED.latency_avg,
  latency_max       = EXCLUDED.latency_max,
  latency_min       = EXCLUDED.latency_min,
  packet_loss_avg   = EXCLUDED.packet_loss_avg,
  packet_loss_max   = EXCLUDED.packet_loss_max,
  cpu_usage_avg     = EXCLUDED.cpu_usage_avg,
  memory_usage_avg  = EXCLUDED.memory_usage_avg,
  sample_count      = EXCLUDED.sample_count,
  operational_count = EXCLUDED.operational_count,
  degraded_count    = EXCLUDED.degraded_count,
  offline_count     = EXCLUDED.offline_count;

-- ---------------------------------------------------------------------------
-- 2) DAILY — recria buckets dos últimos 8 dias a partir do hourly
-- ---------------------------------------------------------------------------
-- Mesma lógica: só apaga onde há hourly recém-reconstruído pra repor.

DELETE FROM metrics_daily md
WHERE md.bucket_start >= date_trunc('day', NOW() - INTERVAL '8 days')
  AND md.bucket_start <  date_trunc('day', NOW())
  AND EXISTS (
    SELECT 1 FROM metrics_hourly mh
    WHERE mh.link_id      =  md.link_id
      AND mh.bucket_start >= md.bucket_start
      AND mh.bucket_start <  md.bucket_start + INTERVAL '1 day'
  );

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
  -- AVG ponderado pelo sample_count (mesma fórmula do agregador automático)
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
GROUP BY link_id, client_id, date_trunc('day', bucket_start)
ON CONFLICT (link_id, bucket_start) DO UPDATE SET
  client_id         = EXCLUDED.client_id,
  download_avg      = EXCLUDED.download_avg,
  download_max      = EXCLUDED.download_max,
  download_min      = EXCLUDED.download_min,
  upload_avg        = EXCLUDED.upload_avg,
  upload_max        = EXCLUDED.upload_max,
  upload_min        = EXCLUDED.upload_min,
  latency_avg       = EXCLUDED.latency_avg,
  latency_max       = EXCLUDED.latency_max,
  latency_min       = EXCLUDED.latency_min,
  packet_loss_avg   = EXCLUDED.packet_loss_avg,
  packet_loss_max   = EXCLUDED.packet_loss_max,
  cpu_usage_avg     = EXCLUDED.cpu_usage_avg,
  memory_usage_avg  = EXCLUDED.memory_usage_avg,
  sample_count      = EXCLUDED.sample_count,
  operational_count = EXCLUDED.operational_count,
  degraded_count    = EXCLUDED.degraded_count,
  offline_count     = EXCLUDED.offline_count,
  uptime_percentage = EXCLUDED.uptime_percentage;

-- ---------------------------------------------------------------------------
-- 3) Verificação — totais e duplicatas remanescentes
-- ---------------------------------------------------------------------------
SELECT 'metrics_hourly buckets (últimos 7d)' AS info, COUNT(*) AS total,
       MIN(bucket_start) AS desde, MAX(bucket_start) AS ate
FROM metrics_hourly
WHERE bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days');

SELECT 'metrics_daily buckets (últimos 8d)' AS info, COUNT(*) AS total,
       MIN(bucket_start) AS desde, MAX(bucket_start) AS ate
FROM metrics_daily
WHERE bucket_start >= date_trunc('day', NOW() - INTERVAL '8 days');

-- Duplicatas (deve ser zero nas janelas reconstruídas)
SELECT 'duplicatas hourly (últimos 7d)' AS info, COUNT(*) AS dup_pares
FROM (
  SELECT link_id, bucket_start
  FROM metrics_hourly
  WHERE bucket_start >= date_trunc('hour', NOW() - INTERVAL '7 days')
  GROUP BY link_id, bucket_start
  HAVING COUNT(*) > 1
) d;

-- Se algo parecer errado, ROLLBACK em vez de COMMIT.
COMMIT;
