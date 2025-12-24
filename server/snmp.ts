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

async function subtreeWalk(
  session: snmp.Session,
  oid: string
): Promise<Map<number, string | number>> {
  return new Promise((resolve, reject) => {
    const results = new Map<number, string | number>();

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
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      }
    );
  });
}

export async function discoverInterfaces(
  targetIp: string,
  profile: SnmpProfile
): Promise<SnmpInterface[]> {
  const session = createSession(targetIp, profile);

  try {
    const [ifIndexMap, ifDescrMap, ifSpeedMap, ifAdminStatusMap, ifOperStatusMap, ifNameMap, ifHighSpeedMap] =
      await Promise.all([
        subtreeWalk(session, IF_TABLE_OIDS.ifIndex),
        subtreeWalk(session, IF_TABLE_OIDS.ifDescr),
        subtreeWalk(session, IF_TABLE_OIDS.ifSpeed),
        subtreeWalk(session, IF_TABLE_OIDS.ifAdminStatus),
        subtreeWalk(session, IF_TABLE_OIDS.ifOperStatus),
        subtreeWalk(session, IF_X_TABLE_OIDS.ifName).catch(() => new Map()),
        subtreeWalk(session, IF_X_TABLE_OIDS.ifHighSpeed).catch(() => new Map()),
      ]);

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
  } finally {
    session.close();
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
