-- Migration: adiciona o status técnico da conexão Voalle.
-- Idempotente — pode ser rodado várias vezes em segurança.
-- Aplicar em produção:
--   psql "$DATABASE_URL" -f scripts/add-voalle-connection-status.sql
--
-- Alimentado pelo sync horário (server/voalle-connection-sync.ts) chamando
-- GET /external/map/connection/all do Voalle. Match por voalle_connection_id.
-- Valores: 'normal' (1), 'blocked' (2), 'block_warning' (3), 'maintenance_warning' (4), 'unknown'.

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS voalle_connection_status varchar(30) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS voalle_connection_status_updated_at timestamp;

-- Acelera o batch UPDATE feito pelo sync (CASE WHEN ... WHERE voalle_connection_id IN (...))
CREATE INDEX IF NOT EXISTS idx_links_voalle_connection_id_status
  ON links (voalle_connection_id)
  WHERE voalle_connection_id IS NOT NULL;
