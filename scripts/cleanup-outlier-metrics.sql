-- =============================================================================
-- Limpeza de outliers históricos em metrics, metrics_hourly e metrics_daily
-- =============================================================================
-- Causa: bug de cross-interface delta no SNMP collector (corrigido no deploy).
-- Quando handleIfIndexAutoDiscovery descobria um novo ifIndex, a primeira
-- amostra calculava delta entre counters de interfaces DIFERENTES, gerando
-- picos absurdos (até 35 Tbps em casos vistos).
--
-- Este script:
--   1) Mostra um relatório do que será afetado (SELECTs)
--   2) Zera download/upload acima de 200 Gbps na tabela `metrics` (raw)
--   3) Reseta picos no metrics_hourly e metrics_daily afetados pelo bug
--
-- IMPORTANTE: rode primeiro os SELECTs de diagnóstico e veja o impacto.
-- Depois rode os UPDATEs em transação. Faça backup do banco antes.
-- =============================================================================

-- Limite sanitário (alinhado com MAX_REASONABLE_MBPS no monitoring.ts)
-- 200 Gbps = 200_000 Mbps = 200_000_000_000 bps
-- Tabela `metrics` armazena em bps; metrics_hourly/daily armazenam em Mbps
-- (confira o schema antes de aplicar)

-- =============================================================================
-- 1) DIAGNÓSTICO — quantas amostras serão afetadas
-- =============================================================================
SELECT 'metrics (raw, bps)' AS tabela,
       COUNT(*) AS amostras_outlier,
       MAX(GREATEST(download, upload)) AS pico_max_bps,
       MIN(timestamp) AS primeiro,
       MAX(timestamp) AS ultimo
FROM metrics
WHERE download > 200000000000 OR upload > 200000000000;

SELECT 'metrics_hourly (Mbps)' AS tabela,
       COUNT(*) AS buckets_outlier,
       MAX(GREATEST(download_max, upload_max)) AS pico_max_mbps,
       MIN(bucket_start) AS primeiro,
       MAX(bucket_start) AS ultimo
FROM metrics_hourly
WHERE download_max > 200000 OR upload_max > 200000;

SELECT 'metrics_daily (Mbps)' AS tabela,
       COUNT(*) AS buckets_outlier,
       MAX(GREATEST(download_max, upload_max)) AS pico_max_mbps,
       MIN(bucket_start) AS primeiro,
       MAX(bucket_start) AS ultimo
FROM metrics_daily
WHERE download_max > 200000 OR upload_max > 200000;

-- Top 10 links mais afetados
SELECT l.id, l.name,
       COUNT(*) AS amostras_outlier,
       MAX(GREATEST(m.download, m.upload)) / 1e9 AS pico_gbps
FROM metrics m
JOIN links l ON l.id = m.link_id
WHERE m.download > 200000000000 OR m.upload > 200000000000
GROUP BY l.id, l.name
ORDER BY amostras_outlier DESC
LIMIT 10;

-- =============================================================================
-- 2) LIMPEZA — descomente e rode em transação após revisar o diagnóstico
-- =============================================================================
-- BEGIN;
--
-- -- Zera valores absurdos na tabela raw (mantém o registro para preservar
-- -- timeline; status/latency continuam válidos).
-- UPDATE metrics
-- SET download = 0
-- WHERE download > 200000000000;
--
-- UPDATE metrics
-- SET upload = 0
-- WHERE upload > 200000000000;
--
-- -- Recalcula buckets horários afetados a partir do raw já limpo.
-- -- (Se preferir não recalcular, basta zerar os campos *_max/*_avg dos
-- -- buckets afetados — mas perderá granularidade nas horas envolvidas.)
-- DELETE FROM metrics_hourly
-- WHERE download_max > 200000 OR upload_max > 200000;
--
-- DELETE FROM metrics_daily
-- WHERE download_max > 200000 OR upload_max > 200000;
--
-- COMMIT;
--
-- Após o COMMIT, o agregador horário (que roda no minuto :05 de cada hora)
-- vai recriar automaticamente os buckets apagados a partir dos dados raw
-- já limpos. O agregador diário (01:05) faz o mesmo para metrics_daily.
