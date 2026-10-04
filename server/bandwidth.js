const state = require('./state');
const { config } = require('./config');

// slow and fast drift toward medium; medium picks slow or fast once.
function pickNeighborTier(home) {
  if (home === 'medium') return Math.random() < 0.5 ? 'slow' : 'fast';
  return 'medium';
}

// Create a peer's live bandwidth entry the first time we see it.
function ensurePeerState(peer) {
  const id = peer._id.toString();
  if (state.peers[id]) return state.peers[id];

  const rates = config.tiers[peer.tier];
  state.peers[id] = {
    peerLabel: peer.peerLabel,
    fileId: peer.fileId.toString(),
    homeTier: peer.tier,
    neighborTier: pickNeighborTier(peer.tier),
    uploadCap: rates.up,
    downloadCap: rates.down
  };
  return state.peers[id];
}

module.exports = { ensurePeerState };