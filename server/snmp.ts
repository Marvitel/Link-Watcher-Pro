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
    
    case 'parks':
    case 'parks-fiberlink':
      // Parks FiberLink: formato slot.port.onuId
      return `${slot}.${port}.${onuId}`;
    
    case 'intelbras':
    case 'intelbras-olt':
      // Intelbras: similar ao ZTE
      const intelbrasIfIndex = (slot * 32768) + (port * 256) + 1;
      return `${intelbrasIfIndex}.${onuId}`;
    
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
  baseOltRxOid?: string | null
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
          };
          
          oidsToQuery.forEach((oid, index) => {
            const varbind = varbinds[index];
            if (varbind && !isVarbindError(varbind)) {
              const key = oidMapping[oid];
              let value: number;
              
              // O valor pode vir em diferentes formatos dependendo do fabricante
              // Alguns retornam em décimos de dBm, outros em centésimos
              if (typeof varbind.value === 'number') {
                value = varbind.value;
              } else if (Buffer.isBuffer(varbind.value)) {
                value = parseInt(varbind.value.toString(), 10);
              } else {
                value = parseFloat(String(varbind.value));
              }
              
              // Verifica se precisa converter (alguns equipamentos retornam em centésimos de dBm)
              // Se o valor for muito grande (>100 ou <-100), provavelmente está em centésimos
              if (!isNaN(value)) {
                if (value > 100 || value < -100) {
                  value = value / 100; // Converte de centésimos para dBm
                } else if (value > 10 || value < -50) {
                  // Alguns retornam em décimos de dBm
                  // Valores típicos de sinal são entre -5 dBm e -35 dBm
                  // Se o valor estiver fora dessa faixa, pode precisar de conversão
                }
                result[key] = Math.round(value * 10) / 10; // Arredonda para 1 casa decimal
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
 * @param opticalRxOidTemplate Template OID RX com {portIndex}
 * @param opticalTxOidTemplate Template OID TX com {portIndex}
 * @param portIndexTemplate Template para cálculo do índice da porta
 * @returns Dados de sinal óptico ou null se falhar
 */
export async function getOpticalSignalFromSwitch(
  targetIp: string,
  profile: SnmpProfile,
  switchPort: string,
  opticalRxOidTemplate: string | null,
  opticalTxOidTemplate: string | null,
  portIndexTemplate: string | null
): Promise<OpticalSignalData | null> {
  if (!opticalRxOidTemplate && !opticalTxOidTemplate) {
    return null; // Sem OIDs configurados
  }
  
  // Calcular índice da porta
  const portIndex = calculateSwitchPortIndex(portIndexTemplate, switchPort);
  if (portIndex === null) {
    console.log(`[SNMP Switch Optical] Não foi possível calcular índice para porta '${switchPort}'`);
    return null;
  }
  
  console.log(`[SNMP Switch Optical] Porta ${switchPort} -> índice ${portIndex}`);

  const session = createSession(targetIp, profile);
  
  try {
    const oidsToQuery: string[] = [];
    const oidMapping: Record<string, keyof OpticalSignalData> = {};
    
    // Substituir {portIndex} nos templates de OID
    if (opticalRxOidTemplate) {
      const fullOid = opticalRxOidTemplate.replace(/\{portIndex\}/gi, portIndex.toString());
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'rxPower';
    }
    if (opticalTxOidTemplate) {
      const fullOid = opticalTxOidTemplate.replace(/\{portIndex\}/gi, portIndex.toString());
      oidsToQuery.push(fullOid);
      oidMapping[fullOid] = 'txPower';
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
              // Converter valor SNMP para dBm
              const rawValue = Number(varbind.value);
              if (!isNaN(rawValue)) {
                // Valor pode estar em centésimos de dBm
                result[key] = rawValue > 100 || rawValue < -100 ? rawValue / 100 : rawValue;
                console.log(`[SNMP Switch Optical] ${key}: ${result[key]} dBm (raw: ${rawValue})`);
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
