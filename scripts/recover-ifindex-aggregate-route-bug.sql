-- =====================================================================
-- Recovery: links cujo snmpInterfaceIndex foi corrompido pelo bug do
-- IP route lookup (rota agregada do pool PPPoE apontando para o uplink
-- do BNG ao invés da Vi-X / pppoe-* da sessão do assinante).
--
-- Sintoma: link PPPoE (pppoe_user definido) cujo snmp_interface_name
-- virou um nome de interface AGREGADA / FÍSICA / VLAN do uplink:
--   - sfpplus-vlan.X-NOME
--   - sfp-sfpplus*
--   - ether*, GigabitEthernet*, TenGig*, FastEthernet*
--   - bridge*, bond*
--   - vlan.*  (VLAN solta)
--
-- Resetar snmp_interface_index para NULL faz o monitor disparar
-- auto-discovery imediatamente no próximo ciclo, agora indo pelo caminho
-- correto: PPPoE session lookup (SNMP no concentrador). Como já temos a
-- correção em código rejeitando o fallback IP route inválido, nenhum
-- link vai voltar a ser corrompido.
--
-- USO RECOMENDADO:
--   1) Rodar a SELECT abaixo dentro de psql para ver quais links serão
--      afetados.
--   2) Revisar a lista com o usuário (Marvitel).
--   3) Se a lista bater com o esperado, descomentar o UPDATE e o COMMIT
--      e rodar de novo.
-- =====================================================================

BEGIN;

-- ----- PREVIEW: links candidatos ao reset --------------------------
SELECT
  id,
  name,
  identifier,
  pppoe_user,
  snmp_interface_index,
  snmp_interface_name,
  snmp_interface_alias,
  last_if_index_validation
FROM links
WHERE pppoe_user IS NOT NULL
  AND pppoe_user <> ''
  AND deleted_at IS NULL
  AND monitoring_enabled = true
  AND snmp_interface_index IS NOT NULL
  AND (
    LOWER(snmp_interface_name) ~ '^(sfpplus|sfp-|sfp[a-z]*-|ether|gigabitethernet|tengigabit|tengige|fastethernet|bridge|bond|vlan\.)'
    OR LOWER(snmp_interface_name) LIKE '%-vlan.%'
  )
  AND LOWER(snmp_interface_name) !~ '^(vi[0-9]|virtual-access|virtual-template|bvi|dialer|pppoe[-_]|<ppp)'
ORDER BY id;

-- ----- APLICAR RESET (descomentar após validar o preview) -----------
-- UPDATE links
-- SET snmp_interface_index = NULL,
--     if_index_mismatch_count = 0,
--     last_if_index_validation = NULL
-- WHERE pppoe_user IS NOT NULL
--   AND pppoe_user <> ''
--   AND deleted_at IS NULL
--   AND monitoring_enabled = true
--   AND snmp_interface_index IS NOT NULL
--   AND (
--     LOWER(snmp_interface_name) ~ '^(sfpplus|sfp-|sfp[a-z]*-|ether|gigabitethernet|tengigabit|tengige|fastethernet|bridge|bond|vlan\.)'
--     OR LOWER(snmp_interface_name) LIKE '%-vlan.%'
--   )
--   AND LOWER(snmp_interface_name) !~ '^(vi[0-9]|virtual-access|virtual-template|bvi|dialer|pppoe[-_]|<ppp)';

ROLLBACK; -- trocar para COMMIT depois de validar
