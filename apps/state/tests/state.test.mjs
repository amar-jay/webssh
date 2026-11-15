import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const source = await build({stdin:{contents:`import { WebSSHState as Base } from './src/index.ts';
export class WebSSHState extends Base { async testCall(method,args) { try { return {ok:true,value:await this[method](...args)}; } catch(e) { return {ok:false,error:e.message}; } } async ageRun(id,age) { this.ctx.storage.sql.exec('UPDATE agent_runs SET last_seen_at = ? WHERE run_id = ?',Date.now()-age,id); } async expire(code) { this.ctx.storage.sql.exec('UPDATE pairing_attempts SET expires_at = 0 WHERE code = ?',code); } }
export default { fetch(){ return new Response('test'); } };`,resolveDir:process.cwd(),sourcefile:'test-worker.ts'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
test('SQLite DO: owner isolation, pairing races/expiry, single-use grants and revocation', async () => {
 const mf=new Miniflare({modules:true,script:source.outputFiles[0].text,compatibilityDate:'2026-08-06',durableObjects:{STATE:{className:'WebSSHState',useSQLite:true}}});
 try {
  const ns=await mf.getDurableObjectNamespace('STATE');
  const owner=ns.get(ns.idFromName('owner:1')), other=ns.get(ns.idFromName('owner:2')), hub=ns.get(ns.idFromName('pairing'));
  await owner.ensureOwner('1','alice');const browser=await owner.createBrowserSession('1');
  const attempt=await hub.startPairing('machine','127.0.0.1');
  assert.equal((await hub.previewPairing(attempt.code,'1')).machineName,'machine');
  const claim=await hub.approvePairing(attempt.code,'1');await assert.rejects(hub.approvePairing(attempt.code,'2'));
  const agent={...await owner.registerAgent('1','machine')};
  await hub.completePairing(claim.attemptId,'1',{...agent,machineName:'machine'});
  const polls=await Promise.all([hub.pollPairing(attempt.code,attempt.cliSecret),hub.pollPairing(attempt.code,attempt.cliSecret)]);
  assert.equal(polls.filter(p=>p.status==='completed').length,1);
  const expired=await hub.startPairing('late','127.0.0.1');const claimed=await hub.approvePairing(expired.code,'1');
  await hub.completePairing(claimed.attemptId,'1',{...agent,machineName:'late'});await hub.expire(expired.code);
  assert.equal((await hub.pollPairing(expired.code,expired.cliSecret)).status,'expired');
  const oldToken=agent.agentToken;
  const replacementToken='R'.repeat(43);
  const rotationId='O'.repeat(43);
  await owner.agentCredential('1',agent.agentId,oldToken,'renew',replacementToken,rotationId);
  agent.agentToken=replacementToken;
  await assert.rejects(owner.agentSession('1',agent.agentId,oldToken));
  const run=await owner.agentSession('1',agent.agentId,agent.agentToken);
  assert.equal(await other.getTerminalSession('2',run.sessionId),null);
  await assert.rejects(other.agentSession('2',agent.agentId,agent.agentToken));
  await assert.rejects(owner.mintGrant('2',run.sessionId,browser.sessionId));
  const grant=await owner.mintGrant('1',run.sessionId,browser.sessionId);const nonce=grant.grant.split('.')[3];
  await owner.agentSession('1',agent.agentId,agent.agentToken,run.sessionId,nonce);
  await assert.rejects(owner.agentSession('1',agent.agentId,agent.agentToken,run.sessionId,nonce));
  await owner.revokeBrowserSession(browser.sessionId);
  await assert.rejects(owner.mintGrant('1',run.sessionId,browser.sessionId));
  await assert.rejects(owner.agentSession('1',agent.agentId,agent.agentToken,run.sessionId,'check:'+nonce));
  await owner.revokeAgent('1',agent.agentId);
  await assert.rejects(owner.agentSession('1',agent.agentId,agent.agentToken));
 } finally {await mf.dispose();}
});

async function rpcReject(stub,method,args,error) {
 const result=await stub.testCall(method,args);
 assert.equal(result.ok,false,method+' should reject');
 if(error) assert.match(result.error,error);
}

test('agent runs: authenticated announcement, owner-only resolution, lifecycle and lost-heartbeat semantics', async () => {
 const mf=new Miniflare({modules:true,script:source.outputFiles[0].text,compatibilityDate:'2026-08-06',durableObjects:{STATE:{className:'WebSSHState',useSQLite:true}}});
 try {
  const ns=await mf.getDurableObjectNamespace('STATE');
  const owner=ns.get(ns.idFromName('owner:alice')),other=ns.get(ns.idFromName('owner:bob'));
  const agent=await owner.registerAgent('alice','box');
  const browser=await owner.createBrowserSession('alice');
  const runId='run_1234567890123456';
  const update=(operation,fields={})=>owner.agentRun('alice',agent.agentId,agent.agentToken,{operation,runId,...fields});
  await assert.rejects(owner.agentRun('alice',agent.agentId,'wrong',{operation:'start',runId,machineName:'box',workspaceLabel:'project'}));
  await update('start',{machineName:'configured-name',workspaceLabel:'project'});
  await update('start',{machineName:'configured-name',workspaceLabel:'project'});
  assert.equal((await owner.listTerminalSessions('alice')).length,1);
  await rpcReject(owner,'resolveSession',['alice',runId,browser.sessionId],/agent_offline/);
  await update('announce',{address:'tcTestAddress123456789',port:2222});
  const publicData=JSON.stringify({runs:await owner.listRuns('alice'),sessions:await owner.listTerminalSessions('alice'),agents:await owner.listAgents('alice')});
  for (const secret of [agent.agentToken,agent.grantKey,'tcTestAddress123456789']) assert.ok(!publicData.includes(secret));
  assert.equal((await owner.listRuns('alice'))[0].machineName,'configured-name');
  assert.equal((await owner.getTerminalSession('alice',runId)).status,'connecting');
  await rpcReject(other,'resolveSession',['bob',runId,browser.sessionId],/not_found/);
  await assert.rejects(other.startRunSession('bob',runId));
  assert.equal(await other.endTerminalSession('bob',runId),false);
  const connection=await owner.resolveSession('alice',runId,browser.sessionId);
  assert.equal(connection.address,'tcTestAddress123456789');assert.equal(connection.port,2222);
  const nonce=connection.grant.split('.')[3];
  await assert.rejects(owner.agentSession('alice',agent.agentId,agent.agentToken,runId,nonce,'different_run'));
  await owner.agentSession('alice',agent.agentId,agent.agentToken,runId,nonce,runId);
  assert.equal((await owner.getTerminalSession('alice',runId)).status,'active');
  await rpcReject(owner,'resolveSession',['alice',runId,browser.sessionId],/session_busy/);
  await owner.ageRun(runId,40_000);
  const offline=await owner.getTerminalSession('alice',runId);
  assert.equal(offline.status,'offline');assert.equal(offline.endedAt,null);
  assert.equal((await owner.listRuns('alice'))[0].status,'offline');
  await rpcReject(owner,'resolveSession',['alice',runId,browser.sessionId],/agent_offline/);
  await update('heartbeat');
  await owner.agentSession('alice',agent.agentId,agent.agentToken,runId,'release:'+nonce,runId);
  assert.equal((await owner.getTerminalSession('alice',runId)).status,'ended');
  await rpcReject(owner,'resolveSession',['alice',runId,browser.sessionId],/session_ended/);
  const starts=await Promise.all([owner.startRunSession('alice',runId),owner.startRunSession('alice',runId)]);
  assert.equal(starts[0].terminalSessionId,starts[1].terminalSessionId);
  assert.notEqual(starts[0].terminalSessionId,runId);
  const next=starts[0].terminalSessionId;
  const nextGrant=await owner.resolveSession('alice',next,browser.sessionId);
  const nextNonce=nextGrant.grant.split('.')[3];
  await owner.agentSession('alice',agent.agentId,agent.agentToken,next,nextNonce,runId);
  await owner.endTerminalSession('alice',next);
  await assert.rejects(owner.agentSession('alice',agent.agentId,agent.agentToken,next,'check:'+nextNonce,runId));
  const expired=await owner.startRunSession('alice',runId);
  await owner.ageRun(runId,86_400_001);
  const expiredRow=await owner.getTerminalSession('alice',expired.terminalSessionId);
  assert.equal(expiredRow.status,'expired');assert.equal(expiredRow.endedAt,null);
  await assert.rejects(update('heartbeat'));
  await rpcReject(owner,'resolveSession',['alice',expired.terminalSessionId,browser.sessionId],/session_expired/);
  const failedRun='failed_1234567890123456';
  await owner.agentRun('alice',agent.agentId,agent.agentToken,{operation:'start',runId:failedRun,machineName:'box',workspaceLabel:'project'});
  await owner.agentRun('alice',agent.agentId,agent.agentToken,{operation:'end',runId:failedRun});
  assert.equal((await owner.getTerminalSession('alice',failedRun)).status,'ended');
 } finally {await mf.dispose();}
});
