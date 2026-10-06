// Is `other` interested in `peer`? True if peer holds at least one piece other is missing.
function isInterested(peer, other) {
  for (let i = 0; i < peer.bitfield.length; i++) {
    if (peer.bitfield[i] && !other.bitfield[i]) return true;
  }
  return false;
}

// Of a peer's connections, keep only those interested in it.
function filterInterested(peer, conns) {
  return conns.filter((c) => isInterested(peer, c));
}

// Pick up to `slots` random interested connections. D4-D6 replace this with smarter ranking.
function pickRandomUnchoked(peer, conns, slots, rng = Math.random) {
  return [...filterInterested(peer, conns)]
    .sort(() => rng() - 0.5)
    .slice(0, slots);
}
// Pick up to `slots` interested connections, highest reciprocity score first.
// `scores` is { peerLabel: bytesTheySentMe }. Ties are broken randomly.
function pickByReciprocity(peer, conns, slots, scores, rng = Math.random) {
  return filterInterested(peer, conns)
    .map((c) => ({ c, score: scores[c.peerLabel] || 0, tie: rng() }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, slots)
    .map((x) => x.c);
}

// Pick up to `slots` interested connections, fastest link first (for seeders).
// `caps` is { peerId: { uploadCap, downloadCap } }, i.e. state.peers.
function pickByLinkRate(peer, conns, slots, caps, rng = Math.random) {
  const myUp = (caps[peer._id.toString()] || {}).uploadCap || 0;
  return filterInterested(peer, conns)
    .map((c) => {
      const theirDown = (caps[c._id.toString()] || {}).downloadCap || 0;
      return { c, rate: Math.min(myUp, theirDown), tie: rng() };
    })
    .sort((a, b) => b.rate - a.rate || a.tie - b.tie)
    .slice(0, slots)
    .map((x) => x.c);
}
// One random interested connection that isn't already in `excludeIds`, or null if none.
function pickOptimistic(peer, conns, excludeIds, rng = Math.random) {
  const pool = filterInterested(peer, conns).filter(
    (c) => !excludeIds.includes(c._id.toString())
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}
// Is `senderId` currently serving `receiverId`? True if the receiver holds one of
// the sender's regular unchoke slots, or is the sender's optimistic target.
// `unchoked` is state.unchoked, `optimistic` is state.optimistic.
function isServing(senderId, receiverId, unchoked, optimistic) {
  if ((unchoked[senderId] || []).includes(receiverId)) return true;
  const opt = optimistic[senderId];
  return !!(opt && opt.target === receiverId);
}

module.exports = { isInterested, filterInterested, pickRandomUnchoked, pickByReciprocity, pickByLinkRate, pickOptimistic, isServing };
