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

module.exports = { isInterested, filterInterested, pickRandomUnchoked, pickByReciprocity };
