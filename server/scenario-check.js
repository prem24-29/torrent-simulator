// Usage (server must be running): node scenario-check.js <fileId>
// Wipes that file's peers, builds the Scenario 4 swarm, watches it, prints a report.
const BASE = 'http://localhost:5000';
const fid = process.argv[2];
if (!fid) { console.log('Usage: node scenario-check.js <fileId>'); process.exit(1); }

const post = (path, body) =>
  fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const get = (path) => fetch(BASE + path).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

(async () => {
  await post('/api/simulate/pause');
  const made = await post('/api/dev/scenario', {
    fileId: fid,
    groups: [
      { label: 'seed1', role: 'seeder', tier: 'fast' },
      { label: 'leech_slow', role: 'leecher', tier: 'slow', count: 4 },
      { label: 'leech_med', role: 'leecher', tier: 'medium', count: 3 },
      { label: 'leech_fast', role: 'leecher', tier: 'fast', count: 3 }
    ]
  });
  if (!made.created) { console.log('Scenario failed:', made); process.exit(1); }
  await post('/api/simulate/resume');

  const start = Date.now();
  const fails = {};
  const fail = (name) => { fails[name] = (fails[name] || 0) + 1; };
  const seederChecks = [];
  const optTargets = {};
  let last = null, snaps = 0;

  while (Date.now() - start < 300000) {
    const d = await get('/api/live/' + fid);
    last = d; snaps++;
    const L = d.config.connectionLimit, S = d.config.unchokeSlots;
    const byId = {};
    d.peers.forEach((p) => (byId[p.id] = p));

    for (const p of d.peers) {
      if (p.connections.length > L) fail('connections over limit');
      if (!p.connections.every((c) => byId[c.id] && byId[c.id].connections.some((x) => x.id === p.id))) fail('connections not symmetric');
      if (p.unchoked.length > S) fail('unchoked over slots');
      if (!p.unchoked.every((u) => p.connections.some((c) => c.id === u.id))) fail('unchoked not subset of connections');
      if (p.optimistic && !p.connections.some((c) => c.id === p.optimistic.id)) fail('optimistic not a connection');
      if (p.activeDownloads > d.config.maxConcurrentDownloads) fail('too many downloads');
      if (p.optimistic) (optTargets[p.label] = optTargets[p.label] || new Set()).add(p.optimistic.label);
    }
    const keys = d.transfers.map((t) => t.toId + '|' + t.pieceIndex);
    if (new Set(keys).size !== keys.length) fail('duplicate in-flight piece');
    if (JSON.stringify(d).includes('NaN')) fail('NaN in response');

    // Check 1: seeder's unchoked peers should have above-average download capacity
    const seed = d.peers.find((p) => p.label === 'seed1');
    const leechers = d.peers.filter((p) => p.label.startsWith('leech'));
    if (seed && seed.unchoked.length > 0 && seed.unchoked.length < leechers.length) {
      const picked = seed.unchoked.map((u) => byId[u.id].downloadCap);
      seederChecks.push(avg(picked) >= avg(leechers.map((p) => p.downloadCap)));
    }

      if (d.peers.every((p) => p.piecesHave === d.file.pieceCount)) break;
    await sleep(3000);
  }

  const secs = Math.round((Date.now() - start) / 1000);
  const done = last && last.peers.every((p) => p.piecesHave === last.file.pieceCount);
  const optCounts = Object.values(optTargets).map((s) => s.size);

  console.log('\n===== SCENARIO 4 REPORT =====');
  console.log(`Run time: ${secs}s, snapshots: ${snaps}`);
  console.log(`Completed: ${done ? 'PASS' : 'FAIL (timed out or incomplete)'}`);
  const hard = Object.entries(fails).filter(([k, v]) => !(k === 'optimistic not a connection' && v <= 2));
  console.log(`Invariants: ${hard.length === 0 ? 'PASS' : 'FAIL ' + JSON.stringify(Object.fromEntries(hard))}`);
  const good = seederChecks.filter(Boolean).length;
  console.log(`Seeder favours high-download peers: ${good}/${seederChecks.length} snapshots ` +
    (seederChecks.length && good / seederChecks.length >= 0.7 ? '(PASS)' : '(CHECK)'));
  console.log(`Optimistic targets: avg ${avg(optCounts).toFixed(1)} distinct per peer ` +
    (secs < 35 ? '(run too short to judge)' : avg(optCounts) > 1 ? '(PASS: rotating)' : '(FAIL: never rotated)'));
  console.log('Watch the server terminal for "choked: dropped N" lines (N should be small).');
})();