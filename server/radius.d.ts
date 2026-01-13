declare module 'radius' {
  export interface RadiusPacket {
    code: string;
    secret: string;
    identifier: number;
    attributes: Array<[string, string | number]>;
  }

  export interface DecodedPacket {
    code: string;
    identifier: number;
    attributes: Record<string, unknown>;
    authenticator: Buffer;
  }

  export function encode(packet: RadiusPacket): Buffer;
  export function decode(options: { packet: Buffer; secret: string }): DecodedPacket;
  export function encode_response(options: { packet: DecodedPacket; code: string; secret: string; attributes?: Array<[string, unknown]> }): Buffer;
  export function verify_response(options: { request: Buffer; response: Buffer; secret: string }): boolean;
  export function add_dictionary(path: string): void;
}
