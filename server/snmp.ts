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
const MAX_INTERFACES = 256;

function createSession(
  targetIp: string,
  profile: SnmpProfile
): snmp.Session {
  const options: snmp.SessionOptions = {
    port: profile.port,
    timeout: profile.timeout,
    retries: profile.retries,
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
  
  return new Promise((resolve, reject) => {
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

    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        // Return partial results instead of rejecting on timeout
        resolve(results);
      }
    }, profile.timeout + 5000);

    let count = 0;

    session.subtree(
      baseOid,
      (varbinds: any[]) => {
        if (!varbinds) return;
        
        for (const vb of varbinds) {
          // Stop if we've collected enough interfaces
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
            // Return partial results on error too
            resolve(results);
          } else {
            resolve(results);
          }
        }
      }
    );
  });
}

export async function discoverInterfaces(
  targetIp: string,
  profile: SnmpProfile
): Promise<SnmpInterface[]> {
  const discoveryProfile = {
    ...profile,
    timeout: Math.max(profile.timeout, 10000), // 10 seconds per operation
    retries: 1,
  };

  console.log(`[SNMP Discovery] Starting discovery for ${targetIp}`);
  const startTime = Date.now();

  try {
    // First get ifNumber to know how many interfaces exist
    let ifCount: number;
    try {
      ifCount = await getIfNumber(targetIp, discoveryProfile);
      console.log(`[SNMP Discovery] Device reports ${ifCount} interfaces`);
    } catch {
      ifCount = MAX_INTERFACES;
      console.log(`[SNMP Discovery] Could not get ifNumber, using max ${MAX_INTERFACES}`);
    }
    
    // Limit to reasonable number
    const maxReps = Math.min(ifCount + 5, MAX_INTERFACES);

    // Fetch all columns in parallel with GET-BULK limited to ifNumber
    const [ifIndexMap, ifDescrMap, ifSpeedMap, ifAdminStatusMap, ifOperStatusMap, ifNameMap, ifHighSpeedMap] =
      await Promise.all([
        getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifIndex, maxReps),
        getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifDescr, maxReps),
        getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifSpeed, maxReps),
        getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifAdminStatus, maxReps),
        getBulkColumn(targetIp, discoveryProfile, IF_TABLE_OIDS.ifOperStatus, maxReps),
        getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifName, maxReps).catch(() => new Map()),
        getBulkColumn(targetIp, discoveryProfile, IF_X_TABLE_OIDS.ifHighSpeed, maxReps).catch(() => new Map()),
      ]);

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
