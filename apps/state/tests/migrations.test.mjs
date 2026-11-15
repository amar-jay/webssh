import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
const source = await build({
  stdin: {
    contents: `import {DurableObject} from 'cloudflare:workers';
import {applyMigrations,migrations} from './src/schema.ts';
export class MigrationTest extends DurableObject {
 seedV4(){
 const sql=this.ctx.storage.sql;
 sql.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
 for(const m of migrations.filter(m=>m.id<=4)){sql.exec(m.sql);sql.exec('INSERT INTO schema_migrations VALUES (?,?)',m.id,1);}
 sql.exec("INSERT INTO owners VALUES ('owner','alice',1)");
 sql.exec("INSERT INTO agents(agent_id,owner_id,machine_name,token_hash,grant_key,created_at) VALUES ('agent','owner','machine','hash','key',1)");
 sql.exec("INSERT INTO terminal_sessions(terminal_session_id,owner_id,agent_id,status,created_at,ended_at) VALUES ('session','owner','agent','ended',1,2)");
 }
 upgrade(){applyMigrations(this.ctx.storage.sql,fn=>this.ctx.storage.transactionSync(fn));}
 inspect(){const sql=this.ctx.storage.sql;return {owner:[...sql.exec('SELECT * FROM owners')],session:[...sql.exec('SELECT * FROM terminal_sessions')],versions:[...sql.exec('SELECT id FROM schema_migrations ORDER BY id')]};}
 failMigration(){
 migrations.push({id:6,sql:'CREATE TABLE partial_change (id INTEGER); INVALID SQL;'});
 try{applyMigrations(this.ctx.storage.sql,fn=>this.ctx.storage.transactionSync(fn));}finally{migrations.pop();}
 }
 partialExists(){return [...this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='partial_change'")].length;}
}
export default {fetch(){return new Response('test')}};`,
    resolveDir: process.cwd(),
    sourcefile: "migration-worker.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  write: false,
});
test("real SQLite upgrade preserves existing ownership/ended state; repeat and failed migrations are atomic", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "MigrationTest", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE"),
      stub = ns.get(ns.idFromName("upgrade"));
    await stub.seedV4();
    await stub.upgrade();
    await stub.upgrade();
    const state = await stub.inspect();
    assert.equal(state.owner[0].owner_id, "owner");
    assert.equal(state.owner[0].github_login, "alice");
    assert.equal(state.session[0].status, "ended");
    assert.equal(state.session[0].ended_at, 2);
    assert.equal(state.session[0].termination_requested, 0);
    assert.deepEqual(
      state.versions.map((v) => v.id),
      [1, 2, 3, 4, 5],
    );
    await assert.rejects(stub.failMigration());
    assert.equal(await stub.partialExists(), 0);
    assert.deepEqual((await stub.inspect()).versions, state.versions);
  } finally {
    await mf.dispose();
  }
});
