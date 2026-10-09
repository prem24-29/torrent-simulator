// Assemble everything the dashboard needs for one file.
// Pure: takes plain data in, returns a plain object. Reads, never writes.
function buildLiveState(file, peers, state, config, unchokeSlots, running) {
  const fid = file._id.toString();
  const label = {};
  for (const p of peers) label[p._id.toString()] = p.peerLabel;

  const pairKey = (a, b) => [a, b].sort().join('|');
  const relayLabelFor = (a, b) => {
    const r = state.tunnels[pairKey(a, b)];
    return r ? label[r] || null : null;
  };

  // In-flight transfers for this file
  const myTransfers = state.transfers.filter((t) => t.fileId === fid);
  const incoming = {};
  for (const t of myTransfers) incoming[t.toId] = (incoming[t.toId] || 0) + 1;

  const transfers = myTransfers.map((t) => ({
    fromId: t.fromId,
    toId: t.toId,
    fromLabel: label[t.fromId] || null,
    toLabel: label[t.toId] || null,
    pieceIndex: t.pieceIndex,
    progress: Math.min(1, t.bytesDone / file.pieceSize),
    relayLabel: relayLabelFor(t.fromId, t.toId)
  }));

  const round = (n) => Math.round(n * 10) / 10;

  const peerList = peers.map((p) => {
    const id = p._id.toString();
    const live = state.peers[id] || null;
    const have = p.bitfield.filter(Boolean).length;
    const status = have === file.pieceCount ? 'seeding' : have > 0 || incoming[id] ? 'downloading' : 'idle';
    const opt = state.optimistic[id];

    return {
      id,
      label: p.peerLabel,
      status,
      tier: p.tier,
      behindNAT: p.behindNAT,
      bitfield: p.bitfield,
      piecesHave: have,
      progress: file.pieceCount ? have / file.pieceCount : 0,
      uploadedBytes: p.uploadedBytes,
      downloadedBytes: p.downloadedBytes,
      uploadCap: live ? round(live.uploadCap) : null,
      downloadCap: live ? round(live.downloadCap) : null,
      neighborTier: live ? live.neighborTier : null,
      waitingForPiece: live ? live.waitingForPiece : null,
      activeDownloads: incoming[id] || 0,
      connections: (state.connections[id] || []).map((cid) => ({
        id: cid,
        label: label[cid] || null,
        viaRelay: relayLabelFor(id, cid)
      })),
      unchoked: (state.unchoked[id] || []).map((cid) => ({ id: cid, label: label[cid] || null })),
      optimistic: opt && opt.target ? { id: opt.target, label: label[opt.target] || null } : null
    };
  });

  const tunnels = Object.entries(state.tunnels)
    .filter(([key]) => key.split('|').every((x) => label[x]))
    .map(([key, relayId]) => {
      const [a, b] = key.split('|');
      return { aLabel: label[a], bLabel: label[b], relayLabel: label[relayId] || null };
    });

  const seeders = peerList.filter((p) => p.status === 'seeding').length;
  const avgProgress = peerList.length
    ? peerList.reduce((sum, p) => sum + p.progress, 0) / peerList.length
    : 0;

  return {
    running,
    file: {
      id: fid,
      name: file.originalName,
      sizeBytes: file.sizeBytes,
      pieceCount: file.pieceCount,
      pieceSize: file.pieceSize
    },
    summary: {
      totalPeers: peerList.length,
      seeders,
      leechers: peerList.length - seeders,
      natPeers: peerList.filter((p) => p.behindNAT).length,
      completionPercent: Math.round(avgProgress * 100),
      activeTransfers: transfers.length,
      tunnelCount: tunnels.length
    },
    config: {
      connectionLimit: config.connectionLimit,
      unchokeSlots,
      chokeIntervalMs: config.chokeIntervalMs,
      optimisticIntervalMs: config.optimisticIntervalMs,
      reshuffleIntervalMs: config.reshuffleIntervalMs,
      maxConcurrentDownloads: config.maxConcurrentDownloads,
      tiers: config.tiers
    },
    peers: peerList,
    transfers,
    tunnels
  };
}

module.exports = { buildLiveState };