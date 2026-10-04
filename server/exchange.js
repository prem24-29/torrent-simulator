const Peer = require('./models/Peer');
const File = require('./models/File');
const TransferLog = require('./models/TransferLog');
const { ensurePeerState } = require('./bandwidth');
const state = require('./state');
const TICK_SECONDS = 0.5; // must match the exchange interval in index.js (500ms)

function countPieceFrequency(peers, pieceCount) {
  const frequency = new Array(pieceCount).fill(0);

  for (const peer of peers) {
    for (let i = 0; i < pieceCount; i++) {
      if (peer.bitfield[i]) frequency[i]++;
    }
  }

  return frequency;
}

function pickRarestPiece(missingIndexes, frequency) {
  let rarestIndex = missingIndexes[0];
  let rarestCount = frequency[rarestIndex];

  for (const index of missingIndexes) {
    if (frequency[index] < rarestCount) {
      rarestIndex = index;
      rarestCount = frequency[index];
    }
  }

  return rarestIndex;
}

async function runExchangeRound(fileId, io) {
  const file = await File.findById(fileId);
  if (!file) return;

  const peers = await Peer.find({ fileId });
  if (peers.length < 2) return;

  for (const peer of peers) ensurePeerState(peer);

  const byId = {};
  for (const peer of peers) byId[peer._id.toString()] = peer;
  const fid = fileId.toString();

  // PHASE 1: advance in-flight transfers (iterate backwards so removing is safe)
  // Count how many transfers each sender is serving right now (fixed for this tick)
  const sendCount = {};
  for (const t of state.transfers) {
    if (t.fileId !== fid) continue;
    sendCount[t.fromId] = (sendCount[t.fromId] || 0) + 1;
  }

  for (let i = state.transfers.length - 1; i >= 0; i--) {
    const t = state.transfers[i];
    if (t.fileId !== fid) continue;

    const sender = byId[t.fromId];
    const receiver = byId[t.toId];

    // Drop transfers whose peers were deleted, or whose piece arrived another way
    if (!sender || !receiver || receiver.bitfield[t.pieceIndex]) {
      state.transfers.splice(i, 1);
      continue;
    }

    // Sender's upload is shared evenly; the slower end still limits the link
    const uploadShare = state.peers[t.fromId].uploadCap / sendCount[t.fromId];
    const rate = Math.min(uploadShare, state.peers[t.toId].downloadCap);
    console.log(`${state.peers[t.fromId].peerLabel} -> ${state.peers[t.toId].peerLabel}: ${rate.toFixed(1)} KB/s (${sendCount[t.fromId]} active)`);
    t.bytesDone += rate * 1024 * TICK_SECONDS;

    if (t.bytesDone < file.pieceSize) continue;

    // Piece complete: this is the only moment MongoDB is written
    receiver.bitfield[t.pieceIndex] = true;
    receiver.downloadedBytes += file.pieceSize;
    sender.uploadedBytes += file.pieceSize;
    state.transfers.splice(i, 1);

    // Carry leftover bytes (capped at one piece) into the receiver's next transfer
    const leftover = t.bytesDone - file.pieceSize;
    state.peers[t.toId].carryBytes = Math.min(leftover, file.pieceSize);

    await receiver.save();
    await sender.save();

    await TransferLog.create({
      fileId,
      pieceIndex: t.pieceIndex,
      fromPeerLabel: sender.peerLabel,
      toPeerLabel: receiver.peerLabel
    });

    io.emit('swarm-update', { fileId: fid });
    console.log(`${receiver.peerLabel} received piece ${t.pieceIndex} from ${sender.peerLabel}`);
  }

  // PHASE 2: start a new transfer for every peer that isn't already receiving one
  const frequency = countPieceFrequency(peers, file.pieceCount);
  const receiving = new Set(state.transfers.map((t) => t.toId));

  for (const peer of peers) {
    const peerId = peer._id.toString();
    if (receiving.has(peerId)) continue;

    const missingIndexes = peer.bitfield
      .map((has, index) => (has ? null : index))
      .filter((index) => index !== null);
    if (missingIndexes.length === 0) continue;

    const pieceIndex = pickRarestPiece(missingIndexes, frequency);

    const candidates = peers.filter(
      (other) => other._id.toString() !== peerId && other.bitfield[pieceIndex]
    );
    if (candidates.length === 0) continue;

    const source = candidates[Math.floor(Math.random() * candidates.length)];

    state.transfers.push({
      fileId: fid,
      fromId: source._id.toString(),
      toId: peerId,
      pieceIndex,
      bytesDone: state.peers[peerId].carryBytes
    });
    state.peers[peerId].carryBytes = 0;
  }
}

module.exports = { runExchangeRound };