// Hard metadata limits per owner object (pairing limits apply to the shared hub).
// Tombstones count toward quotas: never evict access decisions just to admit work.
export const limits = Object.freeze({
  agents: 128,
  runs: 32,
  sessions: 4096,
  sessionsPerRun: 128,
  browsers: 64,
  grants: 1024,
  grantsPerSession: 16,
  pairingAttempts: 512,
  rateBuckets: 4096,
});
