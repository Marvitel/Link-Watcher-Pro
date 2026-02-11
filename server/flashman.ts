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
  speedtest_results: any[];
  ping_result: any;
  traceroute_result: any;
  sitesurvey_result: any;
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
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Flashman API error ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
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
    const result = await flashmanFetch(config, "/api/v2/device/search?page=1&limit=1", {
      method: "PUT",
      body: JSON.stringify({ filter_list: "" }),
    });
    return {
      success: true,
      message: "Conexão estabelecida com sucesso",
      deviceCount: result.pages_num ? result.pages_num * (result.devices_per_page || 1) : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Falha na conexão: ${error.message}`,
    };
  }
}

export async function getDeviceByMac(config: FlashmanConfig, mac: string): Promise<FlashmanDeviceInfo | null> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
    if (result && !result.error) {
      return result as FlashmanDeviceInfo;
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by MAC ${mac}:`, error.message);
    return null;
  }
}

export async function getDeviceByPppoeUser(config: FlashmanConfig, pppoeUser: string): Promise<{ mac: string; device?: FlashmanDeviceInfo } | null> {
  try {
    const result = await flashmanFetch(config, `/api/v3/device/pppoe-username/${encodeURIComponent(pppoeUser)}`);
    if (result?.device?._id) {
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
    const result = await flashmanFetch(config, `/api/v2/device/update/${encodeURIComponent(normalizedSerial)}`);
    if (result && !result.error && result._id) {
      return result._id;
    }
    return null;
  } catch (error: any) {
    console.error(`[Flashman] Error getting device by serial ${serial}:`, error.message);
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
      const result = await flashmanFetch(config, `/api/v3/device/pppoe-username/${encodeURIComponent(pppoeUser)}`);
      if (result?.device?._id) {
        return result.device._id;
      }
    } catch (e) {}
  }
  if (macAddress) {
    const normalizedMac = macAddress.toUpperCase().replace(/-/g, ":");
    try {
      const result = await flashmanFetch(config, `/api/v2/device/update/${normalizedMac}`);
      if (result && !result.error) {
        return normalizedMac;
      }
    } catch (e) {}
  }
  return null;
}

export async function sendCommand(config: FlashmanConfig, mac: string, command: string): Promise<{ success: boolean; message?: string }> {
  try {
    const normalizedMac = mac.toUpperCase().replace(/-/g, ":");
    const result = await flashmanFetch(config, `/api/v2/device/command/${normalizedMac}/${command}`, {
      method: "PUT",
    });
    return { success: result?.success !== false, message: result?.message };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function triggerSpeedtest(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "speedtest");
}

export async function triggerPing(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "ping");
}

export async function triggerTraceroute(config: FlashmanConfig, mac: string) {
  return sendCommand(config, mac, "traceroute");
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

export async function pollDeviceUpdate(config: FlashmanConfig, mac: string): Promise<FlashmanDeviceInfo | null> {
  return getDeviceByMac(config, mac);
}

export function formatFlashmanDeviceInfo(device: FlashmanDeviceInfo) {
  return {
    mac: device._id,
    model: device.model || "Desconhecido",
    firmwareVersion: device.version || device.installed_release || "N/A",
    hardwareVersion: device.hw_version || "N/A",
    serialNumber: device.serial_tr069 || device.alt_uid_tr069 || "N/A",
    connectionType: device.connection_type || "N/A",
    pppoeUser: device.pppoe_user || "N/A",
    wanIp: device.wan_ip || device.ip || "N/A",
    lastContact: device.last_contact || null,
    uptime: device.sys_up_time || device.uptime || "N/A",
    createdAt: device.created_at || null,
    latitude: device.latitude,
    longitude: device.longitude,
    wifi: {
      ssid_2g: device.wifi_ssid || null,
      channel_2g: device.wifi_channel || "auto",
      band_2g: device.wifi_band || null,
      mode_2g: device.wifi_mode || null,
      power_2g: device.wifi_power ?? null,
      state_2g: device.wifi_state ?? null,
      hidden_2g: device.wifi_hidden ?? null,
      ssid_5g: device.wifi_ssid_5ghz || null,
      channel_5g: device.wifi_channel_5ghz || "auto",
      band_5g: device.wifi_band_5ghz || null,
      mode_5g: device.wifi_mode_5ghz || null,
      power_5g: device.wifi_power_5ghz ?? null,
      state_5g: device.wifi_state_5ghz ?? null,
      hidden_5g: device.wifi_hidden_5ghz ?? null,
    },
    mesh: {
      mode: device.mesh_mode ?? 0,
      master: device.mesh_master || null,
      slaves: device.mesh_slaves || [],
    },
    pon: {
      rxPower: device.pon_rxpower || null,
      txPower: device.pon_txpower || null,
      signalMeasure: device.pon_signal_measure || null,
    },
    lan: {
      subnet: device.lan_subnet || null,
      netmask: device.lan_netmask || null,
      dns: device.lan_dns_servers || null,
    },
    bridge: {
      enabled: device.bridgeEnabled ?? false,
    },
    ipv6Enabled: device.ipv6_enabled ?? 0,
    connectedDevices: device.online_devices || [],
    speedtestResults: device.speedtest_results || [],
    pingResult: device.ping_result || null,
    tracerouteResult: device.traceroute_result || null,
    siteSurveyResult: device.sitesurvey_result || null,
  };
}
