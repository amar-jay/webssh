/** Monotonic SQL migrations for WebSSHState. Never edit an applied migration's SQL. */

export const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owners (
        owner_id TEXT PRIMARY KEY NOT NULL,
        github_login TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS browser_sessions_owner ON browser_sessions(owner_id);

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        machine_name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        grant_key TEXT NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS agents_owner ON agents(owner_id);

      CREATE TABLE IF NOT EXISTS terminal_sessions (
        terminal_session_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        workspace_label TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS terminal_sessions_owner ON terminal_sessions(owner_id);

      CREATE TABLE IF NOT EXISTS grant_nonces (
        nonce TEXT PRIMARY KEY NOT NULL,
        terminal_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        exp_unix INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pairing_attempts (
        attempt_id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL UNIQUE,
        code_hash TEXT NOT NULL,
        cli_secret_hash TEXT NOT NULL,
        machine_name TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_id TEXT,
        agent_id TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS pairing_attempts_code ON pairing_attempts(code);

      CREATE TABLE IF NOT EXISTS pairing_rate (
        bucket TEXT PRIMARY KEY NOT NULL,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      );
    `
  }
, { id: 2, sql: `ALTER TABLE grant_nonces ADD COLUMN browser_session_id TEXT;
ALTER TABLE grant_nonces ADD COLUMN consumed_at INTEGER;
ALTER TABLE terminal_sessions ADD COLUMN browser_session_id TEXT;
ALTER TABLE agents ADD COLUMN token_expires_at INTEGER;` }
, { id: 3, sql: `ALTER TABLE terminal_sessions ADD COLUMN active_nonce TEXT;
ALTER TABLE terminal_sessions ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE terminal_sessions ADD COLUMN last_seen_at INTEGER;
ALTER TABLE agents ADD COLUMN rotation_id TEXT;
ALTER TABLE agents ADD COLUMN previous_token_hash TEXT;` }
, { id: 4, sql: `CREATE TABLE agent_runs (
 run_id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 machine_name TEXT NOT NULL,
 workspace_label TEXT NOT NULL,
 address TEXT,
 port INTEGER,
 derp_map_url TEXT,
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL,
 ended_at INTEGER
);
CREATE INDEX agent_runs_owner ON agent_runs(owner_id);
ALTER TABLE terminal_sessions ADD COLUMN run_id TEXT;
CREATE INDEX terminal_sessions_run ON terminal_sessions(run_id);` }
];

export function applyMigrations(
  sql: SqlStorage,
  transactionSync: (closure: () => void) => void
): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    [...sql.exec('SELECT id FROM schema_migrations')].map((row) => Number(row.id))
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    transactionSync(() => {
      sql.exec(migration.sql);
      sql.exec(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
        migration.id,
        Date.now()
      );
    });
  }
}
