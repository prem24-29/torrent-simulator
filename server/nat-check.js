// Usage (server running): node nat-check.js <fileId>   (use the mid-size file)
// Runs three NAT/relay experiments and prints a report.
const BASE = 'http://localhost:5000';
const fid = process.argv[2];
if (!fid) { console.log('Usage: node nat-check.js <fileId>'); process.exit(1); }

const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const get = (p) => fetch(BASE + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Checks that must hold in every snapshot. Returns a list of broken rule names.
function invariants(d) {
  const broken = [];
  const byId = {}, byLabel = {};
  d.peers.forEach((p) => { byId[p.id] = p; byLabel[p.label] = p; });
  for (const p of d.peers) {
    for (const c of p.connections) {
      const o = byId[c.id];
      if (!o) continue;
      if (p.behindNAT && o.behindNAT && !c.viaRelay) broken.push('NAT-NAT link without relay');
      if (c.viaRelay) {
        const r = byLabel[c.viaRelay];
        if (!r || r.behindNAT) broken.push('relay missing or not public');
        else if (!r.connections.some((x) => x.id === p.id) || !r.connections.some((x) => x.id === c.id)) broken.push('relay not connected to both ends');
      }
    }
  }
  for (const t of d.transfers) {
    if (byId[t.fromId] && byId[t.toId] && byId[t.fromId].behindNAT && byId[t.toId].behindNAT && !t.relayLabel) broken.push('NAT-NAT transfer without relay');
  }
  return broken;
}

async function relayRun(relayTier) {
  await post('/api/simulate/pause');
  await post('/api/dev/scenario', {
    fileId: fid,
    groups: [
      { label: 'nat_seed', role: 'seeder', tier: 'fast', behindNAT: true },
      { label: 'nat_leech', role: 'leecher', tier: 'fast', behindNAT: true }
    ]
  });
  // relay_pub starts with half the pieces so BOTH NATd peers can connect to it
  const live = await get('/api/live/' + fid);
  const n = live.file.pieceCount;
  const bitfield = Array.from({ length: n }, (_, i) => i < Math.floor(n / 2));
  const ann = await post('/api/tracker/announce', { fileId: fid, peerLabel: 'relay_pub', tier: relayTier, behindNAT: false, bitfield });
  if (!ann.peer) { console.log('Announce failed:', ann); process.exit(1); }

  await post('/api/simulate/resume');
  const start = Date.now();
  const broken = new Set();
  let sawTunnel = false, sawTunnelTransfer = false, finishedAt = null;

  while (Date.now() - start < 240000) {
    await sleep(2000);
    const d = await get('/api/live/' + fid);
    invariants(d).forEach((b) => broken.add(b));
    if (d.tunnels.some((t) => t.relayLabel === 'relay_pub')) sawTunnel = true;
    if (d.transfers.some((t) => t.relayLabel === 'relay_pub')) sawTunnelTransfer = true;
    const leech = d.peers.find((p) => p.label === 'nat_leech');
    if (leech && leech.piecesHave === d.file.pieceCount) { finishedAt = Math.round((Date.now() - start) / 1000); break; }
  }
  return { relayTier, finishedAt, sawTunnel, sawTunnelTransfer, broken: [...broken] };
}

async function noRelayRun() {
  await post('/api/simulate/pause');
  await post('/api/dev/scenario', {
    fileId: fid,
    groups: [
      { label: 'nat_seed', role: 'seeder', tier: 'fast', behindNAT: true },
      { label: 'nat_leech', role: 'leecher', tier: 'fast', behindNAT: true, count: 3 }
    ]
  });
  await post('/api/simulate/resume');
  await sleep(20000);
  const d = await get('/api/live/' + fid);
  const leechers = d.peers.filter((p) => p.label.startsWith('nat_leech'));
  return {
    noConnections: d.peers.every((p) => p.connections.length === 0),
    noTransfers: d.transfers.length === 0,
    noProgress: leechers.every((p) => p.piecesHave === 0),
    noTunnels: d.tunnels.length === 0,
    broken: invariants(d)
  };
}

(async () => {
  console.log('Run 1/3: slow relay...');
  const slow = await relayRun('slow');
  console.log('Run 2/3: fast relay...');
  const fast = await relayRun('fast');
  console.log('Run 3/3: NAT-only swarm (no relay possible), takes 20s...');
  const none = await noRelayRun();

  const yn = (b) => (b ? 'PASS' : 'FAIL');
  console.log('\n===== SCENARIO 5 REPORT =====');
  for (const r of [slow, fast]) {
    console.log(`Relay ${r.relayTier}: nat_leech finished in ${r.finishedAt === null ? 'TIMEOUT' : r.finishedAt + 's'}`);
    console.log(`  tunnel formed: ${yn(r.sawTunnel)}   data went through relay: ${yn(r.sawTunnelTransfer)}   invariants: ${r.broken.length ? 'FAIL ' + JSON.stringify(r.broken) : 'PASS'}`);
  }
  if (slow.finishedAt !== null && fast.finishedAt !== null) {
    console.log(`Fast relay beats slow relay: ${yn(fast.finishedAt < slow.finishedAt)} (${fast.finishedAt}s vs ${slow.finishedAt}s)`);
  }
  console.log(`No relay available: no links ${yn(none.noConnections)}, no transfers ${yn(none.noTransfers)}, no progress ${yn(none.noProgress)}, no tunnels ${yn(none.noTunnels)}, invariants ${none.broken.length ? 'FAIL ' + JSON.stringify(none.broken) : 'PASS'}`);
})();