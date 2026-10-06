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

module.exports = { isInterested, filterInterested };