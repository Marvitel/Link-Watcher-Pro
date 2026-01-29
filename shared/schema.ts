import { pgTable, text, varchar, integer, real, timestamp, boolean, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  cnpj: varchar("cnpj", { length: 20 }),
  address: text("address"),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").notNull().default(true),
  voalleCustomerId: integer("voalle_customer_id"),
  voallePortalUsername: varchar("voalle_portal_username", { length: 50 }),
  voallePortalPassword: text("voalle_portal_password"),
  portalCredentialsStatus: varchar("portal_credentials_status", { length: 20 }).default("unchecked"),
  portalCredentialsLastCheck: timestamp("portal_credentials_last_check"),
  portalCredentialsError: text("portal_credentials_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  radiusUsername: varchar("radius_username", { length: 100 }),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"),
  clientId: integer("client_id"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  // Credenciais SSH do operador (para acesso a equipamentos de rede)
  sshUser: varchar("ssh_user", { length: 100 }),
  sshPassword: text("ssh_password"), // Armazenado criptografado
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull(),
});

export const groupPermissions = pgTable("group_permissions", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  permissionId: integer("permission_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const links = pgTable("links", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  identifier: varchar("identifier", { length: 50 }).notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  address: text("address").notNull(),
  ipBlock: varchar("ip_block", { length: 20 }).notNull(),
  totalIps: integer("total_ips").notNull(),
  usableIps: integer("usable_ips").notNull(),
  bandwidth: integer("bandwidth").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("operational"),
  uptime: real("uptime").notNull().default(99.0),
  currentDownload: real("current_download").notNull().default(0),
  currentUpload: real("current_upload").notNull().default(0),
  latency: real("latency").notNull().default(0),
  packetLoss: real("packet_loss").notNull().default(0),
  cpuUsage: real("cpu_usage").notNull().default(0),
  memoryUsage: real("memory_usage").notNull().default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  failureReason: varchar("failure_reason", { length: 255 }),
  failureSource: text("failure_source"),
  lastFailureAt: timestamp("last_failure_at"),
  lastFailureReason: varchar("last_failure_reason", { length: 255 }),
  lastFailureSource: text("last_failure_source"),
  monitoringEnabled: boolean("monitoring_enabled").notNull().default(true),
  oltEndpoint: text("olt_endpoint"),
  snmpCommunity: varchar("snmp_community", { length: 100 }),
  icmpInterval: integer("icmp_interval").notNull().default(30),
  snmpProfileId: integer("snmp_profile_id"),
  snmpInterfaceIndex: integer("snmp_interface_index"),
  snmpInterfaceName: varchar("snmp_interface_name", { length: 100 }),
  snmpInterfaceDescr: text("snmp_interface_descr"),
  snmpInterfaceAlias: varchar("snmp_interface_alias", { length: 255 }), // IF-MIB::ifAlias - para interfaces dinâmicas Cisco PPPoE
  snmpRouterIp: varchar("snmp_router_ip", { length: 45 }),
  monitoredIp: varchar("monitored_ip", { length: 45 }),
  equipmentVendorId: integer("equipment_vendor_id"),
  customCpuOid: varchar("custom_cpu_oid", { length: 255 }),
  customMemoryOid: varchar("custom_memory_oid", { length: 255 }),
  equipmentModel: varchar("equipment_model", { length: 100 }),
  latencyThreshold: real("latency_threshold").notNull().default(80),
  packetLossThreshold: real("packet_loss_threshold").notNull().default(2),
  // Tipo de conexão: gpon (fibra com OLT) ou ptp (ponto-a-ponto com switch)
  linkType: varchar("link_type", { length: 20 }).notNull().default("gpon"), // gpon, ptp
  // Campos para GPON (OLT)
  oltId: integer("olt_id"),
  onuSearchString: varchar("onu_search_string", { length: 100 }), // String de busca (serial da ONU)
  onuId: varchar("onu_id", { length: 50 }), // ID da ONU descoberto via busca na OLT
  // Campos para PTP (Switch)
  switchId: integer("switch_id"), // Switch de acesso para links PTP
  switchPort: varchar("switch_port", { length: 50 }), // Porta no switch (ex: "1/0/1", "GigabitEthernet0/0/1")
  switchSlot: integer("switch_slot"), // Slot no switch (se aplicável)
  switchPortNumber: integer("switch_port_number"), // Número da porta no switch
  // Voalle ERP integration - Contract tag (etiqueta = conexão no Voalle)
  voalleContractTagId: integer("voalle_contract_tag_id"),
  voalleContractTagServiceTag: varchar("voalle_contract_tag_service_tag", { length: 100 }),
  voalleContractTagDescription: text("voalle_contract_tag_description"),
  // Voalle integration - Connection data from API Portal
  voalleConnectionId: integer("voalle_connection_id"), // ID da conexão/autenticação no Voalle
  voalleContractNumber: varchar("voalle_contract_number", { length: 50 }), // Número do contrato
  concentratorId: integer("concentrator_id"), // Concentrador SNMP para coleta de tráfego
  // Origem dos dados de tráfego SNMP: 'manual' (IP direto), 'concentrator' (via concentrador), 'accessPoint' (via switch de acesso/PE)
  trafficSourceType: varchar("traffic_source_type", { length: 20 }).notNull().default("manual"),
  accessPointId: integer("access_point_id"), // ID do switch usado como ponto de acesso para coleta de tráfego (para links L2 com RSTP)
  accessPointInterfaceIndex: integer("access_point_interface_index"), // ifIndex da interface no ponto de acesso
  accessPointInterfaceName: varchar("access_point_interface_name", { length: 100 }), // Nome da interface no ponto de acesso
  slotOlt: integer("slot_olt"), // Slot na OLT
  portOlt: integer("port_olt"), // Porta na OLT  
  equipmentSerialNumber: varchar("equipment_serial_number", { length: 100 }), // Serial da ONU/ONT
  latitude: varchar("latitude", { length: 30 }), // Coordenada latitude
  longitude: varchar("longitude", { length: 30 }), // Coordenada longitude
  // Interface auto-discovery fields for dynamic ifIndex handling
  lastIfIndexValidation: timestamp("last_if_index_validation"),
  ifIndexMismatchCount: integer("if_index_mismatch_count").notNull().default(0),
  originalIfName: varchar("original_if_name", { length: 100 }),
  // Inverter direção de banda (download ↔ upload) para interfaces de concentrador
  invertBandwidth: boolean("invert_bandwidth").notNull().default(false),
  // Monitoramento de Sinal Óptico
  opticalMonitoringEnabled: boolean("optical_monitoring_enabled").notNull().default(false),
  opticalRxBaseline: real("optical_rx_baseline"), // Sinal de referência após instalação/reparo (ex: -18 dBm)
  opticalTxBaseline: real("optical_tx_baseline"), // Sinal TX de referência
  splitterId: integer("splitter_id"), // ID do splitter para correlação de eventos
  // Dados de splitter vindos do Zabbix (auto-preenchidos)
  zabbixSplitterName: varchar("zabbix_splitter_name", { length: 100 }), // Nome do splitter do Zabbix
  zabbixSplitterPort: varchar("zabbix_splitter_port", { length: 20 }), // Porta do splitter do Zabbix
  zabbixOnuDistance: varchar("zabbix_onu_distance", { length: 20 }), // Distância da ONU (metros)
  zabbixLastSync: timestamp("zabbix_last_sync"), // Última sincronização com Zabbix
  opticalDeltaThreshold: real("optical_delta_threshold").default(3), // Variação máxima em dB antes de alertar
  // Tipo de transceiver SFP (para links PTP)
  sfpType: varchar("sfp_type", { length: 50 }), // sfp_10g_lr, sfp_10g_bidi, qsfp_40g_er4, gpon_onu, gpon_olt
  // OIDs para coleta SNMP de sinal óptico (variam por fabricante)
  opticalRxOid: varchar("optical_rx_oid", { length: 255 }), // OID para potência RX na ONU
  opticalTxOid: varchar("optical_tx_oid", { length: 255 }), // OID para potência TX na ONU
  opticalOltRxOid: varchar("optical_olt_rx_oid", { length: 255 }), // OID para RX na OLT
  // Credenciais do CPE/Roteador do cliente
  cpeVendor: varchar("cpe_vendor", { length: 50 }), // Fabricante: mikrotik, ubiquiti, cisco, etc
  cpeUser: varchar("cpe_user", { length: 100 }), // Usuário de acesso ao CPE
  cpePassword: text("cpe_password"), // Senha do CPE (armazenada criptografada)
  cpeWebPort: integer("cpe_web_port").default(80), // Porta HTTP/HTTPS
  cpeWebProtocol: varchar("cpe_web_protocol", { length: 10 }).default("http"), // http ou https
  cpeSshPort: integer("cpe_ssh_port").default(22), // Porta SSH
  cpeWinboxPort: integer("cpe_winbox_port").default(8291), // Porta Winbox (Mikrotik)
  // Link L2: Sem IP monitorado, status baseado na porta do switch/concentrador
  isL2Link: boolean("is_l2_link").notNull().default(false),
  // Integração OZmap - Etiqueta do cliente no OZmap para rastreamento de fibra
  ozmapTag: varchar("ozmap_tag", { length: 100 }),
  // Dados de splitter e rota vindos do OZmap (auto-preenchidos, prioridade sobre Zabbix)
  ozmapSplitterName: varchar("ozmap_splitter_name", { length: 150 }), // Nome do splitter do OZmap
  ozmapSplitterPort: varchar("ozmap_splitter_port", { length: 20 }), // Porta do splitter do OZmap
  ozmapDistance: real("ozmap_distance"), // Distância total em km (do OZmap)
  ozmapArrivingPotency: real("ozmap_arriving_potency"), // Potência de chegada calculada (dBm)
  ozmapAttenuation: real("ozmap_attenuation"), // Atenuação total (dB)
  ozmapOltName: varchar("ozmap_olt_name", { length: 150 }), // Nome da OLT do OZmap
  ozmapSlot: integer("ozmap_slot"), // Slot da OLT
  ozmapPort: integer("ozmap_port"), // Porta da OLT
  ozmapPonReached: boolean("ozmap_pon_reached"), // Se a PON foi alcançada
  ozmapLastSync: timestamp("ozmap_last_sync"), // Última sincronização com OZmap
  // Modo do gráfico principal: 'primary' (coleta atual), 'single' (uma interface), 'aggregate' (soma de interfaces)
  mainGraphMode: varchar("main_graph_mode", { length: 20 }).notNull().default("primary"),
  // IDs das interfaces adicionais para agregação (usado quando mainGraphMode = 'aggregate' ou 'single')
  mainGraphInterfaceIds: integer("main_graph_interface_ids").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Múltiplas interfaces de tráfego por link para gráficos compostos (ex: L2 + L3 no mesmo gráfico)
export const linkTrafficInterfaces = pgTable("link_traffic_interfaces", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  label: varchar("label", { length: 100 }).notNull(), // Legenda no gráfico (ex: "L2 Físico", "L3 IPv4")
  // Tipo de origem: 'manual' (IP+perfil), 'concentrator' (via concentrador), 'switch' (via switch de acesso)
  sourceType: varchar("source_type", { length: 20 }).notNull().default("manual"),
  // Para sourceType = 'manual': usar estes campos
  ipAddress: varchar("ip_address", { length: 45 }), // IP do equipamento para coleta SNMP
  snmpProfileId: integer("snmp_profile_id"), // Perfil SNMP para coleta
  // Para sourceType = 'concentrator' ou 'switch': usar este campo
  sourceEquipmentId: integer("source_equipment_id"), // ID do concentrador ou switch
  // Dados da interface
  ifIndex: integer("if_index").notNull(), // Índice da interface SNMP
  ifName: varchar("if_name", { length: 100 }), // Nome da interface (para referência)
  ifDescr: text("if_descr"), // Descrição da interface
  // Configurações de exibição
  color: varchar("color", { length: 7 }).notNull().default("#3b82f6"), // Cor hex no gráfico
  displayOrder: integer("display_order").notNull().default(0), // Ordem de exibição
  invertBandwidth: boolean("invert_bandwidth").notNull().default(false), // Inverter download/upload
  isEnabled: boolean("is_enabled").notNull().default(true), // Ativar/desativar coleta
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const hosts = pgTable("hosts", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  hostType: varchar("host_type", { length: 50 }).notNull().default("server"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  latencyThreshold: real("latency_threshold").notNull().default(80),
  packetLossThreshold: real("packet_loss_threshold").notNull().default(2),
  lastStatus: varchar("last_status", { length: 20 }).notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at"),
  snmpProfileId: integer("snmp_profile_id"),
  snmpInterfaceIndex: integer("snmp_interface_index"),
  snmpInterfaceName: varchar("snmp_interface_name", { length: 100 }),
  snmpInterfaceDescr: text("snmp_interface_descr"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Link Groups - Agrupa links para visualização consolidada
// Perfil "redundancy": Ativo/Passivo - foco no uptime, considera online se qualquer membro estiver online
// Perfil "aggregation": Dual-Stack/Bonding - foco no volume, soma a banda de todos os membros
// Perfil "shared": Banda Compartilhada - múltiplos links/VLANs compartilham a mesma banda contratada
//   - Banda: usa a banda do link 'primary' (não soma)
//   - Status: degradado se qualquer membro offline, online se todos online
//   - Uso: soma o tráfego real de todos os membros (para análise de distribuição)
export const linkGroups = pgTable("link_groups", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Tipo do grupo: 'redundancy' (ativo/passivo), 'aggregation' (soma de banda) ou 'shared' (banda compartilhada)
  groupType: varchar("group_type", { length: 20 }).notNull().default("redundancy"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Membros de um grupo de links
export const linkGroupMembers = pgTable("link_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  linkId: integer("link_id").notNull(),
  // Papel do link no grupo: 'primary', 'backup', 'ipv4', 'ipv6', 'member'
  role: varchar("role", { length: 20 }).notNull().default("member"),
  // Ordem de exibição/prioridade (menor = mais prioritário)
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const snmpProfiles = pgTable("snmp_profiles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"), // Nullable para perfis globais (concentradores)
  name: text("name").notNull(),
  version: varchar("version", { length: 10 }).notNull().default("v2c"),
  port: integer("port").notNull().default(161),
  community: varchar("community", { length: 100 }),
  securityLevel: varchar("security_level", { length: 20 }),
  authProtocol: varchar("auth_protocol", { length: 10 }),
  authPassword: text("auth_password"),
  privProtocol: varchar("priv_protocol", { length: 10 }),
  privPassword: text("priv_password"),
  username: varchar("username", { length: 100 }),
  timeout: integer("timeout").notNull().default(5000),
  retries: integer("retries").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Equipment vendors with pre-configured SNMP OIDs for CPU/Memory/Optical
export const equipmentVendors = pgTable("equipment_vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  cpuOid: varchar("cpu_oid", { length: 255 }),
  cpuDivisor: integer("cpu_divisor").notNull().default(1), // Divisor para CPU (ex: 100 para valores como 3315 -> 33.15%)
  memoryOid: varchar("memory_oid", { length: 255 }),
  memoryTotalOid: varchar("memory_total_oid", { length: 255 }),
  memoryUsedOid: varchar("memory_used_oid", { length: 255 }),
  memoryIsPercentage: boolean("memory_is_percentage").notNull().default(true),
  // OIDs padrão para monitoramento de sinal óptico de OLTs deste fabricante
  opticalRxOid: varchar("optical_rx_oid", { length: 255 }),
  opticalTxOid: varchar("optical_tx_oid", { length: 255 }),
  opticalOltRxOid: varchar("optical_olt_rx_oid", { length: 255 }),
  // OIDs padrão para monitoramento de sinal óptico de Switches deste fabricante (portas SFP)
  // Template com variável {portIndex} para índice SNMP da porta
  switchOpticalRxOid: varchar("switch_optical_rx_oid", { length: 255 }),
  switchOpticalTxOid: varchar("switch_optical_tx_oid", { length: 255 }),
  // Template para calcular índice SNMP da porta do switch - variáveis: {slot}, {port}
  switchPortIndexTemplate: varchar("switch_port_index_template", { length: 100 }),
  // Divisor para conversão do valor SNMP para dBm (ex: 1000 para Mikrotik, 100 para outros)
  switchOpticalDivisor: integer("switch_optical_divisor").default(1000),
  // Perfil SNMP padrão para equipamentos deste fabricante
  snmpProfileId: integer("snmp_profile_id"),
  description: text("description"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Cadastro de CPEs (Customer Premises Equipment) - equipamentos nas instalações do cliente
export const cpes = pgTable("cpes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type", { length: 30 }).notNull().default("cpe"), // cpe, firewall, switch, router, onu
  vendorId: integer("vendor_id"), // FK para equipmentVendors
  model: varchar("model", { length: 100 }),
  // isStandard: equipamento padrão sem IP/MAC/serial fixo - IP definido no cadastro do link
  isStandard: boolean("is_standard").notNull().default(false),
  ipAddress: varchar("ip_address", { length: 45 }),
  // Indicador de acesso
  hasAccess: boolean("has_access").notNull().default(true), // false = equipamento do cliente sem acesso
  ownership: varchar("ownership", { length: 20 }).notNull().default("marvitel"), // marvitel, client
  // Credenciais Web
  webProtocol: varchar("web_protocol", { length: 10 }).default("http"), // http, https
  webPort: integer("web_port").default(80),
  webUser: varchar("web_user", { length: 100 }),
  webPassword: text("web_password"), // Criptografado
  // Credenciais SSH/Telnet
  sshPort: integer("ssh_port").default(22),
  sshUser: varchar("ssh_user", { length: 100 }),
  sshPassword: text("ssh_password"), // Criptografado
  // Winbox (Mikrotik)
  winboxPort: integer("winbox_port").default(8291),
  // Perfil SNMP (personalizado ou herda do fabricante)
  snmpProfileId: integer("snmp_profile_id"),
  // Métricas de monitoramento SNMP (CPU/Memória)
  cpuUsage: real("cpu_usage").notNull().default(0),
  memoryUsage: real("memory_usage").notNull().default(0),
  lastMonitoredAt: timestamp("last_monitored_at"),
  // Metadados
  serialNumber: varchar("serial_number", { length: 100 }),
  macAddress: varchar("mac_address", { length: 17 }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Associação entre Links e CPEs (muitos-para-muitos)
export const linkCpes = pgTable("link_cpes", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  cpeId: integer("cpe_id").notNull(),
  role: varchar("role", { length: 30 }).default("primary"), // primary, backup, firewall
  // IP específico para este link (usado quando CPE é isStandard=true ou para override)
  ipOverride: varchar("ip_override", { length: 45 }),
  // Se true, este CPE aparece na aba "Equipamento" nos detalhes do link
  showInEquipmentTab: boolean("show_in_equipment_tab").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Métricas por instância (para CPEs padrão com múltiplas instâncias)
  cpuUsage: real("cpu_usage"),
  memoryUsage: real("memory_usage"),
  lastMonitoredAt: timestamp("last_monitored_at"),
});

export const mibConfigs = pgTable("mib_configs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(),
  oid: varchar("oid", { length: 255 }).notNull(),
  metricType: varchar("metric_type", { length: 50 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  scaleFactor: real("scale_factor").notNull().default(1),
  pollInterval: integer("poll_interval").notNull().default(60),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const hostMibConfigs = pgTable("host_mib_configs", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull(),
  mibConfigId: integer("mib_config_id").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Configurações globais de thresholds ópticos
export const opticalSettings = pgTable("optical_settings", {
  id: serial("id").primaryKey(),
  // Thresholds de potência RX (em dBm) - valores negativos
  rxNormalMin: real("rx_normal_min").notNull().default(-25), // -15 a -25 = Normal
  rxWarningMin: real("rx_warning_min").notNull().default(-28), // -25.1 a -27.9 = Atenção
  rxCriticalMin: real("rx_critical_min").notNull().default(-30), // < -28 = Crítico
  // Thresholds de potência TX (em dBm)
  txNormalMin: real("tx_normal_min").notNull().default(0),
  txWarningMin: real("tx_warning_min").notNull().default(-2),
  txCriticalMin: real("tx_critical_min").notNull().default(-5),
  // Delta de variação para alertar (em dB)
  deltaThreshold: real("delta_threshold").notNull().default(3),
  // Período de comparação para delta (em horas)
  deltaComparisonPeriod: integer("delta_comparison_period").notNull().default(24),
  // Mínimo de clientes para evento massivo
  massiveEventThreshold: integer("massive_event_threshold").notNull().default(3),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Splitters para correlação de eventos massivos
export const splitters = pgTable("splitters", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  oltId: integer("olt_id"), // OLT associada
  name: text("name").notNull(),
  location: text("location"),
  splitterType: varchar("splitter_type", { length: 20 }).notNull().default("1:8"), // 1:8, 1:16, 1:32, 1:64
  parentSplitterId: integer("parent_splitter_id"), // Para cascata de splitters
  cableId: varchar("cable_id", { length: 50 }), // Identificador do cabo alimentador
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  download: real("download").notNull(),
  upload: real("upload").notNull(),
  latency: real("latency").notNull(),
  packetLoss: real("packet_loss").notNull(),
  cpuUsage: real("cpu_usage").notNull(),
  memoryUsage: real("memory_usage").notNull(),
  errorRate: real("error_rate").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("operational"),
  // Métricas de Sinal Óptico (em dBm)
  opticalRxPower: real("optical_rx_power"), // Potência RX na ONU (downstream)
  opticalTxPower: real("optical_tx_power"), // Potência TX na ONU
  opticalOltRxPower: real("optical_olt_rx_power"), // Potência RX na OLT (upstream do cliente)
  opticalStatus: varchar("optical_status", { length: 20 }), // normal, warning, critical
});

// Métricas de interfaces de tráfego adicionais (para gráficos compostos L2+L3)
export const trafficInterfaceMetrics = pgTable("traffic_interface_metrics", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  trafficInterfaceId: integer("traffic_interface_id").notNull(), // FK para linkTrafficInterfaces
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  download: real("download").notNull(), // bps
  upload: real("upload").notNull(), // bps
});

export const metricsHourly = pgTable("metrics_hourly", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  bucketStart: timestamp("bucket_start").notNull(),
  downloadAvg: real("download_avg").notNull(),
  downloadMax: real("download_max").notNull(),
  downloadMin: real("download_min").notNull(),
  uploadAvg: real("upload_avg").notNull(),
  uploadMax: real("upload_max").notNull(),
  uploadMin: real("upload_min").notNull(),
  latencyAvg: real("latency_avg").notNull(),
  latencyMax: real("latency_max").notNull(),
  latencyMin: real("latency_min").notNull(),
  packetLossAvg: real("packet_loss_avg").notNull(),
  packetLossMax: real("packet_loss_max").notNull(),
  cpuUsageAvg: real("cpu_usage_avg").notNull(),
  memoryUsageAvg: real("memory_usage_avg").notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  operationalCount: integer("operational_count").notNull().default(0),
  degradedCount: integer("degraded_count").notNull().default(0),
  offlineCount: integer("offline_count").notNull().default(0),
});

export const metricsDaily = pgTable("metrics_daily", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  bucketStart: timestamp("bucket_start").notNull(),
  downloadAvg: real("download_avg").notNull(),
  downloadMax: real("download_max").notNull(),
  downloadMin: real("download_min").notNull(),
  uploadAvg: real("upload_avg").notNull(),
  uploadMax: real("upload_max").notNull(),
  uploadMin: real("upload_min").notNull(),
  latencyAvg: real("latency_avg").notNull(),
  latencyMax: real("latency_max").notNull(),
  latencyMin: real("latency_min").notNull(),
  packetLossAvg: real("packet_loss_avg").notNull(),
  packetLossMax: real("packet_loss_max").notNull(),
  cpuUsageAvg: real("cpu_usage_avg").notNull(),
  memoryUsageAvg: real("memory_usage_avg").notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  operationalCount: integer("operational_count").notNull().default(0),
  degradedCount: integer("degraded_count").notNull().default(0),
  offlineCount: integer("offline_count").notNull().default(0),
  uptimePercentage: real("uptime_percentage").notNull().default(100),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
});

export const ddosEvents = pgTable("ddos_events", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  attackType: varchar("attack_type", { length: 100 }).notNull(),
  startTime: timestamp("start_time").notNull().defaultNow(),
  endTime: timestamp("end_time"),
  peakBandwidth: real("peak_bandwidth").notNull(),
  mitigationStatus: varchar("mitigation_status", { length: 20 }).notNull().default("detected"),
  sourceIps: integer("source_ips").notNull().default(0),
  blockedPackets: integer("blocked_packets").notNull().default(0),
  wanguardAnomalyId: integer("wanguard_anomaly_id"),
  wanguardSensor: varchar("wanguard_sensor", { length: 100 }),
  targetIp: varchar("target_ip", { length: 45 }),
  decoder: varchar("decoder", { length: 100 }),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  clientId: integer("client_id").notNull(),
  protocol: varchar("protocol", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("aberto"),
  failureReason: varchar("failure_reason", { length: 255 }),
  failureSource: varchar("failure_source", { length: 255 }),
  description: text("description"),
  erpSystem: varchar("erp_system", { length: 100 }),
  erpTicketId: varchar("erp_ticket_id", { length: 100 }),
  erpTicketStatus: varchar("erp_ticket_status", { length: 50 }),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  lastUpdateAt: timestamp("last_update_at").notNull().defaultNow(),
  slaDeadline: timestamp("sla_deadline"),
  closedAt: timestamp("closed_at"),
  repairTeam: text("repair_team"),
  repairNotes: text("repair_notes"),
});

export const clientSettings = pgTable("client_settings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique(),
  slaAvailability: real("sla_availability").notNull().default(99.0),
  slaLatency: real("sla_latency").notNull().default(80),
  slaPacketLoss: real("sla_packet_loss").notNull().default(2),
  slaRepairTime: integer("sla_repair_time").notNull().default(6),
  dataRetentionDays: integer("data_retention_days").notNull().default(180),
  contractDuration: integer("contract_duration").default(12),
  contractMonthlyValue: real("contract_monthly_value"),
  contractAnnualValue: real("contract_annual_value"),
  contractBidNumber: varchar("contract_bid_number", { length: 50 }),
  supportPhone: varchar("support_phone", { length: 50 }),
  supportEmail: varchar("support_email", { length: 255 }),
  supportPortalUrl: text("support_portal_url"),
  supportResponseTime: integer("support_response_time").default(3),
  supportRepairTime: integer("support_repair_time").default(6),
  oltApiEndpoint: text("olt_api_endpoint"),
  oltApiKey: text("olt_api_key"),
  erpApiEndpoint: text("erp_api_endpoint"),
  erpApiKey: text("erp_api_key"),
  voalleApiUrl: text("voalle_api_url"),
  voalleClientId: varchar("voalle_client_id", { length: 100 }),
  voalleClientSecret: text("voalle_client_secret"),
  voalleSynV1Token: text("voalle_syn_v1_token"),
  voalleSolicitationTypeCode: varchar("voalle_solicitation_type_code", { length: 50 }),
  voalleEnabled: boolean("voalle_enabled").notNull().default(false),
  voalleAutoCreateTicket: boolean("voalle_auto_create_ticket").notNull().default(false),
  wanguardApiEndpoint: text("wanguard_api_endpoint"),
  wanguardApiUser: varchar("wanguard_api_user", { length: 100 }),
  wanguardApiPassword: text("wanguard_api_password"),
  wanguardEnabled: boolean("wanguard_enabled").notNull().default(false),
  wanguardSyncInterval: integer("wanguard_sync_interval").notNull().default(60),
  ddosMitigationCapacity: real("ddos_mitigation_capacity").notNull().default(2),
  notificationEmail: varchar("notification_email", { length: 255 }),
  notificationSms: varchar("notification_sms", { length: 50 }),
  notifyEmailEnabled: boolean("notify_email_enabled").notNull().default(true),
  notifySmsEnabled: boolean("notify_sms_enabled").notNull().default(false),
  notifyDdosEnabled: boolean("notify_ddos_enabled").notNull().default(true),
  autoRefreshInterval: integer("auto_refresh_interval").notNull().default(5),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const eventTypes = pgTable("event_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  severity: varchar("severity", { length: 20 }).notNull().default("medium"),
  category: varchar("category", { length: 50 }).notNull(),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientEventSettings = pgTable("client_event_settings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  eventTypeId: integer("event_type_id").notNull(),
  autoCreateTicket: boolean("auto_create_ticket").notNull().default(false),
  voalleSolicitationTypeCode: varchar("voalle_solicitation_type_code", { length: 50 }),
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(false),
  priority: varchar("priority", { length: 20 }).notNull().default("media"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Concentradores SNMP (BNG/BRAS) - recursos globais para coleta de tráfego
// Cadastro global com fabricante e configuração SNMP
export const snmpConcentrators = pgTable("snmp_concentrators", {
  id: serial("id").primaryKey(),
  voalleId: integer("voalle_id"), // ID do concentrador no Voalle (authenticationConcentrator.id)
  name: text("name").notNull(), // Ex: "CE: AJU-MVT-BORDA-HSP"
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  snmpProfileId: integer("snmp_profile_id"), // Perfil SNMP para coleta de tráfego
  equipmentVendorId: integer("equipment_vendor_id"), // Fabricante (Huawei, Cisco, etc)
  model: varchar("model", { length: 100 }),
  description: text("description"),
  // Credenciais de acesso SSH/CLI
  sshUser: varchar("ssh_user", { length: 100 }),
  sshPassword: text("ssh_password"), // Armazenado criptografado
  sshPort: integer("ssh_port").default(22),
  useOperatorCredentials: boolean("use_operator_credentials").default(false), // Usar credenciais SSH do operador logado
  webPort: integer("web_port").default(80), // Porta HTTP/HTTPS para acesso web
  webProtocol: varchar("web_protocol", { length: 10 }).default("http"), // http ou https
  winboxPort: integer("winbox_port").default(8291), // Porta Winbox para Mikrotik
  vendor: varchar("vendor", { length: 50 }), // mikrotik, cisco, huawei, etc
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// OLTs são recursos globais - não vinculadas a um cliente específico
// A relação cliente-OLT é feita através dos links (link.oltId + link.clientId)
// connectionType pode ser: telnet, ssh, mysql (para consultas ao banco Zabbix)
export const olts = pgTable("olts", {
  id: serial("id").primaryKey(),
  voalleId: integer("voalle_id"), // ID da OLT/Access Point no Voalle (authenticationAccessPoint.id)
  name: text("name").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  port: integer("port").notNull().default(23),
  username: varchar("username", { length: 100 }).notNull(),
  password: text("password").notNull(),
  connectionType: varchar("connection_type", { length: 20 }).notNull().default("telnet"),
  vendor: varchar("vendor", { length: 50 }),
  winboxPort: integer("winbox_port").default(8291), // Porta Winbox para Mikrotik
  model: varchar("model", { length: 100 }),
  database: varchar("database", { length: 100 }), // Para conexões MySQL (ex: Zabbix)
  // Templates para busca e diagnóstico de ONU - variáveis: {serial}, {slot}, {port}, {onuId}
  searchOnuCommand: text("search_onu_command"), // Ex: "sh onu serial {serial}" ou "show interface gpon onu | include {serial}"
  diagnosisKeyTemplate: text("diagnosis_key_template"), // Ex: "1/{slot}/{port}/{onuId}" ou "{serial}"
  // Perfil SNMP para coleta de sinal óptico (usa cadastro global de perfis)
  snmpProfileId: integer("snmp_profile_id"), // Referência ao perfil SNMP para coleta óptica
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Switches para links Ponto-a-Ponto (PTP) - similar a OLTs mas para conexões diretas
// A relação cliente-Switch é feita através dos links (link.switchId + link.clientId)
export const switches = pgTable("switches", {
  id: serial("id").primaryKey(),
  voalleId: integer("voalle_id"), // ID do Switch/Access Point no Voalle (authenticationAccessPoint.id)
  name: text("name").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  vendor: varchar("vendor", { length: 50 }), // Slug do fabricante (ex: "mikrotik", "datacom") - legado
  vendorId: integer("vendor_id"), // FK para equipmentVendors - preferencial
  model: varchar("model", { length: 100 }),
  // Credenciais de acesso SSH/Web
  sshUser: varchar("ssh_user", { length: 100 }).default("admin"),
  sshPassword: text("ssh_password"), // Criptografado
  sshPort: integer("ssh_port").default(22),
  webPort: integer("web_port").default(80),
  webProtocol: varchar("web_protocol", { length: 10 }).default("http"),
  winboxPort: integer("winbox_port").default(8291),
  // SNMP para coleta de sinal óptico das portas SFP
  snmpProfileId: integer("snmp_profile_id"), // Referência ao perfil SNMP
  // OIDs para sinal óptico das portas SFP - variável: {portIndex}
  opticalRxOidTemplate: varchar("optical_rx_oid_template", { length: 255 }), // Ex: 1.3.6.1.4.1.3709.3.5.201.1.4.1.1.7.{portIndex}
  opticalTxOidTemplate: varchar("optical_tx_oid_template", { length: 255 }), // Ex: 1.3.6.1.4.1.3709.3.5.201.1.4.1.1.6.{portIndex}
  // Template para calcular índice SNMP da porta - variáveis: {slot}, {port}
  portIndexTemplate: varchar("port_index_template", { length: 100 }), // Ex: "{slot}*8+{port}" ou apenas o número da porta
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Cache de mapeamento de sensores ópticos para switches com Entity MIB (Cisco Nexus, etc)
// Usado para armazenar o mapeamento entre porta física e entPhysicalIndex dos sensores
export const switchSensorCache = pgTable("switch_sensor_cache", {
  id: serial("id").primaryKey(),
  switchId: integer("switch_id").notNull(), // FK para switches
  portName: varchar("port_name", { length: 100 }).notNull(), // Nome da porta (ex: "Ethernet1/1")
  rxSensorIndex: varchar("rx_sensor_index", { length: 50 }), // entPhysicalIndex do sensor RX Power
  txSensorIndex: varchar("tx_sensor_index", { length: 50 }), // entPhysicalIndex do sensor TX Power
  tempSensorIndex: varchar("temp_sensor_index", { length: 50 }), // entPhysicalIndex do sensor Temperatura (opcional)
  lastDiscovery: timestamp("last_discovery").notNull().defaultNow(), // Última vez que o discovery foi executado
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Firewall - Whitelist de IPs para acesso administrativo e SSH
export const firewallWhitelist = pgTable("firewall_whitelist", {
  id: serial("id").primaryKey(),
  ipAddress: varchar("ip_address", { length: 50 }).notNull(), // IPv4/IPv6 ou CIDR (ex: 192.168.1.0/24, 2001:db8::/32)
  description: text("description"), // Descrição do IP (ex: "Escritório Marvitel")
  allowAdmin: boolean("allow_admin").notNull().default(true), // Permitir acesso à porta admin (5001)
  allowSsh: boolean("allow_ssh").notNull().default(true), // Permitir acesso SSH
  allowApi: boolean("allow_api").notNull().default(false), // Permitir acesso API (futuro)
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by"), // ID do usuário que criou
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Configurações globais do Firewall
export const firewallSettings = pgTable("firewall_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false), // Firewall ativo/inativo
  defaultDenyAdmin: boolean("default_deny_admin").notNull().default(true), // Negar por padrão acesso admin
  defaultDenySsh: boolean("default_deny_ssh").notNull().default(true), // Negar por padrão acesso SSH
  logBlockedAttempts: boolean("log_blocked_attempts").notNull().default(true), // Logar tentativas bloqueadas
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by"), // ID do usuário que atualizou
});

export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true, lastLoginAt: true });
export const insertLinkSchema = createInsertSchema(links).omit({ id: true, lastUpdated: true, createdAt: true });
export const insertHostSchema = createInsertSchema(hosts).omit({ id: true, createdAt: true, updatedAt: true, lastCheckedAt: true });
export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true, timestamp: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, timestamp: true });
export const insertDDoSEventSchema = createInsertSchema(ddosEvents).omit({ id: true, startTime: true });
export const insertIncidentSchema = createInsertSchema(incidents).omit({ id: true, openedAt: true, lastUpdateAt: true });
export const insertClientSettingsSchema = createInsertSchema(clientSettings).omit({ id: true, updatedAt: true });
export const insertGroupSchema = createInsertSchema(groups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export const insertGroupPermissionSchema = createInsertSchema(groupPermissions).omit({ id: true, createdAt: true });
export const insertSnmpProfileSchema = createInsertSchema(snmpProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEquipmentVendorSchema = createInsertSchema(equipmentVendors).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMibConfigSchema = createInsertSchema(mibConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHostMibConfigSchema = createInsertSchema(hostMibConfigs).omit({ id: true, createdAt: true });
export const insertEventTypeSchema = createInsertSchema(eventTypes).omit({ id: true, createdAt: true });
export const insertClientEventSettingSchema = createInsertSchema(clientEventSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOltSchema = createInsertSchema(olts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSwitchSchema = createInsertSchema(switches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSwitchSensorCacheSchema = createInsertSchema(switchSensorCache).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSnmpConcentratorSchema = createInsertSchema(snmpConcentrators).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLinkGroupSchema = createInsertSchema(linkGroups).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLinkGroupMemberSchema = createInsertSchema(linkGroupMembers).omit({ id: true, createdAt: true });
export const insertOpticalSettingsSchema = createInsertSchema(opticalSettings).omit({ id: true, updatedAt: true });
export const insertSplitterSchema = createInsertSchema(splitters).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCpeSchema = createInsertSchema(cpes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLinkCpeSchema = createInsertSchema(linkCpes).omit({ id: true, createdAt: true });
export const insertFirewallWhitelistSchema = createInsertSchema(firewallWhitelist).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFirewallSettingsSchema = createInsertSchema(firewallSettings).omit({ id: true, updatedAt: true });
export const insertLinkTrafficInterfaceSchema = createInsertSchema(linkTrafficInterfaces).omit({ id: true, createdAt: true });
export const insertTrafficInterfaceMetricSchema = createInsertSchema(trafficInterfaceMetrics).omit({ id: true, timestamp: true });

export type InsertClient = z.infer<typeof insertClientSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertLink = z.infer<typeof insertLinkSchema>;
export type InsertHost = z.infer<typeof insertHostSchema>;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type InsertMetricHourly = Omit<typeof metricsHourly.$inferSelect, 'id'>;
export type InsertMetricDaily = Omit<typeof metricsDaily.$inferSelect, 'id'>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertDDoSEvent = z.infer<typeof insertDDoSEventSchema>;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type InsertClientSettings = z.infer<typeof insertClientSettingsSchema>;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type InsertGroupPermission = z.infer<typeof insertGroupPermissionSchema>;
export type InsertSnmpProfile = z.infer<typeof insertSnmpProfileSchema>;
export type InsertEquipmentVendor = z.infer<typeof insertEquipmentVendorSchema>;
export type InsertMibConfig = z.infer<typeof insertMibConfigSchema>;
export type InsertHostMibConfig = z.infer<typeof insertHostMibConfigSchema>;
export type InsertEventType = z.infer<typeof insertEventTypeSchema>;
export type InsertClientEventSetting = z.infer<typeof insertClientEventSettingSchema>;
export type InsertOlt = z.infer<typeof insertOltSchema>;
export type InsertSwitch = z.infer<typeof insertSwitchSchema>;
export type InsertSwitchSensorCache = z.infer<typeof insertSwitchSensorCacheSchema>;
export type InsertSnmpConcentrator = z.infer<typeof insertSnmpConcentratorSchema>;
export type InsertLinkGroup = z.infer<typeof insertLinkGroupSchema>;
export type InsertLinkGroupMember = z.infer<typeof insertLinkGroupMemberSchema>;
export type InsertOpticalSettings = z.infer<typeof insertOpticalSettingsSchema>;
export type InsertSplitter = z.infer<typeof insertSplitterSchema>;
export type InsertCpe = z.infer<typeof insertCpeSchema>;
export type InsertLinkCpe = z.infer<typeof insertLinkCpeSchema>;
export type InsertFirewallWhitelist = z.infer<typeof insertFirewallWhitelistSchema>;
export type InsertFirewallSettings = z.infer<typeof insertFirewallSettingsSchema>;
export type InsertLinkTrafficInterface = z.infer<typeof insertLinkTrafficInterfaceSchema>;
export type InsertTrafficInterfaceMetric = z.infer<typeof insertTrafficInterfaceMetricSchema>;

export type Client = typeof clients.$inferSelect;
export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type Host = typeof hosts.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type MetricHourly = typeof metricsHourly.$inferSelect;
export type MetricDaily = typeof metricsDaily.$inferSelect;
export type Event = typeof events.$inferSelect;
export type DDoSEvent = typeof ddosEvents.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type ClientSettings = typeof clientSettings.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type GroupPermission = typeof groupPermissions.$inferSelect;
export type SnmpProfile = typeof snmpProfiles.$inferSelect;
export type EquipmentVendor = typeof equipmentVendors.$inferSelect;
export type MibConfig = typeof mibConfigs.$inferSelect;
export type HostMibConfig = typeof hostMibConfigs.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type ClientEventSetting = typeof clientEventSettings.$inferSelect;
export type Olt = typeof olts.$inferSelect;
export type Switch = typeof switches.$inferSelect;
export type SwitchSensorCache = typeof switchSensorCache.$inferSelect;
export type SnmpConcentrator = typeof snmpConcentrators.$inferSelect;
export type LinkGroup = typeof linkGroups.$inferSelect;
export type LinkGroupMember = typeof linkGroupMembers.$inferSelect;
export type OpticalSettings = typeof opticalSettings.$inferSelect;
export type Splitter = typeof splitters.$inferSelect;
export type Cpe = typeof cpes.$inferSelect;
export type LinkCpe = typeof linkCpes.$inferSelect;
export type FirewallWhitelist = typeof firewallWhitelist.$inferSelect;
export type FirewallSettings = typeof firewallSettings.$inferSelect;
export type LinkTrafficInterface = typeof linkTrafficInterfaces.$inferSelect;
export type TrafficInterfaceMetric = typeof trafficInterfaceMetrics.$inferSelect;

// ERP Integrations - Global configuration for ERP systems (Voalle, IXC, SGP)
export const erpIntegrations = pgTable("erp_integrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: varchar("provider", { length: 20 }).notNull(), // voalle, ixc, sgp
  connectionType: varchar("connection_type", { length: 20 }).notNull(), // api, database
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  
  // API Configuration
  apiUrl: text("api_url"),
  apiAuthUrl: text("api_auth_url"),
  apiClientId: varchar("api_client_id", { length: 255 }),
  apiClientSecret: text("api_client_secret"),
  apiToken: text("api_token"),
  apiSynV1Token: text("api_syn_v1_token"), // Voalle specific
  
  // Database Configuration
  dbHost: varchar("db_host", { length: 255 }),
  dbPort: integer("db_port"),
  dbName: varchar("db_name", { length: 100 }),
  dbUser: varchar("db_user", { length: 100 }),
  dbPassword: text("db_password"),
  dbType: varchar("db_type", { length: 20 }), // mysql, postgresql, sqlserver
  
  // Provider-specific settings (JSON)
  providerConfig: text("provider_config"), // JSON with provider-specific fields
  
  // Ticket/Solicitation settings
  defaultSolicitationTypeCode: varchar("default_solicitation_type_code", { length: 50 }),
  autoCreateTicket: boolean("auto_create_ticket").notNull().default(false),
  
  lastTestedAt: timestamp("last_tested_at"),
  lastTestStatus: varchar("last_test_status", { length: 20 }), // success, error
  lastTestError: text("last_test_error"),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Mapping between Link Monitor clients and ERP customers
export const clientErpMappings = pgTable("client_erp_mappings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(), // Link Monitor client
  erpIntegrationId: integer("erp_integration_id").notNull(), // Which ERP integration
  erpCustomerId: varchar("erp_customer_id", { length: 100 }).notNull(), // Customer ID in ERP
  erpCustomerCode: varchar("erp_customer_code", { length: 50 }), // Customer code in ERP
  erpCustomerName: text("erp_customer_name"), // Cached customer name from ERP
  isActive: boolean("is_active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertErpIntegrationSchema = createInsertSchema(erpIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientErpMappingSchema = createInsertSchema(clientErpMappings).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertErpIntegration = z.infer<typeof insertErpIntegrationSchema>;
export type InsertClientErpMapping = z.infer<typeof insertClientErpMappingSchema>;
export type ErpIntegration = typeof erpIntegrations.$inferSelect;
export type ClientErpMapping = typeof clientErpMappings.$inferSelect;

export type ErpProvider = "voalle" | "ixc" | "sgp";
export type ErpConnectionType = "api" | "database";

export type UserRole = "admin" | "operator" | "viewer";
export type LinkStatus = "operational" | "degraded" | "down" | "maintenance";
export type HostStatus = "online" | "offline" | "degraded" | "unknown";
export type FailureReason = "falha_eletrica" | "rompimento_fibra" | "falha_equipamento" | "indefinido" | null;
export type IncidentStatus = "aberto" | "em_andamento" | "aguardando_peca" | "resolvido" | "cancelado";

// Configurações globais de monitoramento (parâmetros de alerta e média móvel)
export const monitoringSettings = pgTable("monitoring_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estado de monitoramento em tempo real por link (para média móvel e persistência de alertas)
export const linkMonitoringState = pgTable("link_monitoring_state", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull().unique(),
  packetLossWindow: jsonb("packet_loss_window").notNull().default([]),
  packetLossAvg: real("packet_loss_avg").notNull().default(0),
  consecutiveLossBreaches: integer("consecutive_loss_breaches").notNull().default(0),
  lastAlertAt: timestamp("last_alert_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMonitoringSettingsSchema = createInsertSchema(monitoringSettings).omit({ id: true, updatedAt: true });
export const insertLinkMonitoringStateSchema = createInsertSchema(linkMonitoringState).omit({ id: true });
export type MonitoringSetting = typeof monitoringSettings.$inferSelect;
export type InsertMonitoringSetting = z.infer<typeof insertMonitoringSettingsSchema>;
export type LinkMonitoringState = typeof linkMonitoringState.$inferSelect;
export type InsertLinkMonitoringState = z.infer<typeof insertLinkMonitoringStateSchema>;

// ============ Audit Logs ============
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id"),
  actorUserId: integer("actor_user_id"),
  actorEmail: varchar("actor_email", { length: 255 }),
  actorName: text("actor_name"),
  actorRole: varchar("actor_role", { length: 50 }),
  action: varchar("action", { length: 50 }).notNull(),
  entity: varchar("entity", { length: 50 }),
  entityId: integer("entity_id"),
  entityName: text("entity_name"),
  previousValues: jsonb("previous_values"),
  newValues: jsonb("new_values"),
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  status: varchar("status", { length: 20 }).notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type AuditAction = 
  | "login" 
  | "logout" 
  | "login_failed" 
  | "create" 
  | "update" 
  | "delete" 
  | "config_change"
  | "system_update"
  | "backup_restore"
  | "password_change"
  | "permission_change"
  | "firewall_settings_update"
  | "firewall_whitelist_create"
  | "firewall_whitelist_update"
  | "firewall_whitelist_delete";

export type AuditEntity = 
  | "user" 
  | "client" 
  | "link" 
  | "host" 
  | "group" 
  | "incident" 
  | "snmp_profile" 
  | "equipment_vendor"
  | "concentrator"
  | "olt"
  | "settings"
  | "system";

export interface SLAIndicator {
  id: string;
  name: string;
  description: string;
  formula: string;
  target: string;
  current: number;
  periodicity: string;
  status: "compliant" | "warning" | "non_compliant";
}

export interface DashboardStats {
  totalLinks: number;
  operationalLinks: number;
  activeAlerts: number;
  averageUptime: number;
  averageLatency: number;
  totalBandwidth: number;
  ddosEventsToday: number;
  openIncidents: number;
}

export interface LinkStatusDetail {
  link: Link;
  failureInfo: {
    reason: string | null;
    reasonLabel: string;
    source: string | null;
    lastFailureAt: Date | null;
  };
  lastFailureInfo: {
    reason: string | null;
    reasonLabel: string;
    source: string | null;
    lastFailureAt: Date | null;
  } | null;
  activeIncident: Incident | null;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  clientId: number | null;
  clientName?: string;
  isSuperAdmin: boolean;
  permissions?: string[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// ============ RADIUS Authentication Settings ============
export const radiusSettings = pgTable("radius_settings", {
  id: serial("id").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  primaryHost: varchar("primary_host", { length: 255 }).notNull(),
  primaryPort: integer("primary_port").notNull().default(1812),
  sharedSecretEncrypted: text("shared_secret_encrypted").notNull(),
  secondaryHost: varchar("secondary_host", { length: 255 }),
  secondaryPort: integer("secondary_port").default(1812),
  secondarySecretEncrypted: text("secondary_secret_encrypted"),
  nasIdentifier: varchar("nas_identifier", { length: 100 }).default("LinkMonitor"),
  timeout: integer("timeout").notNull().default(5000),
  retries: integer("retries").notNull().default(3),
  allowLocalFallback: boolean("allow_local_fallback").notNull().default(true),
  // RADIUS para autenticação em dispositivos de rede (concentradores, APs, CPEs)
  useRadiusForDevices: boolean("use_radius_for_devices").notNull().default(false),
  lastHealthCheck: timestamp("last_health_check"),
  lastHealthStatus: varchar("last_health_status", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRadiusSettingsSchema = createInsertSchema(radiusSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type RadiusSettings = typeof radiusSettings.$inferSelect;
export type InsertRadiusSettings = z.infer<typeof insertRadiusSettingsSchema>;

// ============ RADIUS Group Mappings ============
export const radiusGroupMappings = pgTable("radius_group_mappings", {
  id: serial("id").primaryKey(),
  radiusGroupName: varchar("radius_group_name", { length: 255 }).notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  canManageSuperAdmins: boolean("can_manage_super_admins").notNull().default(false),
  defaultRole: varchar("default_role", { length: 50 }).notNull().default("viewer"),
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRadiusGroupMappingSchema = createInsertSchema(radiusGroupMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type RadiusGroupMapping = typeof radiusGroupMappings.$inferSelect;
export type InsertRadiusGroupMapping = z.infer<typeof insertRadiusGroupMappingSchema>;

// ============ Super Admin Link Dashboard Types ============
export interface LinkDashboardItem {
  id: number;
  name: string;
  identifier: string;
  location: string;
  ipBlock: string;
  bandwidth: number;
  status: string;
  currentDownload: number;
  currentUpload: number;
  latency: number;
  packetLoss: number;
  uptime: number;
  lastUpdated: string | Date;
  monitoringEnabled: boolean;
  // Client info
  clientId: number;
  clientName: string;
  // Active event (if any)
  activeEvent?: {
    id: number;
    type: string;
    description: string;
    severity: string;
    createdAt: string | Date;
  } | null;
  // Open incident/ticket (if any)
  openIncident?: {
    id: number;
    title: string;
    voalleProtocolId?: number | null;
    createdAt: string | Date;
  } | null;
}

export interface LinkDashboardSummary {
  totalLinks: number;
  onlineLinks: number;
  degradedLinks: number;
  offlineLinks: number;
  activeAlerts: number;
  openIncidents: number;
}

// External Service Integrations (HetrixTools, etc.)
export const externalIntegrations = pgTable("external_integrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: varchar("provider", { length: 50 }).notNull(), // hetrixtools, ozmap, etc.
  isActive: boolean("is_active").notNull().default(true),
  apiKey: text("api_key"),
  apiUrl: text("api_url"),
  checkIntervalHours: integer("check_interval_hours").notNull().default(12), // Intervalo de verificação automática em horas (HetrixTools)
  syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(5), // Intervalo de sincronização em minutos (OZmap)
  lastTestedAt: timestamp("last_tested_at"),
  lastTestStatus: varchar("last_test_status", { length: 20 }),
  lastTestError: text("last_test_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Blacklist check results cache
export const blacklistChecks = pgTable("blacklist_checks", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull(),
  ip: varchar("ip", { length: 45 }).notNull(),
  isListed: boolean("is_listed").notNull().default(false),
  listedOn: jsonb("listed_on").default([]), // Array of {rbl, delist}
  lastCheckedAt: timestamp("last_checked_at").notNull().defaultNow(),
  reportId: varchar("report_id", { length: 50 }),
  reportUrl: text("report_url"),
});

export const insertExternalIntegrationSchema = createInsertSchema(externalIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBlacklistCheckSchema = createInsertSchema(blacklistChecks).omit({ id: true });

export type InsertExternalIntegration = z.infer<typeof insertExternalIntegrationSchema>;
export type InsertBlacklistCheck = z.infer<typeof insertBlacklistCheckSchema>;
export type ExternalIntegration = typeof externalIntegrations.$inferSelect;
export type BlacklistCheck = typeof blacklistChecks.$inferSelect;

export interface LinkDashboardResponse {
  items: LinkDashboardItem[];
  summary: LinkDashboardSummary;
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
}
