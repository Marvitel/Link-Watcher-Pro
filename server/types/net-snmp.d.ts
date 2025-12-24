declare module "net-snmp" {
  interface SessionOptions {
    port?: number;
    timeout?: number;
    retries?: number;
  }

  interface Varbind {
    oid: string;
    type: number;
    value: Buffer | number | string;
  }

  interface Session {
    subtree(
      oid: string,
      feedCb: (varbinds: Varbind[]) => void,
      doneCb: (error?: Error) => void
    ): void;
    close(): void;
  }

  interface User {
    name: string;
    level: number;
    authProtocol: number;
    authKey: string;
    privProtocol: number;
    privKey: string;
  }

  const SecurityLevel: {
    noAuthNoPriv: number;
    authNoPriv: number;
    authPriv: number;
  };

  const AuthProtocols: {
    none: number;
    md5: number;
    sha: number;
  };

  const PrivProtocols: {
    none: number;
    des: number;
    aes: number;
  };

  function createSession(
    target: string,
    community: string,
    options?: SessionOptions
  ): Session;

  function createV3Session(
    target: string,
    user: User,
    options?: SessionOptions
  ): Session;
}
