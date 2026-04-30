-- =============================================================================
-- Limpeza de outliers históricos PROPORCIONAL à banda contratada de cada link
-- =============================================================================
-- Causa: bug de cross-interface delta no SNMP collector (corrigido no deploy).
-- A primeira amostra após troca de ifIndex calculava delta entre counters
-- de interfaces DIFERENTES, gerando picos absurdos (multiplicadores de
-- 10× a 1.000.000× a banda contratada do link).
--
-- Estratégia: filtra outlier por link individual usando o mesmo critério do
-- coletor — `download_max > link.bandwidth × 5` (mesma fórmula do
-- LINK_BANDWIDTH_CLAMP_MULTIPLIER em monitoring.ts). Cliente de 50 Mbps =
-- corte em 250 Mbps; cliente de 1 Gbps = corte em 5 Gbps; uplink BGP 20G =
-- corte em 100 Gbps. Preserva bursts legítimos, apaga só o lixo.
--
-- IMPORTANTE: rode primeiro os SELECTs de diagnóstico e veja o impacto.
-- Depois rode o bloco de DELETE em transação. Faça backup antes.
-- =============================================================================

-- Constantes (alinhadas com monitoring.ts):
--   LINK_BANDWIDTH_CLAMP_MULTIPLIER = 5
--   MIN_PER_LINK_CLAMP_MBPS         = 200
--   MAX_REASONABLE_MBPS (fallback)  = 30_000
-- Fórmula:
--   CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
--        THEN GREATEST(l.bandwidth * 5, 200)
--        ELSE 30000  -- fallback global, igual ao runtime quando bandwidth ausente
--   END
-- Tabela `metrics` armazena em bps; metrics_hourly/daily armazenam em Mbps

-- =============================================================================
-- 1) DIAGNÓSTICO — quantas amostras estão acima do teto proporcional do link
-- =============================================================================

-- metrics_hourly (Mbps): outlier se download_max > max(bandwidth × 5, 200)
SELECT 'metrics_hourly proporcional' AS tabela,
       COUNT(*) AS buckets_outlier,
       MAX(GREATEST(mh.download_max, mh.upload_max)) AS pico_max_mbps,
       MIN(mh.bucket_start) AS primeiro,
       MAX(mh.bucket_start) AS ultimo
FROM metrics_hourly mh
JOIN links l ON l.id = mh.link_id
WHERE mh.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
   OR mh.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END;

-- metrics_daily (Mbps): mesma lógica
SELECT 'metrics_daily proporcional' AS tabela,
       COUNT(*) AS buckets_outlier,
       MAX(GREATEST(md.download_max, md.upload_max)) AS pico_max_mbps,
       MIN(md.bucket_start) AS primeiro,
       MAX(md.bucket_start) AS ultimo
FROM metrics_daily md
JOIN links l ON l.id = md.link_id
WHERE md.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
   OR md.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END;

-- metrics raw (bps): outlier se download > max(bandwidth × 5, 200) × 1_000_000
SELECT 'metrics raw proporcional' AS tabela,
       COUNT(*) AS amostras_outlier,
       MAX(GREATEST(m.download, m.upload)) AS pico_max_bps,
       MIN(m.timestamp) AS primeiro,
       MAX(m.timestamp) AS ultimo
FROM metrics m
JOIN links l ON l.id = m.link_id
WHERE m.download > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0
   OR m.upload   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0;

-- Top 10 links com mais outliers (mostra link, banda contratada, qtd, pico)
SELECT l.id, l.name, l.bandwidth AS banda_mbps,
       COUNT(*) AS buckets_outlier,
       MAX(GREATEST(mh.download_max, mh.upload_max)) AS pico_mbps,
       MAX(GREATEST(mh.download_max, mh.upload_max)) / NULLIF(l.bandwidth, 0)::float AS multiplo_da_banda
FROM metrics_hourly mh
JOIN links l ON l.id = mh.link_id
WHERE mh.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
   OR mh.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
GROUP BY l.id, l.name, l.bandwidth
ORDER BY buckets_outlier DESC
LIMIT 10;

-- =============================================================================
-- 2) LIMPEZA — descomente e rode em transação após revisar o diagnóstico
-- =============================================================================
-- BEGIN;
--
-- DELETE FROM metrics_hourly mh
-- USING links l
-- WHERE l.id = mh.link_id
--   AND (mh.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
--     OR mh.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END);
--
-- DELETE FROM metrics_daily md
-- USING links l
-- WHERE l.id = md.link_id
--   AND (md.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
--     OR md.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END);
--
-- -- Raw: zera apenas os campos download/upload (preserva o registro pra manter
-- -- timeline, latency e status válidos).
-- UPDATE metrics m
-- SET download = 0
-- FROM links l
-- WHERE l.id = m.link_id
--   AND m.download > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0;
--
-- UPDATE metrics m
-- SET upload = 0
-- FROM links l
-- WHERE l.id = m.link_id
--   AND m.upload > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0 THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0;
--
-- COMMIT;
--
-- Após COMMIT, o agregador horário (minuto :05 de cada hora) recria buckets
-- com base no raw já limpo. Dias mais antigos onde o raw já foi apagado pela
-- retenção ficam como gap no gráfico — preferível a mostrar pico irreal.
