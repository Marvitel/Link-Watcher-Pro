import snmp from "net-snmp";

export interface SnmpInterface {
  ifIndex: number;
  ifName: string;
  ifDescr: string;
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
  // Determine SNMP version - net-snmp uses numeric constants
  // Version1 = 0, Version2c = 1
  const snmpVersion = profile.version === "v1" ? 0 : 1;
  
  const options: any = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
    version: snmpVersion,
  };

  if (profile.version === "v3") {
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
    
    // Optional extended tables
    let ifNameMap = new Map<number, string | number>();
    let ifHighSpeedMap = new Map<number, string | number>();
    try {
      ifNameMap = await getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifName, MAX_INTERFACES);
      ifHighSpeedMap = await getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifHighSpeed, MAX_INTERFACES);
    } catch {
      console.log(`[SNMP Discovery] IF-MIB extended tables not available`);
    }

    console.log(`[SNMP Discovery] Completed for ${targetIp} in ${Date.now() - startTime}ms, found ${ifIndexMap.size} interfaces`);

    const interfaces: SnmpInterface[] = [];

    for (const [ifIndex] of Array.from(ifIndexMap.entries())) {
      const ifDescr = String(ifDescrMap.get(ifIndex) || "");
      const ifName = String(ifNameMap.get(ifIndex) || ifDescr);
      
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
  matchType: "exact_name" | "exact_descr" | "partial_name" | "partial_descr" | "not_found";
  candidates?: SnmpInterface[];
}

export async function findInterfaceByName(
  targetIp: string,
  profile: SnmpProfile,
  searchName: string,
  searchDescr?: string | null
): Promise<InterfaceSearchResult> {
  console.log(`[SNMP Interface Search] Searching for interface "${searchName}" on ${targetIp}`);
  
  try {
    const interfaces = await discoverInterfaces(targetIp, profile);
    
    if (interfaces.length === 0) {
      console.log(`[SNMP Interface Search] No interfaces discovered on ${targetIp}`);
      return { found: false, ifIndex: null, ifName: null, ifDescr: null, matchType: "not_found" };
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
        matchType: "exact_name",
      };
    }
    
    // 2. Try exact match on ifDescr
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
          matchType: "exact_descr",
        };
      }
    }
    
    // 3. Try partial match on ifName (contains search string)
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
        matchType: "partial_name",
      };
    }
    
    // 4. Try partial match on ifDescr
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
          matchType: "partial_descr",
        };
      }
    }
    
    // 5. No unique match found - return candidates for manual selection
    const candidates = partialNameMatches.length > 0 ? partialNameMatches : interfaces.slice(0, 10);
    console.log(`[SNMP Interface Search] No unique match found, returning ${candidates.length} candidates`);
    
    return {
      found: false,
      ifIndex: null,
      ifName: null,
      ifDescr: null,
      matchType: "not_found",
      candidates,
    };
  } catch (error) {
    console.error(`[SNMP Interface Search] Error searching for interface on ${targetIp}:`, error);
    return { found: false, ifIndex: null, ifName: null, ifDescr: null, matchType: "not_found" };
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

/**
 * Coleta dados de sinal óptico via SNMP.
 * @param targetIp IP do equipamento (OLT ou roteador com dados de ONU)
 * @param profile Perfil SNMP
 * @param rxOid OID personalizado para RX Power (opcional)
 * @param txOid OID personalizado para TX Power (opcional)
 * @param oltRxOid OID para RX Power na OLT (opcional)
 * @returns Dados de sinal óptico ou null se falhar
 */
export async function getOpticalSignal(
  targetIp: string,
  profile: SnmpProfile,
  rxOid?: string | null,
  txOid?: string | null,
  oltRxOid?: string | null
): Promise<OpticalSignalData | null> {
  if (!rxOid && !txOid && !oltRxOid) {
    return null; // Sem OIDs configurados
  }

  const session = createSession(targetIp, profile);
  
  try {
    const oidsToQuery: string[] = [];
    const oidMapping: Record<string, keyof OpticalSignalData> = {};
    
    if (rxOid) {
      oidsToQuery.push(rxOid);
      oidMapping[rxOid] = 'rxPower';
    }
    if (txOid) {
      oidsToQuery.push(txOid);
      oidMapping[txOid] = 'txPower';
    }
    if (oltRxOid) {
      oidsToQuery.push(oltRxOid);
      oidMapping[oltRxOid] = 'oltRxPower';
    }

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
          
          if (error || !varbinds || varbinds.length === 0) {
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
