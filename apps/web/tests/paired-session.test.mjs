import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
// Bundle browser aliases without starting a browser or a WASM runtime.
const built=await build({entryPoints:['src/lib/session/paired-session.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {attachPairedSession}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function terminal() {
 const output=[];let retry;
 return {output, terminal:{write:text=>output.push(text), onData:fn=>{retry=fn;return {dispose(){retry=undefined;}};}}, retry:text=>retry?.(text)};
}
test('opaque session resolves via no-store POST and passes grant to transport only',async()=>{
 const t=terminal();let disposed=false;
 const secret='v1.private_grant';
 const session=attachPairedSession(t,'opaque-session',{
  fetcher:async(url,options)=>{
   assert.equal(url,'/api/sessions/opaque-session/grant');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
   assert.equal(options.credentials,'same-origin');
   return Response.json({address:'tcPrivateAddress',port:2222,grant:secret});
  },
  attach:(_controller,connection,options)=>{
   assert.deepEqual(connection,{address:'tcPrivateAddress',port:2222,token:secret});
   options.onState({state:'connecting'});options.onState({state:'ready'});
   options.onState({state:'disconnected'});
   return {done:Promise.resolve({state:'disconnected'}),dispose(){disposed=true;}};
  }
 });
 await session.done;
 assert.match(t.output.join(''),/Connected/);assert.match(t.output.join(''),/shell state is unknown/);
 assert.doesNotMatch(t.output.join(''),/private_grant|tcPrivateAddress/);
 session.dispose();assert(disposed);
});

test('offline, expired, ended and unauthorized sessions stop loading with useful messages',async()=>{
 for(const [error,text] of [['agent_offline',/offline.*shell state is unknown/s],['session_expired',/expired/],['session_ended',/has ended/],['unauthorized',/Sign in/]]) {
  const t=terminal();let attached=false;
  const session=attachPairedSession(t,'id',{fetcher:async()=>Response.json({error},{status:409}),attach:()=>{attached=true;throw Error('must not attach');}});
  await session.done;assert.equal(attached,false);assert.match(t.output.join(''),text);session.dispose();
 }
});

test('diagnostics redact server/network errors and disposal aborts pending resolution',async()=>{
 const t=terminal();let aborted=false;
 const session=attachPairedSession(t,'id',{fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('secret-address-and-token'));}))});
 session.dispose();await session.done;assert(aborted);assert.doesNotMatch(t.output.join(''),/secret-address-and-token/);
 const other=terminal();const failed=attachPairedSession(other,'id',{fetcher:async()=>{throw Error('token=private');}});
 await failed.done;assert.match(other.output.join(''),/press r/);assert.doesNotMatch(other.output.join(''),/token=private/);failed.dispose();
});
