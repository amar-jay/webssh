import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { signSession } from '../src/lib/auth/session.ts';
async function moduleAt(path, plugins = []) {
 const result=await build({entryPoints:[resolve(path)],bundle:true,platform:'node',format:'esm',write:false,plugins});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const hook=await moduleAt('src/hooks.server.ts');
const grant=await moduleAt('src/routes/api/sessions/[session_id]/grant/+server.ts');
const approve=await moduleAt('src/routes/api/pairing/approve/+server.ts');
const secret='abcdefghijklmnopqrstuvwxyz012345';
const env={GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test',SESSION_SECRET:secret,PUBLIC_ORIGIN:'https://webssh.example'};

test('pairing page reads Worker bindings when platform is absent', async () => {
 const pair = await moduleAt('src/routes/pair/+page.server.ts', [{
  name: 'worker-bindings', setup(build) {
   build.onResolve({filter: /^cloudflare:workers$/}, () => ({path: 'bindings', namespace: 'test'}));
   build.onLoad({filter: /.*/, namespace: 'test'}, () => ({contents: `
    export const env = { WEBSSH_STATE: {
     idFromName: name => name,
     get: name => ({ previewPairing: async (code, owner) => {
      if (name !== 'pairing' || code !== 'ABCDEFGH' || owner !== '42') throw Error('unexpected request');
      return { machineName: 'production-box' };
     } })
    } };
   `}));
  }
 }]);
 const result = await pair.load({url: new URL('https://webssh.example/pair?code=abcdefgh'), locals: {user: {ownerId: '42'}}});
 assert.equal(result.error, null);
 assert.equal(result.machineName, 'production-box');
 assert.equal(result.code, 'ABCDEFGH');
});

test('hook authenticates against stored owner session and rejects foreign-origin mutations',async()=>{
 const token=await signSession({sid:'session',oid:'42',exp:Math.floor(Date.now()/1000)+60},secret);
 let revoked=false;
 const namespace={idFromName:name=>{assert.equal(name,'owner:42');return name;},get:()=>({getBrowserSession:async()=>revoked?null:{ownerId:'42',expiresAt:Date.now()+60000}})};
 const event={locals:{},url:new URL('https://webssh.example/'),platform:{env:{...env,WEBSSH_STATE:namespace}},request:new Request('https://webssh.example/',{headers:{cookie:`__Host-webssh_session=${token}`}})};
 await hook.handle({event,resolve:async()=>new Response('ok')});assert.equal(event.locals.user.ownerId,'42');
 revoked=true;await hook.handle({event,resolve:async()=>new Response('ok')});assert.equal(event.locals.user,null);
 event.request=new Request('https://webssh.example/api/pairing/approve',{method:'POST',headers:{origin:'https://attacker.example',cookie:`__Host-webssh_session=${token}`}});
 assert.equal((await hook.handle({event,resolve:async()=>{throw Error('must not resolve');}})).status,403);
});

test('grant routing uses authenticated owner and hides foreign sessions',async()=>{
 const namespace={idFromName:name=>{assert.equal(name,'owner:owner2');return name;},get:()=>({getTerminalSession:async(owner,id)=>{assert.equal(owner,'owner2');assert.equal(id,'foreign');return null;}})};
 const event={locals:{user:{ownerId:'owner2',sessionId:'browser'}},params:{session_id:'foreign'},platform:{env:{WEBSSH_STATE:namespace}}};
 assert.equal((await grant.POST(event)).status,404);
 event.locals.user=null;assert.equal((await grant.POST(event)).status,401);
});

test('failed pairing completion revokes orphan registration and aborts claim',async()=>{
 const actions=[];
 const namespace={idFromName:name=>name,get:name=>name==='pairing'?{
  approvePairing:async()=>({attemptId:'attempt',machineName:'box'}),
  completePairing:async()=>{throw Error('simulated failure');},abortPairing:async()=>actions.push('abort')
 }:{registerAgent:async()=>({agentId:'new-agent',agentToken:'test',grantKey:'test'}),revokeAgent:async(owner,id)=>{assert.equal(owner,'owner');assert.equal(id,'new-agent');actions.push('revoke');}}};
 const response=await approve.POST({request:new Request('https://webssh.example/api/pairing/approve',{method:'POST',body:JSON.stringify({code:'ABCDEFGH'})}),locals:{user:{ownerId:'owner'}},platform:{env:{WEBSSH_STATE:namespace}}});
 assert.equal(response.status,400);assert.deepEqual(actions,['revoke','abort']);
 assert.equal((await response.json()).error,'request_failed');
});
