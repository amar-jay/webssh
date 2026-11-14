import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const source = await build({stdin:{contents:`import { WebSSHState as Base } from './src/index.ts';
export class WebSSHState extends Base { async expire(code) { this.ctx.storage.sql.exec('UPDATE pairing_attempts SET expires_at = 0 WHERE code = ?',code); } }
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
