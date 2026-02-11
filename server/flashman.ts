import { storage } from "./storage";

export interface FlashmanConfig {
  apiUrl: string;
  username: string;
  password: string;
}

export interface FlashmanDeviceInfo {
  _id: string;
  model: string;
  version: string;
  hw_version: string;
  installed_release: string;
  release: string;
  connection_type: string;
  pppoe_user: string;
  wan_ip: string;
  wan_negociated_speed: string;
  wan_negociated_duplex: string;
  ip: string;
  last_contact: string;
  uptime: string;
  sys_up_time: string;
  created_at: string;
  do_update: boolean;
  do_update_status: number;
  serial_tr069: string;
  alt_uid_tr069: string;
  acs_id: string;
  wifi_ssid: string;
  wifi_password: string;
  wifi_channel: string;
  wifi_band: string;
  wifi_mode: string;
  wifi_power: number;
  wifi_state: number;
  wifi_hidden: number;
  wifi_ssid_5ghz: string;
  wifi_password_5ghz: string;
  wifi_channel_5ghz: string;
  wifi_band_5ghz: string;
  wifi_mode_5ghz: string;
  wifi_power_5ghz: number;
  wifi_state_5ghz: number;
  wifi_hidden_5ghz: number;
  mesh_mode: number;
  mesh_master: string;
  mesh_slaves: string[];
  lan_subnet: string;
  lan_netmask: string;
  lan_dns_servers: string;
  bridgeEnabled: boolean;
  ipv6_enabled: number;
  pon_rxpower: string;
  pon_txpower: string;
  pon_signal_measure: string;
  latitude: number;
  longitude: number;
  online_devices: any[];
  lan_devices: any[];
  speedtest_results: any[];
  ping_result: any;
  pingtest_results: any[];
  traceroute_result: any;
  traceroute_results: any[];
  sitesurvey_result: any;
  current_diagnostic: any;
  resources_usage?: { cpu_usage: number; memory_usage: number };
  vendor?: string;
  vendor_tr069?: string;
  wans?: any[];
  wifi?: any[];
  vlan?: any[];
  external_reference?: { data: string; kind: string };
  vendor_repeaters?: any[];
  ntp_status?: string;
  bridge_mode_enabled?: boolean;
  bridge_mode_ip?: string;
  bridge_mode_gateway?: string;
  bridge_mode_dns?: string;
  custom_inform_interval?: number;
  is_license_active?: boolean;
  wps_is_active?: boolean;
  isSsidPrefixEnabled?: boolean;
  [key: string]: any;
}

export interface FlashmanConnectedDevice {
  mac: string;
  hostname: string;
  ip: string;
  conn_type: string;
  conn_speed: string;
  signal: number;
  rssi: number;
  snr: number;
  channel: string;
  band: string;
  mode: string;
}

function getAuthHeaders(config: FlashmanConfig): HeadersInit {
  const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return {
    "Authorization": `Basic ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function normalizeApiUrl(url: string): string {
  let normalized = url.trim();
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

async function flashmanFetch(config: FlashmanConfig, path: string, options: RequestInit = {}): Promise<any> {
  const baseUrl = normalizeApiUrl(config.apiUrl);
  const url = `${baseUrl}${path}`;
  const headers = { ...getAuthHeaders(config), ...(options.headers || {}) };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const method = options.method || "GET";
    if (method !== "GET") {
      console.log(`[Flashman/API] ${method} ${path}`);
    }
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[Flashman/API] ${method} ${path} -> ${response.status}: ${errorText.substring(0, 200)}`);
      throw new Error(`Flashman API error ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    }
    const textResult = await response.text();
    if (method !== "GET") {
      console.log(`[Flashman/API] ${method} ${path} -> text response: ${textResult.substring(0, 200)}`);
    }
    return textResult;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getFlashmanConfigForClient(_clientId: number): Promise<FlashmanConfig | null> {
  return getFlashmanGlobalConfig();
}

export async function getFlashmanGlobalConfig(): Promise<FlashmanConfig | null> {
  const config = await storage.getFlashmanGlobalConfig();
  if (!config) return null;
  return {
    apiUrl: config.apiUrl,
    username: config.username,
    password: config.password,
  };
}

export async function testFlashmanConnection(config: FlashmanConfig): Promise<{ success: boolean; message: string; deviceCount?: number }> {
  try {
    const result = await flashmanFetch(config, "/api/v3/device/search/?page=1&pageLimit=1&fields=_id");
    return {
      success: true,
      message: "Conexão estabelecida com sucesso",
      deviceCount: result.totalPages ? result.totalPages * (result.pageLimit || 1) : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Falha na conexão: ${error.message}`,
    };
  }
}

// ==================== DEVICE LOOKUP ====================

export async function getDeviceByMac(config: FlashmanConfig, mac: string): Promise<FlashmanDeviceInfo | null> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/?caseInsensitive=true`);
    if (result?.success && result.device) {
      return result.device as FlashmanDeviceInfo;
    }
    const v2Result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
    if (v2Result && !v2Result.error) {
      return v2Result as FlashmanDeviceInfo;
    }
    return null;
  } catch (error: any) {
    try {
      const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
      const v2Result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
      if (v2Result && !v2Result.error) {
        return v2Result as FlashmanDeviceInfo;
      }
    } catch (e) {}
    console.error(`[Flashman] Error getting device by MAC ${mac}:`, error.message);
    return null;
  }
}

export async function getDeviceByMacForPolling(config: FlashmanConfig, mac: string): Promise<FlashmanDeviceInfo | null> {
  const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
  let v3Device: any = null;
  try {
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/?caseInsensitive=true`);
    if (result?.success && result.device) {
      v3Device = result.device;
    }
  } catch (e) {}

  let v2Device: any = null;
  try {
    console.log(`[Flashman/Poll] Fetching V2: /api/v2/device/update/${normalizedMac}`);
    const v2Result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
    if (v2Result && !v2Result.error) {
      v2Device = v2Result;
      const hasPing = Array.isArray(v2Result.pingtest_results) && v2Result.pingtest_results.length > 0;
      const hasTrace = Array.isArray(v2Result.traceroute_results) && v2Result.traceroute_results.length > 0;
      const hasSpeed = Array.isArray(v2Result.speedtest_results) && v2Result.speedtest_results.length > 0;
      const diag = v2Result.current_diagnostic;
      console.log(`[Flashman/Poll] V2 data - ping: ${hasPing ? v2Result.pingtest_results.length + ' items' : 'empty'}, trace: ${hasTrace ? v2Result.traceroute_results.length + ' items' : 'empty'}, speed: ${hasSpeed ? v2Result.speedtest_results.length + ' items' : 'empty'}, diag: ${diag ? JSON.stringify(diag) : 'null'}`);
      if (hasPing) console.log(`[Flashman/Poll] Ping sample:`, JSON.stringify(v2Result.pingtest_results[0]));
      if (hasTrace) console.log(`[Flashman/Poll] Trace sample:`, JSON.stringify(v2Result.traceroute_results[0]));
    }
  } catch (e: any) {
    console.error(`[Flashman/Poll] V2 error:`, e.message);
  }

  if (v3Device && v2Device) {
    const merged = { ...v3Device };
    if (Array.isArray(v2Device.pingtest_results)) merged.pingtest_results = v2Device.pingtest_results;
    if (Array.isArray(v2Device.traceroute_results)) merged.traceroute_results = v2Device.traceroute_results;
    if (Array.isArray(v2Device.speedtest_results)) merged.speedtest_results = v2Device.speedtest_results;
    if (v2Device.current_diagnostic) merged.current_diagnostic = v2Device.current_diagnostic;
    if (Array.isArray(v2Device.lan_devices)) merged.lan_devices = v2Device.lan_devices;
    if (Array.isArray(v2Device.online_devices)) merged.online_devices = v2Device.online_devices;
    if (v2Device.sitesurvey_result) merged.sitesurvey_result = v2Device.sitesurvey_result;
    if (v2Device.ping_result) merged.ping_result = v2Device.ping_result;
    if (v2Device.traceroute_result) merged.traceroute_result = v2Device.traceroute_result;
    return merged as FlashmanDeviceInfo;
  }

  if (v2Device) return v2Device as FlashmanDeviceInfo;
  if (v3Device) return v3Device as FlashmanDeviceInfo;

  console.log(`[Flashman/Poll] No device data found for ${normalizedMac}`);
  return null;
}

export async function getDeviceByPppoeUser(config: FlashmanConfig, pppoeUser: string): Promise<{ mac: string; device?: FlashmanDeviceInfo } | null> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/pppoe-username/${encodeURIComponent(pppoeUser)}/`);
    if (result?.success !== false && result?.device?._id) {
      const deviceInfo = await getDeviceByMac(config, result.device._id);
      return { mac: result.device._id, device: deviceInfo || undefined };
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by PPPoE user ${pppoeUser}:`, error.message);
    return null;
  }
}

export async function getDeviceBySerial(config: FlashmanConfig, serial: string): Promise<string | null> {
  try {
    const normalizedSerial = serial.toUpperCase().trim();
    const result = await flashmanFetch(config, `/api/v3/device/serial-tr069/${encodeURIComponent(normalizedSerial)}/`);
    if (result?.success !== false && result?.device?._id) {
      return result.device._id;
    }
    return null;
  } catch (error: any) {
    try {
      const normalizedSerial = serial.toUpperCase().trim();
      const v2Result = await flashmanFetch(config, `/api/v2/device/update/${encodeURIComponent(normalizedSerial)}`);
      if (v2Result && !v2Result.error && v2Result._id) {
        return v2Result._id;
      }
    } catch (e) {}
    console.error(`[Flashman] Error getting device by serial ${serial}:`, error.message);
    return null;
  }
}

export async function getDeviceBySerialPon(config: FlashmanConfig, serialPon: string): Promise<any | null> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/serial-pon/${encodeURIComponent(serialPon)}/`);
    if (result?.success !== false && result?.device) {
      return result.device;
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by PON serial ${serialPon}:`, error.message);
    return null;
  }
}

export async function getDeviceByWanMac(config: FlashmanConfig, wanMac: string): Promise<any | null> {
  try {
    const normalizedMac = wanMac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/wan-mac/${encodeURIComponent(normalizedMac)}/`);
    if (result?.success !== false && result?.device) {
      return result.device;
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by WAN MAC ${wanMac}:`, error.message);
    return null;
  }
}

export async function getDeviceByExternalReference(config: FlashmanConfig, externalRef: string): Promise<any | null> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/external-reference-data/${encodeURIComponent(externalRef)}/`);
    if (result?.success !== false && result?.device) {
      return result.device;
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by external reference ${externalRef}:`, error.message);
    return null;
  }
}

export async function resolveDeviceMac(
  config: FlashmanConfig,
  pppoeUser?: string | null,
  macAddress?: string | null,
  serialNumber?: string | null,
): Promise<string | null> {
  if (serialNumber) {
    try {
      const mac = await getDeviceBySerial(config, serialNumber);
      if (mac) return mac;
    } catch (e) {}
  }
  if (pppoeUser) {
    try {
      const result = await flashmanFetch(config, `/api/v3/device/pppoe-username/${encodeURIComponent(pppoeUser)}/`);
      if (result?.device?._id) {
        return result.device._id;
      }
    } catch (e) {}
  }
  if (macAddress) {
    const normalizedMac = macAddress.toUpperCase().replace(/-/g, ":");
    try {
      const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/?caseInsensitive=true&fields=_id`);
      if (result?.success !== false && result?.device?._id) {
        return result.device._id;
      }
    } catch (e) {}
    try {
      const result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
      if (result && !result.error) {
        return normalizedMac;
      }
    } catch (e) {}
  }
  return null;
}

// ==================== DEVICE SEARCH ====================

export interface DeviceSearchFilters {
  online?: boolean;
  offline?: boolean;
  unstable?: boolean;
  alert?: boolean;
  noSignal?: boolean;
  tr069?: boolean;
  flashbox?: boolean;
  signal?: string;
  mesh?: string;
  mode?: string;
  ipv6?: string;
  onlineFor?: number;
  offlineFor?: string;
  query?: string;
  exclude?: string;
  fields?: string;
  page?: number;
  pageLimit?: number;
  sortType?: string;
  sortOn?: string;
  operation?: string;
}

export async function searchDevices(config: FlashmanConfig, filters: DeviceSearchFilters = {}): Promise<any> {
  try {
    const params = new URLSearchParams();
    if (filters.online) params.append("online", "true");
    if (filters.offline) params.append("offline", "true");
    if (filters.unstable) params.append("unstable", "true");
    if (filters.alert) params.append("alert", "true");
    if (filters.noSignal) params.append("noSignal", "true");
    if (filters.tr069) params.append("tr069", "true");
    if (filters.flashbox) params.append("flashbox", "true");
    if (filters.signal) params.append("signal", filters.signal);
    if (filters.mesh) params.append("mesh", filters.mesh);
    if (filters.mode) params.append("mode", filters.mode);
    if (filters.ipv6) params.append("ipv6", filters.ipv6);
    if (filters.onlineFor) params.append("onlineFor", String(filters.onlineFor));
    if (filters.offlineFor) params.append("offlineFor", filters.offlineFor);
    if (filters.query) params.append("query", filters.query);
    if (filters.exclude) params.append("exclude", filters.exclude);
    if (filters.fields) params.append("fields", filters.fields);
    if (filters.page) params.append("page", String(filters.page));
    if (filters.pageLimit) params.append("pageLimit", String(filters.pageLimit));
    if (filters.sortType) params.append("sortType", filters.sortType);
    if (filters.sortOn) params.append("sortOn", filters.sortOn);
    if (filters.operation) params.append("operation", filters.operation);

    const queryString = params.toString();
    const result = await flashmanFetch(config, `/api/v3/device/search/${queryString ? `?${queryString}` : ""}`);
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error searching devices:", error.message);
    return { success: false, message: error.message, devices: [] };
  }
}

export async function searchMeshVendorDevices(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/device/search/mesh-vendor");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error searching mesh vendor devices:", error.message);
    return { success: false, message: error.message };
  }
}

// ==================== COMMANDS ====================

function isDiagInProgressError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes("in progress") || lower.includes("em andamento") || lower.includes("already") || lower.includes("diagnostic") && lower.includes("running");
}

const DIAG_IN_PROGRESS_MSG = "Já existe um diagnóstico em andamento. Aguarde a conclusão antes de enviar outro comando.";

export async function sendCommand(config: FlashmanConfig, mac: string, command: string): Promise<{ success: boolean; message?: string }> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const url = `/api/v2/device/command/${normalizedMac}/${command}`;
    console.log(`[Flashman/Cmd] sendCommand URL: ${url}`);
    const result = await flashmanFetch(config, url, {
      method: "PUT",
    });
    console.log(`[Flashman/Cmd] sendCommand response:`, JSON.stringify(result));
    if (result?.success === false && isDiagInProgressError(result?.message || "")) {
      return { success: false, message: DIAG_IN_PROGRESS_MSG };
    }
    return { success: result?.success !== false, message: result?.message };
  } catch (error: any) {
    console.error(`[Flashman/Cmd] sendCommand error:`, error.message);
    if (isDiagInProgressError(error.message || "")) {
      return { success: false, message: DIAG_IN_PROGRESS_MSG };
    }
    return { success: false, message: error.message };
  }
}

export async function triggerSpeedtest(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "speedtest");
}

export async function triggerPing(config: FlashmanConfig, mac: string, hosts: string[] = ["8.8.8.8", "1.1.1.1"]): Promise<{ success: boolean; message?: string }> {
  const normalizedMac = mac.toUpperCase().replace(/-/g, ":");

  try {
    console.log(`[Flashman/Cmd] triggerPing via generic command: /api/v2/device/command/${normalizedMac}/ping`);
    const genericResult = await flashmanFetch(config, `/api/v2/device/command/${normalizedMac}/ping`, {
      method: "PUT",
    });
    console.log(`[Flashman/Cmd] triggerPing generic response:`, JSON.stringify(genericResult));
    if (genericResult?.success !== false) {
      return { success: true, message: genericResult?.message || "Teste de ping iniciado" };
    }
    if (isDiagInProgressError(genericResult?.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
  } catch (e: any) {
    console.log(`[Flashman/Cmd] triggerPing generic failed (${e.message}), trying dedicated endpoint...`);
    if (isDiagInProgressError(e.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
  }

  try {
    const url = `/api/v2/device/pingdiagnostic/${normalizedMac}`;
    const body = { content: { hosts } };
    console.log(`[Flashman/Cmd] triggerPing dedicated URL: ${url}, body:`, JSON.stringify(body));
    const result = await flashmanFetch(config, url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`[Flashman/Cmd] triggerPing dedicated response:`, JSON.stringify(result));
    if (result?.success === false && isDiagInProgressError(result?.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
    return { success: result?.success !== false, message: result?.message || "Teste de ping iniciado" };
  } catch (error: any) {
    console.error(`[Flashman/Cmd] triggerPing error:`, error.message);
    if (isDiagInProgressError(error.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
    return { success: false, message: error.message };
  }
}

export async function triggerTraceroute(config: FlashmanConfig, mac: string, host: string = "8.8.8.8"): Promise<{ success: boolean; message?: string }> {
  const normalizedMac = mac.toUpperCase().replace(/-/g, ":");

  try {
    console.log(`[Flashman/Cmd] triggerTraceroute via generic command: /api/v2/device/command/${normalizedMac}/traceroute`);
    const genericResult = await flashmanFetch(config, `/api/v2/device/command/${normalizedMac}/traceroute`, {
      method: "PUT",
    });
    console.log(`[Flashman/Cmd] triggerTraceroute generic response:`, JSON.stringify(genericResult));
    if (genericResult?.success !== false) {
      return { success: true, message: genericResult?.message || "Traceroute iniciado" };
    }
    if (isDiagInProgressError(genericResult?.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
  } catch (e: any) {
    console.log(`[Flashman/Cmd] triggerTraceroute generic failed (${e.message}), trying dedicated endpoint...`);
    if (isDiagInProgressError(e.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
  }

  try {
    const url = `/api/v2/device/tracediagnostic/${normalizedMac}`;
    const body = { content: { hosts: [host] } };
    console.log(`[Flashman/Cmd] triggerTraceroute dedicated URL: ${url}, body:`, JSON.stringify(body));
    const result = await flashmanFetch(config, url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`[Flashman/Cmd] triggerTraceroute dedicated response:`, JSON.stringify(result));
    if (result?.success === false && isDiagInProgressError(result?.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
    return { success: result?.success !== false, message: result?.message || "Traceroute iniciado" };
  } catch (error: any) {
    console.error(`[Flashman/Cmd] triggerTraceroute error:`, error.message);
    if (isDiagInProgressError(error.message || "")) return { success: false, message: DIAG_IN_PROGRESS_MSG };
    return { success: false, message: error.message };
  }
}

export async function triggerReboot(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "boot");
}

export async function triggerOnlineDevices(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "onlinedevs");
}

export async function triggerSiteSurvey(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "sitesurvey");
}

export async function triggerPonData(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "pondata");
}

export async function triggerBestChannel(config: FlashmanConfig, mac: string): Promise<{ success: boolean; message?: string }> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/commands/best-channel`, {
      method: "POST",
    });
    return { success: result?.success !== false, message: result?.message || "Comando enviado" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== TR-069 SYNC ====================

export async function syncDevice(config: FlashmanConfig, mac: string): Promise<{ success: boolean; message?: string }> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/sync`, {
      method: "PUT",
    });
    return { success: result?.success !== false, message: result?.message || "Sincronização TR-069 iniciada" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== FLASHBOARD METRICS ====================

export async function getFlashboardReport(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/flashboard/latest-report?ignoreFbStatusCode=true`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting Flashboard report for ${mac}:`, error.message);
    return null;
  }
}

// ==================== WI-FI MANAGEMENT ====================

export async function getDeviceWifi(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wifi`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting Wi-Fi config for ${mac}:`, error.message);
    return null;
  }
}

export async function getWifiRadio(config: FlashmanConfig, mac: string, radioId: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wifi-radio/id/${encodeURIComponent(radioId)}`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting Wi-Fi radio ${radioId} for ${mac}:`, error.message);
    return null;
  }
}

export async function updateWifiRadio(config: FlashmanConfig, mac: string, radioId: string, data: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wifi-radio/id/${encodeURIComponent(radioId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function getWifiInterface(config: FlashmanConfig, mac: string, wifiId: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wifi-interface/id/${encodeURIComponent(wifiId)}`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting Wi-Fi interface ${wifiId} for ${mac}:`, error.message);
    return null;
  }
}

export async function updateWifiInterface(config: FlashmanConfig, mac: string, wifiId: string, data: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wifi-interface/id/${encodeURIComponent(wifiId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== WAN MANAGEMENT ====================

export async function setDeviceWan(config: FlashmanConfig, mac: string, wanId: string, data: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wans/${encodeURIComponent(wanId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteDeviceWan(config: FlashmanConfig, mac: string, wanId: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wans/${encodeURIComponent(wanId)}`, {
      method: "DELETE",
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function setDeviceWans(config: FlashmanConfig, mac: string, data: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/wans`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== WEB CREDENTIALS ====================

export async function getWebCredentials(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/web-credentials`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting web credentials for ${mac}:`, error.message);
    return null;
  }
}

export async function setWebCredentials(config: FlashmanConfig, mac: string, data: { username?: string; password?: string }): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/web-credentials`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== LAN MANAGEMENT ====================

export async function setDeviceLanSubnet(config: FlashmanConfig, mac: string, data: { lan_subnet?: string; lan_netmask?: string }): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/lan`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== LAN DNS SERVERS ====================

export async function getLanDnsServers(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/lan-dns-servers`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting LAN DNS servers for ${mac}:`, error.message);
    return null;
  }
}

export async function setLanDnsServers(config: FlashmanConfig, mac: string, dnsServers: string[]): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/lan-dns-servers`, {
      method: "PUT",
      body: JSON.stringify({ dns_servers: dnsServers }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== COMMENTS/OBSERVATIONS ====================

export async function getDeviceComments(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/comments/`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting comments for ${mac}:`, error.message);
    return null;
  }
}

export async function setDeviceComments(config: FlashmanConfig, mac: string, comments: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/comments/`, {
      method: "PUT",
      body: JSON.stringify({ comments }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== CUSTOM INFO ====================

export async function getDeviceCustomInfo(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/custom-info/`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting custom info for ${mac}:`, error.message);
    return null;
  }
}

export async function setDeviceCustomInfo(config: FlashmanConfig, mac: string, customInfo: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/custom-info/`, {
      method: "PUT",
      body: JSON.stringify(customInfo),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== APP ACCESS ====================

export async function getAppAccess(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/app-access`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting app access for ${mac}:`, error.message);
    return null;
  }
}

export async function setAppAccessPassword(config: FlashmanConfig, mac: string, password: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/app-access/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== VoIP ====================

export async function getDeviceVoip(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/voip/`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting VoIP config for ${mac}:`, error.message);
    return null;
  }
}

export async function setDeviceVoip(config: FlashmanConfig, mac: string, voipConfig: any): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/voip`, {
      method: "PUT",
      body: JSON.stringify(voipConfig),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== CONFIG FILES ====================

export async function getConfigFiles(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/config-files/");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting config files:", error.message);
    return null;
  }
}

export async function sendConfigFileToDevice(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/mac/${encodeURIComponent(normalizedMac)}/config-file/`, {
      method: "POST",
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== FIRMWARE ====================

export async function listFirmwares(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/firmware");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error listing firmwares:", error.message);
    return null;
  }
}

export async function listFirmwaresByModel(config: FlashmanConfig, vendor: string, model: string): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/firmware/vendor/${encodeURIComponent(vendor)}/model/${encodeURIComponent(model)}`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error listing firmwares for ${vendor}/${model}:`, error.message);
    return null;
  }
}

// ==================== WEBHOOKS ====================

export async function getWebhooks(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/webhook");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting webhooks:", error.message);
    return null;
  }
}

export async function getWebhookById(config: FlashmanConfig, id: string): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/webhook/id/${encodeURIComponent(id)}`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting webhook ${id}:`, error.message);
    return null;
  }
}

export async function createWebhook(config: FlashmanConfig, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/webhook", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateWebhook(config: FlashmanConfig, id: string, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/webhook/id/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteWebhook(config: FlashmanConfig, id: string): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/webhook/id/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== PERIODIC REBOOT ====================

export async function getPeriodicReboot(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/periodic-reboot/");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting periodic reboot config:", error.message);
    return null;
  }
}

export async function setPeriodicRebootByModel(config: FlashmanConfig, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/periodic-reboot/by-model/", {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== PRE-REGISTER ====================

export async function getPreRegisters(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/device/pre-register/");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting pre-registers:", error.message);
    return null;
  }
}

export async function getPreRegisterById(config: FlashmanConfig, id: string): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/pre-register/id/${encodeURIComponent(id)}`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting pre-register ${id}:`, error.message);
    return null;
  }
}

export async function setPreRegister(config: FlashmanConfig, id: string, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/pre-register/id/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deletePreRegisters(config: FlashmanConfig, ids: string[]): Promise<any> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/pre-register/${ids.join(",")}`, {
      method: "DELETE",
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== SNMP CREDENTIALS ====================

export async function getSnmpCredentials(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/snmp");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting SNMP credentials:", error.message);
    return null;
  }
}

export async function createSnmpCredential(config: FlashmanConfig, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/snmp", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteSnmpCredentials(config: FlashmanConfig, ids: string[]): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/snmp", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== SSH CREDENTIALS ====================

export async function getSshCredentials(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/ssh");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting SSH credentials:", error.message);
    return null;
  }
}

export async function createSshCredential(config: FlashmanConfig, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/ssh", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteSshCredentials(config: FlashmanConfig, ids: string[]): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/ssh", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== TELNET CREDENTIALS ====================

export async function getTelnetCredentials(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/telnet");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting Telnet credentials:", error.message);
    return null;
  }
}

export async function createTelnetCredential(config: FlashmanConfig, data: any): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/telnet", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteTelnetCredentials(config: FlashmanConfig, ids: string[]): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/ne-credentials/telnet", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    return result;
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ==================== HOMOLOGATION ====================

export async function getDeviceHomologation(config: FlashmanConfig, mac: string): Promise<any> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v3/device/${encodeURIComponent(normalizedMac)}/homologation`);
    return result;
  } catch (error: any) {
    console.error(`[Flashman] Error getting homologation for ${mac}:`, error.message);
    return null;
  }
}

// ==================== FLASHMAN CONFIG ====================

export async function getFlashmanSystemConfig(config: FlashmanConfig): Promise<any> {
  try {
    const result = await flashmanFetch(config, "/api/v3/config");
    return result;
  } catch (error: any) {
    console.error("[Flashman] Error getting system config:", error.message);
    return null;
  }
}

// ==================== POLL / REFRESH ====================

export async function pollDeviceUpdate(config: FlashmanConfig, mac: string): Promise<FlashmanDeviceInfo | null> {
  return getDeviceByMac(config, mac);
}

// ==================== SAFE STRING / FORMAT ====================

function safeString(value: any, fallback: string = "N/A"): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      const lastKey = keys.sort().pop()!;
      const lastValue = value[lastKey];
      if (typeof lastValue === "string") return lastValue || fallback;
      if (typeof lastValue === "number") return String(lastValue);
    }
    return fallback;
  }
  return String(value) || fallback;
}

export function formatFlashmanDeviceInfo(device: FlashmanDeviceInfo) {
  const wifiData = Array.isArray(device.wifi) ? device.wifi : null;
  const wifi2g = wifiData?.find((w: any) => w.type === 2 || w.type === 1) || null;
  const wifi5g = wifiData?.find((w: any) => w.type === 5 || w.type === 3) || null;

  const wansData = Array.isArray(device.wans) ? device.wans : [];

  return {
    mac: safeString(device._id, ""),
    model: safeString(device.model, "Desconhecido"),
    vendor: safeString(device.vendor || device.vendor_tr069, "N/A"),
    firmwareVersion: safeString(device.version || device.installed_release, "N/A"),
    hardwareVersion: safeString(device.hw_version, "N/A"),
    serialNumber: safeString(device.serial_tr069 || device.alt_uid_tr069, "N/A"),
    connectionType: safeString(device.connection_type, "N/A"),
    pppoeUser: safeString(device.pppoe_user, "N/A"),
    wanIp: safeString(device.wan_ip || device.ip, "N/A"),
    wanSpeed: safeString(device.wan_negociated_speed, null as any),
    wanDuplex: safeString(device.wan_negociated_duplex, null as any),
    lastContact: device.last_contact ? (typeof device.last_contact === "string" ? device.last_contact : null) : null,
    uptime: safeString(device.sys_up_time || device.uptime, "N/A"),
    createdAt: device.created_at ? (typeof device.created_at === "string" ? device.created_at : null) : null,
    latitude: typeof device.latitude === "number" ? device.latitude : null,
    longitude: typeof device.longitude === "number" ? device.longitude : null,
    resourcesUsage: device.resources_usage ? {
      cpuUsage: typeof device.resources_usage.cpu_usage === "number" ? device.resources_usage.cpu_usage : null,
      memoryUsage: typeof device.resources_usage.memory_usage === "number" ? device.resources_usage.memory_usage : null,
    } : null,
    isLicenseActive: device.is_license_active ?? null,
    customInformInterval: device.custom_inform_interval ?? null,
    ntpStatus: safeString(device.ntp_status, null as any),
    wpsActive: device.wps_is_active ?? false,
    externalReference: device.external_reference ? {
      data: safeString(device.external_reference.data, ""),
      kind: safeString(device.external_reference.kind, ""),
    } : null,
    wifi: {
      ssid_2g: wifi2g ? safeString(wifi2g.ssid, null as any) : safeString(device.wifi_ssid, null as any),
      password_2g: wifi2g ? safeString(wifi2g.password, null as any) : safeString(device.wifi_password, null as any),
      channel_2g: wifi2g ? safeString(wifi2g.channel || wifi2g.last_channel, "auto") : safeString(device.wifi_channel, "auto"),
      band_2g: wifi2g ? safeString(wifi2g.bandwidth || wifi2g.last_bandwidth, null as any) : safeString(device.wifi_band, null as any),
      mode_2g: wifi2g ? safeString(wifi2g.mode, null as any) : safeString(device.wifi_mode, null as any),
      power_2g: wifi2g ? (typeof wifi2g.power === "number" ? wifi2g.power : null) : (typeof device.wifi_power === "number" ? device.wifi_power : null),
      state_2g: wifi2g ? (typeof wifi2g.state === "number" ? wifi2g.state : null) : (typeof device.wifi_state === "number" ? device.wifi_state : null),
      hidden_2g: wifi2g ? (typeof wifi2g.hidden === "number" ? wifi2g.hidden : null) : (typeof device.wifi_hidden === "number" ? device.wifi_hidden : null),
      bssid_2g: wifi2g ? safeString(wifi2g.bssid, null as any) : null,
      status_2g: wifi2g ? safeString(wifi2g.status, null as any) : null,
      supportedBandwidths_2g: wifi2g?.supported_bandwidths || null,
      supportedModes_2g: wifi2g?.supported_modes || null,
      ssid_5g: wifi5g ? safeString(wifi5g.ssid, null as any) : safeString(device.wifi_ssid_5ghz, null as any),
      password_5g: wifi5g ? safeString(wifi5g.password, null as any) : safeString(device.wifi_password_5ghz, null as any),
      channel_5g: wifi5g ? safeString(wifi5g.channel || wifi5g.last_channel, "auto") : safeString(device.wifi_channel_5ghz, "auto"),
      band_5g: wifi5g ? safeString(wifi5g.bandwidth || wifi5g.last_bandwidth, null as any) : safeString(device.wifi_band_5ghz, null as any),
      mode_5g: wifi5g ? safeString(wifi5g.mode, null as any) : safeString(device.wifi_mode_5ghz, null as any),
      power_5g: wifi5g ? (typeof wifi5g.power === "number" ? wifi5g.power : null) : (typeof device.wifi_power_5ghz === "number" ? device.wifi_power_5ghz : null),
      state_5g: wifi5g ? (typeof wifi5g.state === "number" ? wifi5g.state : null) : (typeof device.wifi_state_5ghz === "number" ? device.wifi_state_5ghz : null),
      hidden_5g: wifi5g ? (typeof wifi5g.hidden === "number" ? wifi5g.hidden : null) : (typeof device.wifi_hidden_5ghz === "number" ? device.wifi_hidden_5ghz : null),
      bssid_5g: wifi5g ? safeString(wifi5g.bssid, null as any) : null,
      status_5g: wifi5g ? safeString(wifi5g.status, null as any) : null,
      supportedBandwidths_5g: wifi5g?.supported_bandwidths || null,
      supportedModes_5g: wifi5g?.supported_modes || null,
    },
    mesh: {
      mode: typeof device.mesh_mode === "number" ? device.mesh_mode : 0,
      master: safeString(device.mesh_master, null as any),
      slaves: Array.isArray(device.mesh_slaves) ? device.mesh_slaves : [],
      vendorRepeaters: Array.isArray(device.vendor_repeaters) ? device.vendor_repeaters.map((r: any) => ({
        mac: safeString(r._id, ""),
        serialTr069: safeString(r.serial_tr069, ""),
        externalReference: r.external_reference ? safeString(r.external_reference.data, "") : "",
      })) : [],
    },
    pon: {
      rxPower: safeString(device.pon_rxpower, null as any),
      txPower: safeString(device.pon_txpower, null as any),
      signalMeasure: safeString(device.pon_signal_measure, null as any),
    },
    wans: wansData.map((wan: any) => ({
      id: safeString(wan._id, ""),
      alias: safeString(wan.alias, ""),
      connectionType: safeString(wan.connection_type, ""),
      interfaceType: safeString(wan.interface_type, ""),
      enable: wan.enable ?? true,
      status: safeString(wan.status, ""),
      mac: safeString(wan.mac, ""),
      ipv4: wan.ipv4 ? {
        ip: safeString(wan.ipv4.ip, ""),
        natIp: safeString(wan.ipv4.nat_ip, ""),
        gateway: safeString(wan.ipv4.gateway, ""),
        mask: wan.ipv4.mask ?? null,
        dns: Array.isArray(wan.ipv4.dns) ? wan.ipv4.dns : [],
      } : null,
      ipv6: wan.ipv6 ? {
        enabled: wan.ipv6.enabled ?? false,
        dns: Array.isArray(wan.ipv6.dns) ? wan.ipv6.dns : [],
      } : null,
      uptime: typeof wan.uptime === "number" ? wan.uptime : null,
      pppoe: wan.pppoe ? {
        username: safeString(wan.pppoe.username, ""),
        serverMac: safeString(wan.pppoe.server_mac, ""),
        serverIp: safeString(wan.pppoe.server_ip, ""),
      } : null,
      vlanId: wan.vlan_id ?? null,
      mtu: wan.mtu ?? null,
      serviceTypes: wan.service_types || null,
    })),
    lan: {
      subnet: safeString(device.lan_subnet, null as any),
      netmask: safeString(device.lan_netmask, null as any),
      dns: safeString(device.lan_dns_servers, null as any),
    },
    vlans: Array.isArray(device.vlan) ? device.vlan.map((v: any) => ({
      id: safeString(v._id, ""),
      port: v.port ?? null,
      vlanId: v.vlan_id ?? null,
    })) : [],
    bridge: {
      enabled: device.bridge_mode_enabled ?? device.bridgeEnabled ?? false,
      ip: safeString(device.bridge_mode_ip, null as any),
      gateway: safeString(device.bridge_mode_gateway, null as any),
      dns: safeString(device.bridge_mode_dns, null as any),
    },
    ipv6Enabled: typeof device.ipv6_enabled === "number" ? device.ipv6_enabled : 0,
    connectedDevices: Array.isArray(device.lan_devices) ? device.lan_devices : (Array.isArray(device.online_devices) ? device.online_devices : []),
    speedtestResults: Array.isArray(device.speedtest_results) ? device.speedtest_results : [],
    pingResults: Array.isArray(device.pingtest_results) ? device.pingtest_results : (Array.isArray(device.ping_result) ? device.ping_result : []),
    tracerouteResults: Array.isArray(device.traceroute_results) ? device.traceroute_results : (device.traceroute_result ? [device.traceroute_result] : []),
    siteSurveyResult: Array.isArray(device.sitesurvey_result) ? device.sitesurvey_result : null,
    currentDiagnostic: device.current_diagnostic ? {
      type: safeString(device.current_diagnostic.type, ""),
      stage: safeString(device.current_diagnostic.stage, ""),
      inProgress: device.current_diagnostic.in_progress ?? false,
      startedAt: device.current_diagnostic.started_at || null,
      lastModifiedAt: device.current_diagnostic.last_modified_at || null,
    } : null,
  };
}
