-- =====================================================================
-- Recovery: links cujo snmpInterfaceIndex foi corrompido pelo bug do
-- IP route lookup (rota agregada do pool PPPoE apontando para o uplink
-- do BNG ao invés da Vi-X / pppoe-* da sessão do assinante).
--
-- Filtro CIRÚRGICO por nome de interface: só toca em links cuja interface
-- atual é uma das 3 interfaces de uplink agregado já identificadas em
-- produção (Marvitel). Adicionar mais nomes na lista AGGREGATE_IFNAMES
-- conforme novas vítimas forem descobertas.
--
-- Resetar snmp_interface_index → NULL faz o monitor disparar auto-discovery
-- imediatamente no próximo ciclo, agora indo pelo caminho correto: PPPoE
-- session lookup (SNMP no concentrador). O fallback IP route lookup já
-- está protegido em código (server/monitoring.ts → isPlausibleSubscriberInterface).
--
-- USO RECOMENDADO:
--   1) Rodar a SELECT abaixo para ver quais links serão afetados.
--   2) Conferir se TODOS são auth_type='pppoe' e a interface bate com
--      uma das 3 da lista.
--   3) Descomentar o UPDATE e o COMMIT, rodar de novo.
-- =====================================================================

BEGIN;

-- ----- PREVIEW: links candidatos ao reset --------------------------
SELECT
  id,
  name,
  identifier,
  auth_type,
  traffic_source_type,
  concentrator_id,
  pppoe_user,
  snmp_interface_index,
  snmp_interface_name,
  last_if_index_validation
FROM links
WHERE auth_type = 'pppoe'
  AND traffic_source_type = 'concentrator'
  AND deleted_at IS NULL
  AND monitoring_enabled = true
  AND snmp_interface_index IS NOT NULL
  AND snmp_interface_name IN (
    'sfp-sfpplus1-vlan.50-OSPF-CEs',
    'sfpplus-vlan.3011-MVT_OSPF2',
    'sfpplus-vlan.1526-CONDOMINIO_MAIKAI'
  )
ORDER BY concentrator_id, id;

-- ----- APLICAR RESET (descomentar após validar o preview) -----------
-- UPDATE links
-- SET snmp_interface_index = NULL,
--     if_index_mismatch_count = 0,
--     last_if_index_validation = NULL
-- WHERE auth_type = 'pppoe'
--   AND traffic_source_type = 'concentrator'
--   AND deleted_at IS NULL
--   AND monitoring_enabled = true
--   AND snmp_interface_index IS NOT NULL
--   AND snmp_interface_name IN (
--     'sfp-sfpplus1-vlan.50-OSPF-CEs',
--     'sfpplus-vlan.3011-MVT_OSPF2',
--     'sfpplus-vlan.1526-CONDOMINIO_MAIKAI'
--   );

ROLLBACK; -- trocar para COMMIT depois de validar
