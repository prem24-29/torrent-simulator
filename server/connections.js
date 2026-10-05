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

module.exports = { getCandidatePeers, scoreCandidate, rankCandidates };
