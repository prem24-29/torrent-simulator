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

// Do two id lists hold the same ids, in any order?
function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Sentence for a re-choke. entries = [{ label, value }]:
// value is KB received in the window (leecher) or link rate in KB/s (seeder).
function unchokeMessage(label, isSeeder, entries, slots) {
  if (entries.length === 0) {
    return `${label} has no connection that needs anything from it, so none of its ${slots} unchoke slot(s) is used. Slots go only to interested peers.`;
  }
  if (isSeeder) {
    const list = entries.map((e) => `${e.label} (${e.value} KB/s)`).join(', ');
    return `${label} is a seeder, so nobody has sent it anything to reward. It gives its ${slots} unchoke slot(s) to the interested connections with the fastest link: ${list}. Link speed is the lower of its upload and the receiver's download.`;
  }
  const list = entries.map((e) => `${e.label} (${e.value} KB)`).join(', ');
  return `${label} re-assigned its ${slots} unchoke slot(s) by tit-for-tat. It serves the interested connections that sent it the most in the last 10 seconds: ${list}. Peers that sent nothing are tied, and ties are broken randomly.`;
}

// Sentence for transfers dropped in one round. drops = [{ from, to, piece, kb, natBlocked }]
function chokeDropMessage(drops) {
  const lost = drops.reduce((s, d) => s + d.kb, 0);
  const natCount = drops.filter((d) => d.natBlocked).length;
  const examples = drops.slice(0, 3).map((d) => `${d.from} to ${d.to} (piece ${d.piece}, ${d.kb} KB sent)`).join('; ');
  const more = drops.length > 3 ? `, and ${drops.length - 3} more` : '';
  let reason;
  if (natCount === drops.length) {
    reason = "Each of these was between two NAT'd peers whose tunnel ended, and they cannot connect directly.";
  } else {
    reason = 'A sender only serves peers in its unchoke set or its optimistic slot, and these receivers lost that slot.';
    if (natCount > 0) reason += ` (${natCount} were NAT'd pairs whose tunnel ended.)`;
  }
  return `${drops.length} in-flight transfer(s) were dropped, discarding about ${lost} KB of partial progress: ${examples}${more}. ${reason} A piece only counts once it is whole, so the partial progress is thrown away and the piece will be requested again from zero.`;
}

module.exports = { isInterested, filterInterested, pickRandomUnchoked, pickByReciprocity, pickByLinkRate, pickOptimistic, isServing, sameIds, unchokeMessage, chokeDropMessage };
