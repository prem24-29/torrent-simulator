// Who could this peer connect to? For now: everyone else in the swarm.
// Flooding (parked) will later replace this with a limited, discovered list.
function getCandidatePeers(peer, allPeers) {
  const myId = peer._id.toString();
  return allPeers.filter((other) => other._id.toString() !== myId);
}

// How many pieces does `candidate` have that `peer` is missing?
function scoreCandidate(peer, candidate) {
  let score = 0;
  for (let i = 0; i < peer.bitfield.length; i++) {
    if (!peer.bitfield[i] && candidate.bitfield[i]) score++;
  }
  return score;
}

// Best `limit` useful candidates for `peer`; ties broken randomly.
function rankCandidates(peer, candidates, limit, rng = Math.random) {
  return candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(peer, c), tie: rng() }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, limit)
    .map((x) => x.candidate);
}


// Two NAT'd peers can't connect directly. Anything else can.
function canConnectDirectly(a, b) {
  return !(a.behindNAT && b.behindNAT);
}


// Build symmetric connection lists. A link forms only if BOTH peers have a free slot.
// Returns { peerId: [connectedPeerIds] } and does not touch shared state itself.
function formConnections(peers, limit, rng = Math.random) {
  const conns = {};
  for (const p of peers) conns[p._id.toString()] = [];

  // Shuffle so no peer gets first pick every time
  const order = [...peers].sort(() => rng() - 0.5);

  for (const peer of order) {
    const myId = peer._id.toString();
    const ranked = rankCandidates(peer, getCandidatePeers(peer, peers), peers.length, rng);

    for (const other of ranked) {
      if (conns[myId].length >= limit) break;
      const otherId = other._id.toString();
      if (!canConnectDirectly(peer, other)) continue;
      if (conns[myId].includes(otherId)) continue;
      if (conns[otherId].length >= limit) continue;

      conns[myId].push(otherId);
      conns[otherId].push(myId);
    }
  }
  return conns;
}

// Re-pick one peer's connections in place. Same hard cap on both sides.
function reshufflePeer(peer, peers, conns, limit, rng = Math.random) {
  const myId = peer._id.toString();

  // Drop my old links in both directions
  for (const otherId of conns[myId] || []) {
    if (conns[otherId]) conns[otherId] = conns[otherId].filter((id) => id !== myId);
  }
  conns[myId] = [];

  const ranked = rankCandidates(peer, getCandidatePeers(peer, peers), peers.length, rng);
  for (const other of ranked) {
    if (conns[myId].length >= limit) break;
    const otherId = other._id.toString();
    if (!canConnectDirectly(peer, other)) continue;
    if (!conns[otherId]) conns[otherId] = [];
    if (conns[otherId].length >= limit) continue;
    conns[myId].push(otherId);
    conns[otherId].push(myId);
  }
}
// Find a relay for peers a and b: a public peer that BOTH are already connected to.
// `conns` is state.connections, `peersById` maps id -> peer (needs behindNAT).
// Returns the relay's id, or null if there is none.
function findRelay(aId, bId, conns, peersById, rng = Math.random) {
  const bList = conns[bId] || [];
  const mutual = (conns[aId] || []).filter(
    (id) => bList.includes(id) && peersById[id] && !peersById[id].behindNAT
  );
  if (mutual.length === 0) return null;
  return mutual[Math.floor(rng() * mutual.length)];
}
// Stable key for a pair of peers, whichever order they come in.
function tunnelKey(aId, bId) {
  return [aId, bId].sort().join('|');
}

// Remove tunnels that no longer hold: an end dropped the link, or the relay
// is no longer connected to both ends. Also removes the leftover link entries.
function pruneTunnels(conns, tunnels) {
  for (const key of Object.keys(tunnels)) {
    const [a, b] = key.split('|');
    const r = tunnels[key];
    const A = conns[a] || [];
    const B = conns[b] || [];
    const ok = A.includes(b) && B.includes(a) && A.includes(r) && B.includes(r);
    if (ok) continue;
    delete tunnels[key];
    if (conns[a]) conns[a] = conns[a].filter((id) => id !== b);
    if (conns[b]) conns[b] = conns[b].filter((id) => id !== a);
  }
}

// Fill free slots of NATd peers with relayed links to other NATd peers.
// Both ends need a free slot, and a public peer must be connected to both.
function formTunnels(peers, conns, tunnels, limit, rng = Math.random) {
  const peersById = {};
  for (const p of peers) {
    const id = p._id.toString();
    peersById[id] = p;
    if (!conns[id]) conns[id] = [];
  }
  const natPeers = peers.filter((p) => p.behindNAT);

  for (const peer of [...natPeers].sort(() => rng() - 0.5)) {
    const myId = peer._id.toString();
    if (conns[myId].length >= limit) continue;

    const ranked = rankCandidates(peer, getCandidatePeers(peer, natPeers), natPeers.length, rng);
    for (const other of ranked) {
      if (conns[myId].length >= limit) break;
      const otherId = other._id.toString();
      if (conns[myId].includes(otherId)) continue;
      if (conns[otherId].length >= limit) continue;

      const relay = findRelay(myId, otherId, conns, peersById, rng);
      if (!relay) continue;

      conns[myId].push(otherId);
      conns[otherId].push(myId);
      tunnels[tunnelKey(myId, otherId)] = relay;
    }
  }
}
// Compare two tunnel maps ({ "idA|idB": relayId }). Returns what appeared and what vanished.
function diffTunnels(before, after) {
  const formed = [];
  const broken = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) formed.push([key, after[key]]);
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) broken.push([key, before[key]]);
  }
  return { formed, broken };
}

module.exports = {
  getCandidatePeers,
  scoreCandidate,
  rankCandidates,
  formConnections,
  reshufflePeer,
  canConnectDirectly,
  findRelay,
  tunnelKey,
  pruneTunnels,
  formTunnels,
  diffTunnels
};