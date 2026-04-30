-- =============================================================================
-- Deduplicação global de metrics_hourly e metrics_daily
-- =============================================================================
-- Causa: a tabela nunca teve UNIQUE (link_id, bucket_start). O agregador
-- (server/aggregation.ts) usa `ON CONFLICT DO NOTHING`, mas como o único
-- conflito possível é no `id` (auto-gerado, nunca conflita), toda execução
-- inserir uma cópia nova do mesmo bucket. Vi link com 10 cópias em dev.
--
-- Estratégia: para cada (link_id, bucket_start) duplicado, mantém o registro
-- com MAIOR sample_count (mais representativo) e apaga os demais. Em caso
-- de empate no sample_count, usa o menor id (estável).
--
-- IMPORTANTE: rode ANTES de criar a UNIQUE constraint, senão a constraint
-- falha. Faça backup antes em produção.
-- =============================================================================

BEGIN;

-- Diagnóstico antes
SELECT 'metrics_hourly antes' AS info,
       COUNT(*) AS total,
       COUNT(DISTINCT (link_id, bucket_start)) AS unicos,
       COUNT(*) - COUNT(DISTINCT (link_id, bucket_start)) AS duplicatas
FROM metrics_hourly;

SELECT 'metrics_daily antes' AS info,
       COUNT(*) AS total,
       COUNT(DISTINCT (link_id, bucket_start)) AS unicos,
       COUNT(*) - COUNT(DISTINCT (link_id, bucket_start)) AS duplicatas
FROM metrics_daily;

-- ---------------------------------------------------------------------------
-- HOURLY dedup
-- ---------------------------------------------------------------------------
DELETE FROM metrics_hourly mh
USING (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY link_id, bucket_start
             ORDER BY sample_count DESC, id ASC
           ) AS rn
    FROM metrics_hourly
  ) ranked
  WHERE rn > 1
) dups
WHERE mh.id = dups.id;

-- ---------------------------------------------------------------------------
-- DAILY dedup
-- ---------------------------------------------------------------------------
DELETE FROM metrics_daily md
USING (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY link_id, bucket_start
             ORDER BY sample_count DESC, id ASC
           ) AS rn
    FROM metrics_daily
  ) ranked
  WHERE rn > 1
) dups
WHERE md.id = dups.id;

-- Diagnóstico depois (deve dar duplicatas = 0)
SELECT 'metrics_hourly depois' AS info,
       COUNT(*) AS total,
       COUNT(DISTINCT (link_id, bucket_start)) AS unicos,
       COUNT(*) - COUNT(DISTINCT (link_id, bucket_start)) AS duplicatas
FROM metrics_hourly;

SELECT 'metrics_daily depois' AS info,
       COUNT(*) AS total,
       COUNT(DISTINCT (link_id, bucket_start)) AS unicos,
       COUNT(*) - COUNT(DISTINCT (link_id, bucket_start)) AS duplicatas
FROM metrics_daily;

COMMIT;
