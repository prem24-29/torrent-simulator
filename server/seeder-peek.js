// Usage (server running, nothing else running): node seeder-peek.js <fileId>
// Rebuilds the Scenario 4 swarm, then every 5s prints which peers seed1 unchokes.
const BASE = 'http://localhost:5000';
const fid = process.argv[2];
if (!fid) { console.log('Usage: node seeder-peek.js <fileId>'); process.exit(1); }

const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await post('/api/simulate/pause');
  await post('/api/dev/scenario', {
    fileId: fid,
    groups: [
      { label: 'seed1', role: 'seeder', tier: 'fast' },
      { label: 'leech_slow', role: 'leecher', tier: 'slow', count: 4 },
      { label: 'leech_med', role: 'leecher', tier: 'medium', count: 3 },
      { label: 'leech_fast', role: 'leecher', tier: 'fast', count: 3 }
    ]
  });
  await post('/api/simulate/resume');

  let slowPicks = 0, totalPicks = 0;
  for (let i = 1; i <= 12; i++) {
    await sleep(5000);
    const d = await get('/api/live/' + fid);
    const seed = d.peers.find((p) => p.label === 'seed1');
    if (!seed) break;
    const names = seed.unchoked.map((u) => u.label);
    const opt = seed.optimistic ? seed.optimistic.label : 'none';
    const slow = names.filter((n) => n.startsWith('leech_slow')).length;
    slowPicks += slow; totalPicks += names.length;
    console.log(`t=${i * 5}s  done ${d.summary.completionPercent}%  unchoked: ${names.join(', ') || '(empty)'}  | optimistic: ${opt}  | slow in regular slots: ${slow}/${names.length}`);
    if (d.peers.every((p) => p.piecesHave === d.file.pieceCount)) break;
  }
  const pct = totalPicks ? Math.round((slowPicks / totalPicks) * 100) : 0;
  console.log(`\nSlow leechers took ${pct}% of the seeder's regular slots (random would be about 40%).`);
  console.log(pct <= 25 ? 'PASS: ranking avoids slow receivers.' : 'CHECK: send me these lines.');
})();