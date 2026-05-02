-- =====================================================================
-- Recovery: links cujo snmpInterfaceIndex foi corrompido pelo bug do
-- IP route lookup (rota agregada do pool PPPoE apontando para o uplink
-- do BNG ao invés da Vi-X / pppoe-* da sessão do assinante).
--
-- Sintoma: link PPPoE (auth_type='pppoe' + traffic_source_type='concentrator')
-- cujo snmp_interface_name virou um nome de interface AGREGADA / FÍSICA / VLAN
-- do uplink:
--   - sfpplus-vlan.X-NOME / sfp-sfpplus*-vlan.X
--   - ether*, GigabitEthernet*, TenGig*, FastEthernet*
--   - bridge*, bond*
--   - vlan.*  (VLAN solta)
--
-- O filtro IGNORA:
--   - Links corporate (auth_type='corporate') — o ifIndex VLAN é legítimo
--   - Links com traffic_source_type != 'concentrator' (manual/access_point)
--   - Links cuja snmp_interface_name JÁ está em formato de sessão
--     (Vi*/Virtual-Access*/BVI*/Dialer*/pppoe-*/<pppoe-*)
--
-- Resetar snmp_interface_index → NULL faz o monitor disparar auto-discovery
-- imediatamente no próximo ciclo, agora indo pelo caminho correto: PPPoE
-- session lookup (SNMP no concentrador). Como já temos a correção em código
-- rejeitando o fallback IP route inválido, nenhum link vai ser corrompido
-- de novo.
--
-- USO RECOMENDADO:
--   1) Rodar a SELECT abaixo dentro de psql para ver quais links serão
--      afetados.
--   2) Revisar a lista (auth_type DEVE ser 'pppoe' em todos).
--   3) Se a lista bater com o esperado, descomentar o UPDATE e o COMMIT
--      e rodar de novo.
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
  snmp_interface_alias,
  last_if_index_validation
FROM links
WHERE auth_type = 'pppoe'
  AND traffic_source_type = 'concentrator'
  AND deleted_at IS NULL
  AND monitoring_enabled = true
  AND snmp_interface_index IS NOT NULL
  AND (
    LOWER(snmp_interface_name) ~ '^(sfpplus|sfp-|sfp[a-z]*[0-9]*-|ether|gigabitethernet|tengigabit|tengige|fastethernet|bridge|bond|vlan\.)'
    OR LOWER(snmp_interface_name) LIKE '%-vlan.%'
    OR LOWER(snmp_interface_name) LIKE '%-vlan%-%'
  )
  AND LOWER(snmp_interface_name) !~ '^(vi[0-9]|virtual-access|virtual-template|bvi|dialer|pppoe[-_]|<ppp)'
ORDER BY id;

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
--   AND (
--     LOWER(snmp_interface_name) ~ '^(sfpplus|sfp-|sfp[a-z]*[0-9]*-|ether|gigabitethernet|tengigabit|tengige|fastethernet|bridge|bond|vlan\.)'
--     OR LOWER(snmp_interface_name) LIKE '%-vlan.%'
--     OR LOWER(snmp_interface_name) LIKE '%-vlan%-%'
--   )
--   AND LOWER(snmp_interface_name) !~ '^(vi[0-9]|virtual-access|virtual-template|bvi|dialer|pppoe[-_]|<ppp)';

ROLLBACK; -- trocar para COMMIT depois de validar
