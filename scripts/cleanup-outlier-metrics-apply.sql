-- =============================================================================
-- APPLY: limpa outliers proporcionais (rode depois do diagnóstico)
-- =============================================================================
-- Use este script (sem comentários) quando já tiver revisado o diagnóstico em
-- scripts/cleanup-outlier-metrics.sql e confirmado que os outliers a apagar
-- são realmente do bug (sempre múltiplos absurdos da banda contratada).
--
-- Fórmula (idêntica a monitoring.ts calculateBandwidth):
--   teto = CASE WHEN bandwidth > 0 THEN GREATEST(bandwidth * 5, 200) ELSE 30000 END
--
-- Roda em transação. Se algo parecer errado, ROLLBACK em vez de COMMIT.
-- =============================================================================

BEGIN;

-- HOURLY: apaga buckets cujo download_max OU upload_max passa do teto
DELETE FROM metrics_hourly mh
USING links l
WHERE l.id = mh.link_id
  AND (mh.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                              THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
    OR mh.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                              THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END);

-- DAILY: mesma lógica
DELETE FROM metrics_daily md
USING links l
WHERE l.id = md.link_id
  AND (md.download_max > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                              THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END
    OR md.upload_max   > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                              THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END);

-- RAW: zera apenas os campos download/upload (preserva o registro pra manter
-- timeline, latency e status válidos). Lembre que raw está em bps.
UPDATE metrics m
SET download = 0
FROM links l
WHERE l.id = m.link_id
  AND m.download > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                        THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0;

UPDATE metrics m
SET upload = 0
FROM links l
WHERE l.id = m.link_id
  AND m.upload > CASE WHEN l.bandwidth IS NOT NULL AND l.bandwidth > 0
                      THEN GREATEST(l.bandwidth * 5, 200) ELSE 30000 END * 1000000.0;

-- Verificação: deve retornar 0 em todas as linhas
SELECT 'hourly outliers restantes' AS info, COUNT(*) AS n
FROM metrics_hourly mh JOIN links l ON l.id = mh.link_id
WHERE mh.download_max > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END
   OR mh.upload_max   > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END;

SELECT 'daily outliers restantes' AS info, COUNT(*) AS n
FROM metrics_daily md JOIN links l ON l.id = md.link_id
WHERE md.download_max > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END
   OR md.upload_max   > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END;

SELECT 'raw outliers restantes' AS info, COUNT(*) AS n
FROM metrics m JOIN links l ON l.id = m.link_id
WHERE m.download > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END * 1000000.0
   OR m.upload   > CASE WHEN l.bandwidth > 0 THEN GREATEST(l.bandwidth*5,200) ELSE 30000 END * 1000000.0;

COMMIT;
