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
    downloadCap: rates.down,
    uploadCap: rates.up,
    downloadCap: rates.down,
    position: 0,
    carryBytes: 0,
    waitingForPiece: null,
        nextReshuffleAt: Date.now() + config.reshuffleIntervalMs * (0.8 + Math.random() * 0.4),
    nextChokeAt: 0
  };
  return state.peers[id];
}

const DRIFT_STEP = 0.1; // 10% of the gap between home and neighbor tier, per step

// Move one peer's capacity a small random step inside its band.
function driftPeer(p) {
  const direction = Math.random() < 0.5 ? -1 : 1;
  p.position = Math.min(1, Math.max(0, p.position + direction * DRIFT_STEP));

  const home = config.tiers[p.homeTier];
  const neighbor = config.tiers[p.neighborTier];
  p.uploadCap = home.up + (neighbor.up - home.up) * p.position;
  p.downloadCap = home.down + (neighbor.down - home.down) * p.position;
}

function driftAll() {
  for (const id of Object.keys(state.peers)) driftPeer(state.peers[id]);
}

// Link rate (KB/s) = the slowest share along the path.
// Each point is { cap, pool }: a capacity and how many transfers share it.
function linkRate(points) {
  return Math.min(...points.map((p) => p.cap / p.pool));
}

module.exports = { ensurePeerState, driftAll, linkRate };