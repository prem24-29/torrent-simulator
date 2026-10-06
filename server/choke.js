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

module.exports = { isInterested, filterInterested, pickRandomUnchoked };
