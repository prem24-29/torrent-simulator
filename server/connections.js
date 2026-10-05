// Who could this peer connect to? For now: everyone else in the swarm.
// Flooding (parked) will later replace this with a limited, discovered list.
function getCandidatePeers(peer, allPeers) {
  const myId = peer._id.toString();
  return allPeers.filter((other) => other._id.toString() !== myId);
}

module.exports = { getCandidatePeers };