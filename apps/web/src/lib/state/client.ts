import type { StateAPI } from '@webssh/state/types';

type StateNamespace = { idFromName(name:string): unknown; get(id:unknown): StateAPI };

export function ownerStub(ns: StateNamespace, ownerId: string) {
  return ns.get(ns.idFromName(`owner:${ownerId}`));
}

export function pairingStub(ns: StateNamespace) {
  return ns.get(ns.idFromName('pairing'));
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function jsonError(error: string, status = 400): Response {
  const safe = /^[a-z_]{1,64}$/.test(error) ? error : 'request_failed';
  return Response.json({ error: safe }, { status, headers: { 'cache-control': 'no-store' } });
}

export function noStore(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

/** Bound the actual stream, not just the client-controlled Content-Length. */
export async function readJSON(request: Request): Promise<unknown> {
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');
 const chunks:Uint8Array[]=[];let size=0;
 try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('request_too_large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
