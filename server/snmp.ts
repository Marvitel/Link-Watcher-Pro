import snmp from "net-snmp";

export interface SnmpInterface {
  ifIndex: number;
  ifName: string;
  ifDescr: string;
  ifAlias: string;
  ifSpeed: number;
  ifOperStatus: string;
  ifAdminStatus: string;
}

export interface SnmpProfile {
  id: number;
  version: string;
  port: number;
  community?: string | null;
  securityLevel?: string | null;
  authProtocol?: string | null;
  authPassword?: string | null;
  privProtocol?: string | null;
  privPassword?: string | null;
  username?: string | null;
  timeout: number;
  retries: number;
}

// Standard MIB-II OIDs
const IF_NUMBER_OID = "1.3.6.1.2.1.2.1.0"; // ifNumber - total interfaces count

// Entity MIB OIDs (para Cisco Nexus e switches com Entity MIB)
const ENTITY_MIB_OIDS = {
  // entPhysicalDescr - Descrição do componente físico
  entPhysicalDescr: "1.3.6.1.2.1.47.1.1.1.1.2",
  // entPhysicalName - Nome do componente físico (mais útil para encontrar sensores)
  entPhysicalName: "1.3.6.1.2.1.47.1.1.1.1.7",
  // entPhysicalContainedIn - Componente pai (para mapear sensores a portas)
  entPhysicalContainedIn: "1.3.6.1.2.1.47.1.1.1.1.4",
  // entPhysicalClass - Tipo do componente (sensor=8, port=10, etc)
  entPhysicalClass: "1.3.6.1.2.1.47.1.1.1.1.5",
};

// Cisco Entity Sensor MIB - OID para valores de sensores ópticos
const CISCO_ENTITY_SENSOR_OID = "1.3.6.1.4.1.9.9.91.1.1.1.1.4"; // entSensorValue

const IF_TABLE_OIDS = {
  ifIndex: "1.3.6.1.2.1.2.2.1.1",
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",
  ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
};

const IF_X_TABLE_OIDS = {
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ifHighSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",
};

const OPER_STATUS_MAP: Record<number, string> = {
  1: "up",
  2: "down",
  3: "testing",
  4: "unknown",
  5: "dormant",
  6: "notPresent",
  7: "lowerLayerDown",
};

const ADMIN_STATUS_MAP: Record<number, string> = {
  1: "up",
  2: "down",
  3: "testing",
};

// Maximum interfaces to discover (safety limit)
const MAX_INTERFACES = 1000;

function createSession(
  targetIp: string,
  profile: SnmpProfile
): snmp.Session {
  // Normalize version - accepts "1", "v1", "2c", "v2c", "3", "v3"
  const version = profile.version.replace("v", "").toLowerCase();
  
  // Determine SNMP version - net-snmp uses numeric constants
  // Version1 = 0, Version2c = 1
  const snmpVersion = version === "1" ? 0 : 1;
  
  const options: any = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
    version: snmpVersion,
  };

  if (version === "3") {
    let securityLevel = snmp.SecurityLevel.noAuthNoPriv;
    if (profile.securityLevel === "authNoPriv") {
      securityLevel = snmp.SecurityLevel.authNoPriv;
    } else if (profile.securityLevel === "authPriv") {
      securityLevel = snmp.SecurityLevel.authPriv;
    }

    let authProtocol = snmp.AuthProtocols.none;
    if (profile.authProtocol === "MD5") {
      authProtocol = snmp.AuthProtocols.md5;
    } else if (profile.authProtocol === "SHA") {
      authProtocol = snmp.AuthProtocols.sha;
    }

    let privProtocol = snmp.PrivProtocols.none;
    if (profile.privProtocol === "DES") {
      privProtocol = snmp.PrivProtocols.des;
    } else if (profile.privProtocol === "AES") {
      privProtocol = snmp.PrivProtocols.aes;
    }

    const user: snmp.User = {
      name: profile.username || "",
      level: securityLevel,
      authProtocol,
      authKey: profile.authPassword || "",
      privProtocol,
      privKey: profile.privPassword || "",
    };

    return snmp.createV3Session(targetIp, user, options);
  } else {
    return snmp.createSession(
      targetIp,
      profile.community || "public",
      options
    );
  }
}

// Creates a dedicated session and performs subtree walk, then closes the session
async function subtreeWalkWithSession(
  targetIp: string,
  profile: SnmpProfile,
  oid: string
): Promise<Map<number, string | number>> {
  const session = createSession(targetIp, profile);
  
  return new Promise((resolve, reject) => {
    const results = new Map<number, string | number>();
    let completed = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      // Only close if not already closed
      try {
        session.close();
      } catch {
        // Session already closed, ignore
      }
    };

    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error(`Timeout walking OID ${oid}`));
      }
    }, profile.timeout + 5000); // Add buffer to profile timeout

    session.subtree(
      oid,
      (varbinds) => {
        for (const vb of varbinds) {
          const oidParts = vb.oid.split(".");
          const ifIndex = parseInt(oidParts[oidParts.length - 1], 10);

          let value: string | number;
          if (Buffer.isBuffer(vb.value)) {
            value = vb.value.toString("utf8");
          } else if (typeof vb.value === "number") {
            value = vb.value;
          } else {
            value = String(vb.value);
          }

          results.set(ifIndex, value);
        }
      },
      (error) => {
        if (!completed) {
          completed = true;
          cleanup();
          if (error) {
            reject(error);
          } else {
            resolve(results);
          }
        }
      }
    );
  });
}

// Get ifNumber (total interface count) using SNMP GET
async function getIfNumber(
  targetIp: string,
  profile: SnmpProfile
): Promise<number> {
  const session = createSession(targetIp, profile) as any;
  
  return new Promise((resolve, reject) => {
    let completed = false;
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { session.close(); } catch {}
        reject(new Error("Timeout getting ifNumber"));
      }
    }, profile.timeout + 2000);

    session.get([IF_NUMBER_OID], (error: any, varbinds: any[]) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeoutId);
        try { session.close(); } catch {}
        
        if (error) {
          reject(error);
        } else if (varbinds && varbinds.length > 0 && varbinds[0].value !== undefined) {
          resolve(Number(varbinds[0].value) || MAX_INTERFACES);
        } else {
          resolve(MAX_INTERFACES); // Fallback to max
        }
      }
    });
  });
}

// Uses subtree walk with early termination based on interface count
async function getBulkColumn(
  targetIp: string,
  profile: SnmpProfile,
  baseOid: string,
  maxRepetitions: number
): Promise<Map<number, string | number>> {
  const session = createSession(targetIp, profile);
  
  return new Promise((resolve) => {
    const results = new Map<number, string | number>();
    let completed = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      try { session.close(); } catch {}
    };

    // Long timeout to allow full subtree walk
    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        console.log(`[SNMP] Timeout for OID ${baseOid}, returning ${results.size} partial results`);
        cleanup();
        resolve(results);
      }
    }, 30000); // 30 second timeout

    let count = 0;

    session.subtree(
      baseOid,
      (varbinds: any[]) => {
        if (!varbinds) return;
        
        for (const vb of varbinds) {
          // Stop collecting if we have enough
          if (count >= maxRepetitions) {
            return;
          }
          
          const oidParts = vb.oid.split(".");
          const ifIndex = parseInt(oidParts[oidParts.length - 1], 10);

          let value: string | number;
          if (Buffer.isBuffer(vb.value)) {
            value = vb.value.toString("utf8");
          } else if (typeof vb.value === "number") {
            value = vb.value;
          } else {
            value = String(vb.value);
          }

          results.set(ifIndex, value);
          count++;
        }
      },
      (error: any) => {
        if (!completed) {
          completed = true;
          cleanup();
          if (error) {
            console.log(`[SNMP] Error for OID ${baseOid}: ${error.message}, returning ${results.size} results`);
          }
          resolve(results);
        }
      }
    );
  });
}

// Single-session sequential discovery to avoid overwhelming devices
export async function discoverInterfaces(
  targetIp: string,
  profile: SnmpProfile
): Promise<SnmpInterface[]> {
  const discoveryProfile = {
    ...profile,
    timeout: Math.max(profile.timeout, 15000), // 15 seconds per OID walk
    retries: 2,
  };

  console.log(`[SNMP Discovery] Starting discovery for ${targetIp} (community: ${profile.community}, port: ${profile.port})`);
  const startTime = Date.now();

  try {
    // Use sequential discovery to avoid overwhelming the device
    console.log(`[SNMP Discovery] Fetching ifIndex...`);
    const ifIndexMap = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifIndex, MAX_INTERFACES);
    console.log(`[SNMP Discovery] Found ${ifIndexMap.size} interface indexes`);
    
    if (ifIndexMap.size === 0) {
      console.log(`[SNMP Discovery] No interfaces found, trying ifDescr...`);
      // Try ifDescr as fallback
      const ifDescrFallback = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifDescr, MAX_INTERFACES);
      if (ifDescrFallback.size > 0) {
        for (const [idx] of Array.from(ifDescrFallback.entries())) {
          ifIndexMap.set(idx, idx);
        }
        console.log(`[SNMP Discovery] Found ${ifIndexMap.size} interfaces via ifDescr fallback`);
      }
    }

    if (ifIndexMap.size === 0) {
      console.log(`[SNMP Discovery] No interfaces discovered for ${targetIp}`);
      return [];
    }

    // Fetch remaining columns sequentially
    console.log(`[SNMP Discovery] Fetching interface details...`);
    const ifDescrMap = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifDescr, MAX_INTERFACES);
    const ifSpeedMap = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifSpeed, MAX_INTERFACES);
    const ifAdminStatusMap = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifAdminStatus, MAX_INTERFACES);
    const ifOperStatusMap = await getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifOperStatus, MAX_INTERFACES);
    
    // Optional extended tables (IF-MIB extensions)
    let ifNameMap = new Map<number, string | number>();
    let ifHighSpeedMap = new Map<number, string | number>();
    let ifAliasMap = new Map<number, string | number>();
    try {
      ifNameMap = await getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifName, MAX_INTERFACES);
      ifHighSpeedMap = await getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifHighSpeed, MAX_INTERFACES);
      ifAliasMap = await getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifAlias, MAX_INTERFACES);
      console.log(`[SNMP Discovery] Fetched ifAlias for ${ifAliasMap.size} interfaces`);
    } catch {
      console.log(`[SNMP Discovery] IF-MIB extended tables not available`);
    }

    console.log(`[SNMP Discovery] Completed for ${targetIp} in ${Date.now() - startTime}ms, found ${ifIndexMap.size} interfaces`);

    const interfaces: SnmpInterface[] = [];

    for (const [ifIndex] of Array.from(ifIndexMap.entries())) {
      const ifDescr = String(ifDescrMap.get(ifIndex) || "");
      const ifName = String(ifNameMap.get(ifIndex) || ifDescr);
      const ifAlias = String(ifAliasMap.get(ifIndex) || "");
      
      let ifSpeed = Number(ifSpeedMap.get(ifIndex) || 0);
      const ifHighSpeed = Number(ifHighSpeedMap.get(ifIndex) || 0);
      if (ifHighSpeed > 0) {
        ifSpeed = ifHighSpeed * 1000000;
      }

      const operStatusNum = Number(ifOperStatusMap.get(ifIndex) || 4);
      const adminStatusNum = Number(ifAdminStatusMap.get(ifIndex) || 3);

      interfaces.push({
        ifIndex,
        ifName,
        ifDescr,
        ifAlias,
        ifSpeed,
        ifOperStatus: OPER_STATUS_MAP[operStatusNum] || "unknown",
        ifAdminStatus: ADMIN_STATUS_MAP[adminStatusNum] || "testing",
      });
    }

    interfaces.sort((a, b) => a.ifIndex - b.ifIndex);

    return interfaces;
  } catch (error) {
    console.log(`[SNMP Discovery] Failed for ${targetIp} after ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

export function formatSpeed(speedBps: number): string {
  if (speedBps >= 1000000000) {
    return `${(speedBps / 1000000000).toFixed(0)} Gbps`;
  } else if (speedBps >= 1000000) {
    return `${(speedBps / 1000000).toFixed(0)} Mbps`;
  } else if (speedBps >= 1000) {
    return `${(speedBps / 1000).toFixed(0)} Kbps`;
  }
  return `${speedBps} bps`;
}

// Coletar status operacional de uma interface via SNMP
// Retorna: 'up', 'down', 'testing', 'unknown', 'dormant', 'notPresent', 'lowerLayerDown' ou null se erro
export async function getInterfaceOperStatus(
  targetIp: string,
  profile: SnmpProfile,
  ifIndex: number
): Promise<{ operStatus: string; adminStatus: string } | null> {
  let session: any = null;
  try {
    session = createSession(targetIp, profile);
    
    const operStatusOid = `${IF_TABLE_OIDS.ifOperStatus}.${ifIndex}`;
    const adminStatusOid = `${IF_TABLE_OIDS.ifAdminStatus}.${ifIndex}`;
    
    const results = await new Promise<Array<{ oid: string; value: any }>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SNMP timeout"));
      }, profile.timeout * 1000);
      
      session.get([operStatusOid, adminStatusOid], (error: Error | null, varbinds: any[]) => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve(varbinds.map((vb) => ({ oid: vb.oid, value: vb.value })));
        }
      });
    });
    
    let operStatusNum = 4; // unknown
    let adminStatusNum = 3; // testing
    
    for (const result of results) {
      if (result.oid === operStatusOid) {
        operStatusNum = Number(result.value) || 4;
      } else if (result.oid === adminStatusOid) {
        adminStatusNum = Number(result.value) || 3;
      }
    }
    
    return {
      operStatus: OPER_STATUS_MAP[operStatusNum] || "unknown",
      adminStatus: ADMIN_STATUS_MAP[adminStatusNum] || "testing",
    };
  } catch (error) {
    console.log(`[SNMP] Failed to get interface status for ${targetIp} ifIndex ${ifIndex}:`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (session) {
      try {
        session.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

export interface InterfaceSearchResult {
  found: boolean;
  ifIndex: number | null;
  ifName: string | null;
  ifDescr: string | null;
  ifAlias: string | null;
  matchType: "exact_name" | "exact_descr" | "exact_alias" | "partial_name" | "partial_descr" | "partial_alias" | "not_found";
  candidates?: SnmpInterface[];
}

export async function findInterfaceByName(
  targetIp: string,
  profile: SnmpProfile,
  searchName: string,
  searchDescr?: string | null,
  searchAlias?: string | null
): Promise<InterfaceSearchResult> {
  console.log(`[SNMP Interface Search] Searching for interface "${searchName}" (alias: "${searchAlias || 'none'}") on ${targetIp}`);
  
  try {
    const interfaces = await discoverInterfaces(targetIp, profile);
    
    if (interfaces.length === 0) {
      console.log(`[SNMP Interface Search] No interfaces discovered on ${targetIp}`);
      return { found: false, ifIndex: null, ifName: null, ifDescr: null, ifAlias: null, matchType: "not_found" };
    }
    
    // 1. Try exact match on ifName
    const exactNameMatch = interfaces.find(
      (iface) => iface.ifName.toLowerCase() === searchName.toLowerCase()
    );
    if (exactNameMatch) {
      console.log(`[SNMP Interface Search] Exact ifName match found: ifIndex ${exactNameMatch.ifIndex}`);
      return {
        found: true,
        ifIndex: exactNameMatch.ifIndex,
        ifName: exactNameMatch.ifName,
        ifDescr: exactNameMatch.ifDescr,
        ifAlias: exactNameMatch.ifAlias,
        matchType: "exact_name",
      };
    }
    
    // 2. Try exact match on ifAlias (useful for Cisco PPPoE interfaces with description)
    if (searchAlias) {
      const exactAliasMatch = interfaces.find(
        (iface) => iface.ifAlias && iface.ifAlias.toLowerCase() === searchAlias.toLowerCase()
      );
      if (exactAliasMatch) {
        console.log(`[SNMP Interface Search] Exact ifAlias match found: ifIndex ${exactAliasMatch.ifIndex} (alias: ${exactAliasMatch.ifAlias})`);
        return {
          found: true,
          ifIndex: exactAliasMatch.ifIndex,
          ifName: exactAliasMatch.ifName,
          ifDescr: exactAliasMatch.ifDescr,
          ifAlias: exactAliasMatch.ifAlias,
          matchType: "exact_alias",
        };
      }
    }
    
    // 3. Try exact match on ifDescr
    if (searchDescr) {
      const exactDescrMatch = interfaces.find(
        (iface) => iface.ifDescr.toLowerCase() === searchDescr.toLowerCase()
      );
      if (exactDescrMatch) {
        console.log(`[SNMP Interface Search] Exact ifDescr match found: ifIndex ${exactDescrMatch.ifIndex}`);
        return {
          found: true,
          ifIndex: exactDescrMatch.ifIndex,
          ifName: exactDescrMatch.ifName,
          ifDescr: exactDescrMatch.ifDescr,
          ifAlias: exactDescrMatch.ifAlias,
          matchType: "exact_descr",
        };
      }
    }
    
    // 4. Try partial match on ifName (contains search string)
    const partialNameMatches = interfaces.filter(
      (iface) => iface.ifName.toLowerCase().includes(searchName.toLowerCase()) ||
                 searchName.toLowerCase().includes(iface.ifName.toLowerCase())
    );
    if (partialNameMatches.length === 1) {
      console.log(`[SNMP Interface Search] Partial ifName match found: ifIndex ${partialNameMatches[0].ifIndex}`);
      return {
        found: true,
        ifIndex: partialNameMatches[0].ifIndex,
        ifName: partialNameMatches[0].ifName,
        ifDescr: partialNameMatches[0].ifDescr,
        ifAlias: partialNameMatches[0].ifAlias,
        matchType: "partial_name",
      };
    }
    
    // 5. Try partial match on ifAlias (Cisco PPPoE with description containing username)
    if (searchAlias) {
      const partialAliasMatches = interfaces.filter(
        (iface) => iface.ifAlias && (
          iface.ifAlias.toLowerCase().includes(searchAlias.toLowerCase()) ||
          searchAlias.toLowerCase().includes(iface.ifAlias.toLowerCase())
        )
      );
      if (partialAliasMatches.length === 1) {
        console.log(`[SNMP Interface Search] Partial ifAlias match found: ifIndex ${partialAliasMatches[0].ifIndex} (alias: ${partialAliasMatches[0].ifAlias})`);
        return {
          found: true,
          ifIndex: partialAliasMatches[0].ifIndex,
          ifName: partialAliasMatches[0].ifName,
          ifDescr: partialAliasMatches[0].ifDescr,
          ifAlias: partialAliasMatches[0].ifAlias,
          matchType: "partial_alias",
        };
      }
    }
    
    // 6. Try partial match on ifDescr
    if (searchDescr) {
      const partialDescrMatches = interfaces.filter(
        (iface) => iface.ifDescr.toLowerCase().includes(searchDescr.toLowerCase()) ||
                   searchDescr.toLowerCase().includes(iface.ifDescr.toLowerCase())
      );
      if (partialDescrMatches.length === 1) {
        console.log(`[SNMP Interface Search] Partial ifDescr match found: ifIndex ${partialDescrMatches[0].ifIndex}`);
        return {
          found: true,
          ifIndex: partialDescrMatches[0].ifIndex,
          ifName: partialDescrMatches[0].ifName,
          ifDescr: partialDescrMatches[0].ifDescr,
          ifAlias: partialDescrMatches[0].ifAlias,
          matchType: "partial_descr",
        };
      }
    }
    
    // 7. No unique match found - return candidates for manual selection
    const candidates = partialNameMatches.length > 0 ? partialNameMatches : interfaces.slice(0, 10);
    console.log(`[SNMP Interface Search] No unique match found, returning ${candidates.length} candidates`);
    
    return {
      found: false,
      ifIndex: null,
      ifName: null,
      ifDescr: null,
      ifAlias: null,
      matchType: "not_found",
      candidates,
    };
  } catch (error) {
    console.error(`[SNMP Interface Search] Error searching for interface on ${targetIp}:`, error);
    return { found: false, ifIndex: null, ifName: null, ifDescr: null, ifAlias: null, matchType: "not_found" };
  }
}

export async function validateIfIndex(
  targetIp: string,
  profile: SnmpProfile,
  ifIndex: number,
  expectedIfName: string | null,
  expectedIfDescr: string | null
): Promise<{ valid: boolean; currentIfName: string | null; currentIfDescr: string | null }> {
  try {
    const session = createSession(targetIp, profile);
    
    const ifNameOid = `${IF_X_TABLE_OIDS.ifName}.${ifIndex}`;
    const ifDescrOid = `${IF_TABLE_OIDS.ifDescr}.${ifIndex}`;
    
    return new Promise((resolve) => {
      let completed = false;
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { session.close(); } catch {}
          resolve({ valid: false, currentIfName: null, currentIfDescr: null });
        }
      }, profile.timeout + 2000);
      
      (session as any).get([ifNameOid, ifDescrOid], (error: any, varbinds: any[]) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          try { session.close(); } catch {}
          
          if (error || !varbinds || varbinds.length < 2) {
            resolve({ valid: false, currentIfName: null, currentIfDescr: null });
            return;
          }
          
          let currentIfName: string | null = null;
          let currentIfDescr: string | null = null;
          
          if (varbinds[0] && !isVarbindError(varbinds[0])) {
            currentIfName = Buffer.isBuffer(varbinds[0].value) 
              ? varbinds[0].value.toString("utf8") 
              : String(varbinds[0].value);
          }
          
          if (varbinds[1] && !isVarbindError(varbinds[1])) {
            currentIfDescr = Buffer.isBuffer(varbinds[1].value) 
              ? varbinds[1].value.toString("utf8") 
              : String(varbinds[1].value);
          }
          
          // Check if ifName or ifDescr matches expected values
          const nameMatches = expectedIfName && currentIfName && 
            currentIfName.toLowerCase() === expectedIfName.toLowerCase();
          const descrMatches = expectedIfDescr && currentIfDescr && 
            currentIfDescr.toLowerCase() === expectedIfDescr.toLowerCase();
          
          const valid = !!(nameMatches || descrMatches);
          
          resolve({ valid, currentIfName, currentIfDescr });
        }
      });
    });
  } catch (error) {
    console.error(`[SNMP Validate] Error validating ifIndex ${ifIndex} on ${targetIp}:`, error);
    return { valid: false, currentIfName: null, currentIfDescr: null };
  }
}

function isVarbindError(varbind: any): boolean {
  if (!varbind) return true;
  return (snmp as any).isVarbindError(varbind);
}

// ============ Optical Signal Monitoring ============

export interface OpticalSignalData {
  rxPower: number | null;  // Potência RX na ONU (downstream) em dBm
  txPower: number | null;  // Potência TX na ONU (upstream) em dBm
  oltRxPower: number | null; // Potência RX na OLT (upstream do cliente) em dBm
  onuDistance?: number | null; // Distância da ONU em metros (via SNMP da OLT)
}

// OIDs comuns para leitura de sinal óptico em ONUs
// Estes OIDs variam por fabricante - configuráveis por equipamento
export const OPTICAL_OIDS = {
  // Huawei MA5800/MA5608T
  huawei: {
    onuRxPower: "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4", // hwGponOntOpticalDdmRxPower
    onuTxPower: "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.5", // hwGponOntOpticalDdmTxPower
  },
  // ZTE C320/C300
  zte: {
    onuRxPower: "1.3.6.1.4.1.3902.1012.3.50.12.1.1.10", // zxAnGponOnuRxOpticalLevel
    onuTxPower: "1.3.6.1.4.1.3902.1012.3.50.12.1.1.11", // zxAnGponOnuTxOpticalLevel
  },
  // Fiberhome AN5516
  fiberhome: {
    onuRxPower: "1.3.6.1.4.1.5875.800.3.10.1.1.6", // Custom OID
    onuTxPower: "1.3.6.1.4.1.5875.800.3.10.1.1.7", // Custom OID
  },
  // Nokia (Alcatel-Lucent) ISAM
  nokia: {
    onuRxPower: "1.3.6.1.4.1.637.61.1.35.11.4.1.7", // asamOpticalRxLevel
    onuTxPower: "1.3.6.1.4.1.637.61.1.35.11.4.1.8", // asamOpticalTxLevel
  },
  // Furukawa Parks/LaserWay (enterprise 3979) - LD2502/LD2504/FK-OLT-G4S/G8S
  // Índice SNMP: portId.onuId onde portId = 6000 + (slot * 100) + port
  // Valores retornados em centésimos de dBm (dividir por 100)
  furukawa: {
    onuRxPower: "1.3.6.1.4.1.3979.6.4.2.1.2.3.2.1.15", // fkGponOnuRxOpticalPower (centésimos de dBm)
    onuTxPower: "1.3.6.1.4.1.3979.6.4.2.1.2.3.2.1.14", // fkGponOnuTxOpticalPower (centésimos de dBm)
    onuDistance: "1.3.6.1.4.1.3979.6.4.2.1.2.1.1.1.21", // fkGponOnuDistance (metros)
  },
  // Datacom DM4610/DM4615 (GPON-ONU-IF-MIB)
  // NOTA: Datacom não expõe OLT RX via SNMP - usar fallback Zabbix para OLT_RX
  datacom: {
    onuRxPower: "1.3.6.1.4.1.3709.3.6.2.1.1.22", // onuIfOnuPowerRx (dBm, FLOAT) - RX na ONU
    onuTxPower: "1.3.6.1.4.1.3709.3.6.2.1.1.21", // onuIfOnuPowerTx (dBm, FLOAT) - TX da ONU
    // oltRxPower: não disponível via SNMP na Datacom - fallback Zabbix é usado automaticamente
  },
  // Intelbras OLT 8820G / 110Gi
  intelbras: {
    onuRxPower: "1.3.6.1.4.1.26138.1.2.1.1.1.9",  // RX Power ONU (STRING dBm, "--" = offline)
    oltRxPower: "1.3.6.1.4.1.26138.1.2.1.1.1.8",   // RX Power na OLT (STRING dBm)
    onuAlerts:  "1.3.6.1.4.1.26138.1.2.1.1.1.10",  // Alertas da ONU
  },
};

// Parâmetros da ONU para cálculo do índice SNMP
export interface OnuParams {
  slot: number;
  port: number;
  onuId: number;
  shelf?: number; // Alguns fabricantes usam shelf (padrão 0)
}

/**
 * Calcula o índice SNMP da ONU baseado no fabricante.
 * Cada fabricante tem uma fórmula diferente para compor o índice.
 * 
 * @param vendorSlug Identificador do fabricante (huawei, zte, fiberhome, nokia, datacom)
 * @param params Parâmetros da ONU (slot, port, onuId, shelf)
 * @returns String do índice SNMP ou null se fabricante não suportado
 */
export function calculateOnuSnmpIndex(vendorSlug: string, params: OnuParams): string | null {
  const { slot, port, onuId, shelf = 0 } = params;
  const normalizedSlug = vendorSlug.toLowerCase().trim();
  
  switch (normalizedSlug) {
    case 'huawei':
    case 'huawei-ma5800':
    case 'huawei-ma5608t':
      // Huawei: índice = (shelf * 8388608) + (slot * 65536) + (port * 256) + onuId
      // Frame/Shelf padrão = 0, então: (slot * 65536) + (port * 256) + onuId
      // Fórmula oficial Huawei: hwGponDeviceOntIndex = frameId * 8388608 + slotId * 65536 + portId * 256 + ontId
      const huaweiIndex = (shelf * 8388608) + (slot * 65536) + (port * 256) + onuId;
      return huaweiIndex.toString();
    
    case 'zte':
    case 'zte-c320':
    case 'zte-c300':
    case 'zte-c600':
      // ZTE: índice composto = {gponIfIndex}.{onuId}
      // gponIfIndex = (rack * 33554432) + (shelf * 1048576) + (slot * 32768) + (port * 256) + 1
      // Simplificado para rack=0, shelf=0: (slot * 32768) + (port * 256) + 1
      const zteGponIfIndex = (slot * 32768) + (port * 256) + 1;
      return `${zteGponIfIndex}.${onuId}`;
    
    case 'fiberhome':
    case 'fiberhome-an5516':
    case 'an5516':
      // Fiberhome: índice = ponPortIndex.onuId
      // ponPortIndex pode variar, formato comum: slot*1000000 + port*1000 + 1
      // Ou formato mais simples: {ponId}.{onuId} onde ponId = slot * 16 + port
      const fhPonId = slot * 16 + port;
      return `${fhPonId}.${onuId}`;
    
    case 'nokia':
    case 'nokia-isam':
    case 'alcatel':
    case 'alcatel-lucent':
      // Nokia/Alcatel-Lucent ISAM: índice = ponPortId.onuId
      // ponPortId = (shelf * 65536) + (slot * 256) + port + 1
      // Simplificado: (slot * 256) + port + 1
      const nokiaPonPortId = (slot * 256) + port + 1;
      return `${nokiaPonPortId}.${onuId}`;
    
    case 'datacom':
    case 'datacom-dm4610':
    case 'datacom-dm4615':
      // Datacom DM4610/DM4615: fórmula confirmada via snmpwalk em produção
      // Índice = (slot * 16777216) + (onuId * 256) + (port - 1)
      // Onde slot=1 (fixo para DM4610), port=porta PON (1-8), onuId=ID da ONU (0-127)
      // IMPORTANTE: port e onuId estão invertidos na fórmula!
      // port usa base 1 na CLI mas base 0 no índice, por isso (port - 1)
      const datacomIndex = (slot * 16777216) + (onuId * 256) + (port - 1);
      return datacomIndex.toString();
    
    case 'furukawa':
    case 'furukawa-g4s':
    case 'furukawa-g8s':
      // Furukawa Parks/LaserWay: índice = {portId}.{onuId}
      // portId = 6000 + (slot * 100) + port
      // Exemplo: slot=1, port=1 -> portId = 6101, ONU 1 -> index = 6101.1
      const furukawaPortId = 6000 + (slot * 100) + port;
      return `${furukawaPortId}.${onuId}`;

    case 'parks':
    case 'parks-fiberlink':
      // Parks FiberLink: formato slot.port.onuId
      return `${slot}.${port}.${onuId}`;
    
    case 'intelbras':
    case 'intelbras-olt':
    case 'intelbras-8820g':
    case 'intelbras-110gi':
      // Intelbras OLT 8820G/110Gi: índice simples sequencial
      // 128 ONUs por PON, índice = (port - 1) * 128 + onuId
      // Exemplo: PON 1 ONU 6 = (1-1)*128 + 6 = 6
      // Exemplo: PON 3 ONU 10 = (3-1)*128 + 10 = 266
      // Valores retornados como STRING ("-15.92" ou "--" para offline)
      const intelbrasIndex = (port - 1) * 128 + onuId;
      return intelbrasIndex.toString();
    
    default:
      // Formato genérico: slot.port.onuId
      console.log(`[SNMP] Fabricante '${vendorSlug}' sem fórmula específica, usando formato genérico`);
      return `${slot}.${port}.${onuId}`;
  }
}

/**
 * Constrói o OID completo concatenando o OID base com o índice da ONU.
 * 
 * @param baseOid OID base do fabricante (sem o índice)
 * @param onuIndex Índice da ONU calculado por calculateOnuSnmpIndex
 * @returns OID completo para consulta SNMP
 */
export function buildOpticalOid(baseOid: string, onuIndex: string): string {
  // Remove ponto final se existir no OID base
  const cleanBase = baseOid.endsWith('.') ? baseOid.slice(0, -1) : baseOid;
  return `${cleanBase}.${onuIndex}`;
}

/**
 * Coleta dados de sinal óptico via SNMP.
 * @param targetIp IP do equipamento (OLT)
 * @param profile Perfil SNMP
 * @param vendorSlug Slug do fabricante (huawei, zte, fiberhome, etc.)
 * @param onuParams Parâmetros da ONU (slot, port, onuId) para calcular índice
 * @param baseRxOid OID base para RX Power (sem índice)
 * @param baseTxOid OID base para TX Power (sem índice)
 * @param baseOltRxOid OID base para RX Power na OLT (sem índice)
 * @returns Dados de sinal óptico ou null se falhar
 */
export async function getOpticalSignal(
  targetIp: string,
  profile: SnmpProfile,
  vendorSlug: string,
  onuParams: OnuParams | null,
  baseRxOid?: string | null,
  baseTxOid?: string | null,
  baseOltRxOid?: string | null,
  baseDistanceOid?: string | null
): Promise<OpticalSignalData | null> {
  if (!baseRxOid && !baseTxOid && !baseOltRxOid) {
    return null; // Sem OIDs configurados
  }
  
  if (!onuParams || onuParams.slot === undefined || onuParams.port === undefined || onuParams.onuId === undefined) {
    console.log(`[SNMP Optical] Parâmetros da ONU incompletos (slot/port/onuId), pulando coleta`);
    return null;
  }
  
  // Calcular índice SNMP da ONU baseado no fabricante
  const onuIndex = calculateOnuSnmpIndex(vendorSlug, onuParams);
  if (!onuIndex) {
    console.log(`[SNMP Optical] Não foi possível calcular índice para fabricante '${vendorSlug}'`);
    return null;
  }
  
  console.log(`[SNMP Optical] Índice calculado para ${vendorSlug}: slot=${onuParams.slot}, port=${onuParams.port}, onuId=${onuParams.onuId} -> index=${onuIndex}`);

  const session = createSession(targetIp, profile);
  
  try {
    const oidsToQuery: string[] = [];
    const oidMapping: Record<string, keyof OpticalSignalData> = {};
    
    // Construir OIDs completos com índice da ONU
    if (baseRxOid) {
      const fullOid = buildOpticalOid(baseRxOid, onuIndex);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'rxPower';
    }
    if (baseTxOid) {
      const fullOid = buildOpticalOid(baseTxOid, onuIndex);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'txPower';
    }
    if (baseOltRxOid) {
      const fullOid = buildOpticalOid(baseOltRxOid, onuIndex);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'oltRxPower';
    }
    if (baseDistanceOid) {
      const fullOid = buildOpticalOid(baseDistanceOid, onuIndex);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'onuDistance';
    }
    
    console.log(`[SNMP Optical] Consultando OIDs: ${oidsToQuery.join(', ')}`);

    return new Promise((resolve) => {
      let completed = false;
      
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { session.close(); } catch {}
          resolve(null);
        }
      }, profile.timeout + 2000);
      
      (session as any).get(oidsToQuery, (error: any, varbinds: any[]) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          try { session.close(); } catch {}
          
          if (error) {
            console.log(`[SNMP Optical] Erro na consulta: ${error.message || error}`);
            resolve(null);
            return;
          }
          
          if (!varbinds || varbinds.length === 0) {
            console.log(`[SNMP Optical] Nenhum resultado retornado`);
            resolve(null);
            return;
          }
          
          const result: OpticalSignalData = {
            rxPower: null,
            txPower: null,
            oltRxPower: null,
            onuDistance: null,
          };
          
          oidsToQuery.forEach((oid, index) => {
            const varbind = varbinds[index];
            if (varbind && !isVarbindError(varbind)) {
              const key = oidMapping[oid];
              let value: number;
              
              if (typeof varbind.value === 'number') {
                value = varbind.value;
              } else if (Buffer.isBuffer(varbind.value)) {
                value = parseInt(varbind.value.toString(), 10);
              } else {
                value = parseFloat(String(varbind.value));
              }
              
              if (!isNaN(value)) {
                if (key === 'onuDistance') {
                  result[key] = value;
                } else {
                  if (value > 100 || value < -100) {
                    value = value / 100;
                  }
                  const rounded = Math.round(value * 10) / 10;
                  if (rounded === 0) {
                    console.log(`[SNMP Optical] ${key} retornou 0 dBm - tratando como sem leitura (equipamento possivelmente desligado)`);
                    result[key] = null;
                  } else {
                    result[key] = rounded;
                  }
                }
              }
            }
          });
          
          resolve(result);
        }
      });
    });
  } catch (error) {
    console.error(`[SNMP Optical] Error getting optical signal from ${targetIp}:`, error);
    try { session.close(); } catch {}
    return null;
  }
}

// OID para sysDescr (descrição do sistema) - usado para teste de conexão
const SYS_DESCR_OID = "1.3.6.1.2.1.1.1.0";
const SYS_NAME_OID = "1.3.6.1.2.1.1.5.0";
const SYS_UPTIME_OID = "1.3.6.1.2.1.1.3.0";

export interface SnmpTestResult {
  success: boolean;
  sysDescr?: string;
  sysName?: string;
  uptime?: string;
  error?: string;
  responseTime?: number;
}

/**
 * Testa conexão SNMP com um equipamento
 * Consulta sysDescr, sysName e sysUptime para verificar conectividade
 */
export async function testSnmpConnection(
  targetIp: string,
  profile: SnmpProfile
): Promise<SnmpTestResult> {
  const startTime = Date.now();
  const session = createSession(targetIp, profile);
  
  try {
    return await new Promise<SnmpTestResult>((resolve) => {
      const oids = [SYS_DESCR_OID, SYS_NAME_OID, SYS_UPTIME_OID];
      
      (session as any).get(oids, (error: any, varbinds: any[]) => {
        const responseTime = Date.now() - startTime;
        session.close();
        
        if (error) {
          resolve({
            success: false,
            error: error.message || "Timeout ou erro de conexão SNMP",
            responseTime,
          });
        } else {
          const result: SnmpTestResult = {
            success: true,
            responseTime,
          };
          
          varbinds.forEach((varbind: any) => {
            if (isVarbindError(varbind)) {
              return;
            }
            
            const oid = varbind.oid.toString();
            let value: string;
            
            if (Buffer.isBuffer(varbind.value)) {
              value = varbind.value.toString("utf-8");
            } else {
              value = String(varbind.value);
            }
            
            if (oid === SYS_DESCR_OID) {
              result.sysDescr = value;
            } else if (oid === SYS_NAME_OID) {
              result.sysName = value;
            } else if (oid === SYS_UPTIME_OID) {
              // Uptime vem em centésimos de segundo
              const uptimeTicks = parseInt(value, 10);
              if (!isNaN(uptimeTicks)) {
                const seconds = Math.floor(uptimeTicks / 100);
                const days = Math.floor(seconds / 86400);
                const hours = Math.floor((seconds % 86400) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                result.uptime = `${days}d ${hours}h ${minutes}m`;
              }
            }
          });
          
          resolve(result);
        }
      });
    });
  } catch (error) {
    try { session.close(); } catch {}
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Calcula o índice SNMP da porta do switch baseado no template de fórmula
 * @param portIndexTemplate Template como "{slot}*8+{port}" ou número direto
 * @param switchPort Porta do switch como "1/1/1" (slot/module/port)
 * @returns Índice SNMP calculado
 */
export function calculateSwitchPortIndex(portIndexTemplate: string | null, switchPort: string): number | null {
  if (!switchPort) return null;
  
  // Se não há template, tentar extrair número diretamente da porta
  if (!portIndexTemplate || portIndexTemplate.trim() === "") {
    // Formato direto: "1" ou "GigabitEthernet0/1" -> extrair número final
    const match = switchPort.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }
  
  // Parse da porta: pode ser "1/1/1" (slot/module/port) ou "0/1" (slot/port) ou "1" (port)
  const parts = switchPort.split("/").map(p => parseInt(p.replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
  
  let slot = 0, port = 0, module = 0;
  if (parts.length === 1) {
    port = parts[0];
  } else if (parts.length === 2) {
    slot = parts[0];
    port = parts[1];
  } else if (parts.length >= 3) {
    slot = parts[0];
    module = parts[1];
    port = parts[2];
  }
  
  // Substituir variáveis no template
  let formula = portIndexTemplate
    .replace(/\{slot\}/gi, slot.toString())
    .replace(/\{module\}/gi, module.toString())
    .replace(/\{port\}/gi, port.toString());
  
  // Avaliar a fórmula matemática de forma segura
  try {
    // Permitir apenas números, operadores matemáticos e parênteses
    if (!/^[\d\s+\-*/()]+$/.test(formula)) {
      console.log(`[Switch Port Index] Fórmula inválida: ${formula}`);
      return null;
    }
    const result = eval(formula);
    return typeof result === "number" && !isNaN(result) ? Math.floor(result) : null;
  } catch (error) {
    console.log(`[Switch Port Index] Erro ao avaliar fórmula: ${formula}`, error);
    return null;
  }
}

/**
 * Coleta sinal óptico de um switch PTP via SNMP
 * @param targetIp IP do switch
 * @param profile Perfil SNMP
 * @param switchPort Porta do switch (ex: "1/1/1")
 * @param opticalRxOidTemplate Template OID RX com {portIndex} ou {ifIndex}
 * @param opticalTxOidTemplate Template OID TX com {portIndex} ou {ifIndex}
 * @param portIndexTemplate Template para cálculo do índice da porta
 * @param divisor Divisor para conversão do valor SNMP para dBm (ex: 1000 para Mikrotik, 100 para Datacom)
 * @param ifIndex Índice SNMP da interface (usado quando template contém {ifIndex})
 * @returns Dados de sinal óptico ou null se falhar
 */
export async function getOpticalSignalFromSwitch(
  targetIp: string,
  profile: SnmpProfile,
  switchPort: string,
  opticalRxOidTemplate: string | null,
  opticalTxOidTemplate: string | null,
  portIndexTemplate: string | null,
  divisor: number = 1000,
  ifIndex: number | null = null
): Promise<OpticalSignalData | null> {
  if (!opticalRxOidTemplate && !opticalTxOidTemplate) {
    return null; // Sem OIDs configurados
  }
  
  // Verificar se os templates usam {ifIndex} (ex: Datacom)
  const usesIfIndex = (opticalRxOidTemplate?.includes('{ifIndex}') || opticalTxOidTemplate?.includes('{ifIndex}'));
  
  // Calcular índice da porta (para templates com {portIndex})
  let portIndex: number | null = null;
  if (!usesIfIndex) {
    portIndex = calculateSwitchPortIndex(portIndexTemplate, switchPort);
    if (portIndex === null) {
      console.log(`[SNMP Switch Optical] Não foi possível calcular índice para porta '${switchPort}'`);
      return null;
    }
    console.log(`[SNMP Switch Optical] Porta ${switchPort} -> índice ${portIndex}`);
  } else {
    // Para templates com {ifIndex}, o ifIndex é obrigatório
    if (ifIndex === null) {
      console.log(`[SNMP Switch Optical] Template usa {ifIndex} mas ifIndex não foi fornecido`);
      return null;
    }
    console.log(`[SNMP Switch Optical] Porta ${switchPort} -> usando ifIndex ${ifIndex}`);
  }

  const session = createSession(targetIp, profile);
  
  try {
    const oidsToQuery: string[] = [];
    const oidMapping: Record<string, keyof OpticalSignalData> = {};
    
    // Função para substituir placeholders no template
    const replaceTemplateVars = (template: string): string => {
      let result = template;
      if (portIndex !== null) {
        result = result.replace(/\{portIndex\}/gi, portIndex.toString());
      }
      if (ifIndex !== null) {
        result = result.replace(/\{ifIndex\}/gi, ifIndex.toString());
      }
      return result;
    };
    
    // Substituir placeholders nos templates de OID e limpar caracteres invisíveis
    // A biblioteca net-snmp requer OIDs SEM ponto inicial (ex: "1.3.6.1.2.1" não ".1.3.6.1.2.1")
    if (opticalRxOidTemplate) {
      let cleanTemplate = opticalRxOidTemplate.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
      if (cleanTemplate.startsWith('.')) {
        cleanTemplate = cleanTemplate.substring(1);
      }
      const fullOid = replaceTemplateVars(cleanTemplate);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'rxPower';
    }
    if (opticalTxOidTemplate) {
      let cleanTemplate = opticalTxOidTemplate.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
      if (cleanTemplate.startsWith('.')) {
        cleanTemplate = cleanTemplate.substring(1);
      }
      const fullOid = replaceTemplateVars(cleanTemplate);
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'txPower';
    }
    
    // Debug: mostrar OIDs e seus bytes para detectar caracteres invisíveis
    for (const oid of oidsToQuery) {
      console.log(`[SNMP Switch Optical] OID: "${oid}" (len=${oid.length}, bytes=${Buffer.from(oid).toString('hex')})`);
    }
    console.log(`[SNMP Switch Optical] Consultando OIDs: ${oidsToQuery.join(', ')}`);

    return new Promise((resolve) => {
      let completed = false;
      
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { session.close(); } catch {}
          resolve(null);
        }
      }, profile.timeout + 2000);
      
      (session as any).get(oidsToQuery, (error: any, varbinds: any[]) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          try { session.close(); } catch {}
          
          if (error) {
            console.log(`[SNMP Switch Optical] Erro na consulta: ${error.message || error}`);
            resolve(null);
            return;
          }
          
          if (!varbinds || varbinds.length === 0) {
            console.log(`[SNMP Switch Optical] Resposta vazia`);
            resolve(null);
            return;
          }
          
          const result: OpticalSignalData = {
            rxPower: null,
            txPower: null,
            oltRxPower: null
          };
          
          for (const varbind of varbinds) {
            if ((varbind as any).type && (varbind as any).type === 128) continue; // noSuchObject
            if ((varbind as any).type && (varbind as any).type === 129) continue; // noSuchInstance
            
            const oid = varbind.oid;
            const key = oidMapping[oid];
            if (key && varbind.value !== undefined) {
              // Converter valor SNMP para dBm usando divisor configurado
              const rawValue = Number(varbind.value);
              if (!isNaN(rawValue)) {
                // Usar divisor parametrizado (ex: 1000 para Mikrotik, 100 para outros)
                // Se divisor = 1, valor já está em dBm
                const dBmValue = divisor > 1 ? rawValue / divisor : rawValue;
                result[key] = dBmValue;
                console.log(`[SNMP Switch Optical] ${key}: ${result[key]} dBm (raw: ${rawValue}, divisor: ${divisor})`);
              }
            }
          }
          
          // Retornar null se não obteve nenhum valor
          if (result.rxPower === null && result.txPower === null) {
            resolve(null);
          } else {
            resolve(result);
          }
        }
      });
    });
  } catch (error) {
    try { session.close(); } catch {}
    console.log(`[SNMP Switch Optical] Erro: ${error instanceof Error ? error.message : "desconhecido"}`);
    return null;
  }
}

// ============================================================================
// Cisco Entity MIB Discovery - Para switches Nexus e similares
// ============================================================================

export interface CiscoSensorMapping {
  portName: string;           // Nome da porta (ex: "Ethernet1/1")
  rxSensorIndex: string | null;   // entPhysicalIndex do sensor RX Power
  txSensorIndex: string | null;   // entPhysicalIndex do sensor TX Power
  tempSensorIndex: string | null; // entPhysicalIndex do sensor Temperature
}

/**
 * Descobre os sensores ópticos de um switch Cisco via Entity MIB.
 * Faz walk na tabela entPhysicalName para encontrar sensores de "Receive Power" e "Transmit Power"
 * e mapeia-os para as portas correspondentes.
 * 
 * @param targetIp IP do switch
 * @param profile Perfil SNMP
 * @returns Mapeamento de portas para índices de sensores
 */
export async function discoverCiscoSensors(
  targetIp: string,
  profile: SnmpProfile
): Promise<CiscoSensorMapping[]> {
  console.log(`[Cisco Discovery] Iniciando discovery de sensores em ${targetIp}...`);
  
  const session = createSession(targetIp, profile);
  const results: CiscoSensorMapping[] = [];
  
  try {
    // Fazer walk na tabela entPhysicalName para encontrar todos os componentes
    const entityNames = await new Promise<Map<string, string>>((resolve) => {
      const names = new Map<string, string>();
      let completed = false;
      
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.log(`[Cisco Discovery] Timeout no walk de entPhysicalName`);
          resolve(names);
        }
      }, 60000); // 60 segundos para discovery completo
      
      session.subtree(ENTITY_MIB_OIDS.entPhysicalName, (varbinds: any[]) => {
        for (const varbind of varbinds) {
          if ((varbind as any).type === 128 || (varbind as any).type === 129) continue;
          // Extrair o entPhysicalIndex do OID (última parte)
          const oid = varbind.oid;
          const index = oid.substring(ENTITY_MIB_OIDS.entPhysicalName.length + 1);
          const name = varbind.value?.toString() || "";
          if (index && name) {
            names.set(index, name);
          }
        }
      }, (error: any) => {
        clearTimeout(timeoutId);
        if (!completed) {
          completed = true;
          if (error) {
            console.log(`[Cisco Discovery] Erro no walk: ${error.message || error}`);
          }
          resolve(names);
        }
      });
    });
    
    try { session.close(); } catch {}
    
    console.log(`[Cisco Discovery] Encontrados ${entityNames.size} componentes físicos`);
    
    if (entityNames.size === 0) {
      return [];
    }
    
    // Mapear sensores para portas
    // Formato típico Cisco Nexus:
    // "Ethernet1/1 Receive Power Sensor" -> RX para Ethernet1/1
    // "Ethernet1/1 Transmit Power Sensor" -> TX para Ethernet1/1
    // "Ethernet1/1 Lane 1 Receive Power Sensor" -> RX Lane 1 (para multi-lane)
    // "Ethernet1/1 Transceiver Temperature Sensor" -> Temp para Ethernet1/1
    
    const portSensors = new Map<string, CiscoSensorMapping>();
    // Rastrear portas pai que têm lanes (para criar entrada da porta 40G nativa)
    const parentPortLane1 = new Map<string, { rx: string | null; tx: string | null; temp: string | null }>();
    
    for (const [index, name] of Array.from(entityNames.entries())) {
      const lowerName = name.toLowerCase();
      
      // Extrair nome da porta do sensor
      // Padrão: "Ethernet1/1 ..." ou "Eth1/1 ..."
      const portMatch = name.match(/^(Ethernet\d+\/\d+(?:\/\d+)?|Eth\d+\/\d+(?:\/\d+)?)/i);
      if (!portMatch) continue;
      
      let portName = portMatch[1].replace(/^Eth(\d)/i, "Ethernet$1"); // Normalizar para "Ethernet..."
      const originalPortName = portName; // Guardar nome original antes de adicionar lane
      
      // Detectar Lane X para portas QSFP (40G ou 100G)
      // "Ethernet1/29 Lane 1 ..." → para breakout: Ethernet1/29/1, para 40G nativo: Ethernet1/29
      const laneMatch = name.match(/Lane\s*(\d+)/i);
      const hasLane = laneMatch !== null;
      const laneNumber = laneMatch ? parseInt(laneMatch[1], 10) : 0;
      
      // Se tem Lane e porta não tem breakout explícito no nome
      if (hasLane && !portName.match(/\/\d+\/\d+$/)) {
        // Criar sub-porta para cenário de breakout
        portName = `${portName}/${laneNumber}`;
        
        // Se é Lane 1, também guardar para criar entrada da porta pai (40G nativo)
        if (laneNumber === 1) {
          if (!parentPortLane1.has(originalPortName)) {
            parentPortLane1.set(originalPortName, { rx: null, tx: null, temp: null });
          }
          const parentSensor = parentPortLane1.get(originalPortName)!;
          
          if (lowerName.includes("receive power") && !parentSensor.rx) {
            parentSensor.rx = index;
          } else if (lowerName.includes("transmit power") && !parentSensor.tx) {
            parentSensor.tx = index;
          } else if (lowerName.includes("temperature") && !parentSensor.temp) {
            parentSensor.temp = index;
          }
        }
      }
      
      // Criar entrada para a porta se não existir
      if (!portSensors.has(portName)) {
        portSensors.set(portName, {
          portName,
          rxSensorIndex: null,
          txSensorIndex: null,
          tempSensorIndex: null,
        });
      }
      
      const sensor = portSensors.get(portName)!;
      
      // Identificar tipo de sensor
      if (lowerName.includes("receive power") && !sensor.rxSensorIndex) {
        sensor.rxSensorIndex = index;
        console.log(`[Cisco Discovery] ${portName} RX Sensor: index ${index}`);
      } else if (lowerName.includes("transmit power") && !sensor.txSensorIndex) {
        sensor.txSensorIndex = index;
        console.log(`[Cisco Discovery] ${portName} TX Sensor: index ${index}`);
      } else if (lowerName.includes("temperature") && !sensor.tempSensorIndex) {
        sensor.tempSensorIndex = index;
        console.log(`[Cisco Discovery] ${portName} Temp Sensor: index ${index}`);
      }
    }
    
    // Adicionar entradas para portas pai (40G/100G nativo) usando sensores de Lane 1
    // Isso permite monitorar portas como "Ethernet1/29" mesmo quando a Entity MIB só tem lanes
    for (const [parentPort, sensors] of Array.from(parentPortLane1.entries())) {
      // Só adicionar se a porta pai não existir ainda (não foi criada por sensor direto)
      if (!portSensors.has(parentPort) && (sensors.rx || sensors.tx)) {
        portSensors.set(parentPort, {
          portName: parentPort,
          rxSensorIndex: sensors.rx,
          txSensorIndex: sensors.tx,
          tempSensorIndex: sensors.temp,
        });
        console.log(`[Cisco Discovery] ${parentPort} (40G/100G nativo): usando sensores de Lane 1 - RX=${sensors.rx}, TX=${sensors.tx}`);
      }
    }
    
    // Converter Map para array
    for (const sensor of Array.from(portSensors.values())) {
      if (sensor.rxSensorIndex || sensor.txSensorIndex) {
        results.push(sensor);
      }
    }
    
    console.log(`[Cisco Discovery] Discovery completo: ${results.length} portas com sensores`);
    return results;
    
  } catch (error) {
    try { session.close(); } catch {}
    console.log(`[Cisco Discovery] Erro: ${error instanceof Error ? error.message : "desconhecido"}`);
    return [];
  }
}

/**
 * Coleta sinal óptico de um switch Cisco usando índices de sensor descobertos.
 * 
 * @param targetIp IP do switch
 * @param profile Perfil SNMP
 * @param rxSensorIndex Índice do sensor RX (de switchSensorCache)
 * @param txSensorIndex Índice do sensor TX (de switchSensorCache)
 * @param divisor Divisor para conversão (Cisco geralmente usa 1, valor já em dBm)
 * @returns Dados de sinal óptico
 */
export async function getCiscoOpticalSignal(
  targetIp: string,
  profile: SnmpProfile,
  rxSensorIndex: string | null,
  txSensorIndex: string | null,
  divisor: number = 1
): Promise<OpticalSignalData | null> {
  if (!rxSensorIndex && !txSensorIndex) {
    return null;
  }
  
  const session = createSession(targetIp, profile);
  
  try {
    const oidsToQuery: string[] = [];
    const oidMapping: Record<string, keyof OpticalSignalData> = {};
    
    // Construir OIDs completos: base + índice do sensor
    if (rxSensorIndex) {
      const rxOid = `${CISCO_ENTITY_SENSOR_OID}.${rxSensorIndex}`;
      oidsToQuery.push(rxOid);
      oidMapping[rxOid] = 'rxPower';
    }
    if (txSensorIndex) {
      const txOid = `${CISCO_ENTITY_SENSOR_OID}.${txSensorIndex}`;
      oidsToQuery.push(txOid);
      oidMapping[txOid] = 'txPower';
    }
    
    console.log(`[Cisco Optical] Consultando sensores: RX=${rxSensorIndex}, TX=${txSensorIndex}`);
    
    return new Promise((resolve) => {
      let completed = false;
      
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          try { session.close(); } catch {}
          console.log(`[Cisco Optical] Timeout na consulta`);
          resolve(null);
        }
      }, 10000);
      
      (session as any).get(oidsToQuery, (error: any, varbinds: any[]) => {
        clearTimeout(timeoutId);
        if (completed) return;
        completed = true;
        
        try { session.close(); } catch {}
        
        if (error) {
          console.log(`[Cisco Optical] Erro: ${error.message || error}`);
          resolve(null);
          return;
        }
        
        if (!varbinds || varbinds.length === 0) {
          resolve(null);
          return;
        }
        
        const result: OpticalSignalData = {
          rxPower: null,
          txPower: null,
          oltRxPower: null
        };
        
        for (const varbind of varbinds) {
          if ((varbind as any).type === 128 || (varbind as any).type === 129) continue;
          
          const oid = varbind.oid;
          const key = oidMapping[oid];
          if (key && varbind.value !== undefined) {
            const rawValue = Number(varbind.value);
            if (!isNaN(rawValue)) {
              // Cisco retorna valor em centésimos de dBm (ex: -1523 = -15.23 dBm)
              // Usar divisor = 100 para converter
              const dBmValue = divisor > 1 ? rawValue / divisor : rawValue;
              result[key] = dBmValue;
              console.log(`[Cisco Optical] ${key}: ${result[key]} dBm (raw: ${rawValue})`);
            }
          }
        }
        
        if (result.rxPower === null && result.txPower === null) {
          resolve(null);
        } else {
          resolve(result);
        }
      });
    });
    
  } catch (error) {
    try { session.close(); } catch {}
    console.log(`[Cisco Optical] Erro: ${error instanceof Error ? error.message : "desconhecido"}`);
    return null;
  }
}
