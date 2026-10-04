const Peer = require('./models/Peer');
const File = require('./models/File');
const TransferLog = require('./models/TransferLog');
const { ensurePeerState } = require('./bandwidth');

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

  const frequency = countPieceFrequency(peers, file.pieceCount);

  for (const peer of peers) {
    const missingIndexes = peer.bitfield
      .map((has, index) => (has ? null : index))
      .filter((index) => index !== null);

    if (missingIndexes.length === 0) continue;

    const pieceIndex = pickRarestPiece(missingIndexes, frequency);

    const candidates = peers.filter(
      (other) => other._id.toString() !== peer._id.toString() && other.bitfield[pieceIndex]
    );

    if (candidates.length === 0) continue;

    const sourcePeer = candidates[Math.floor(Math.random() * candidates.length)];

    peer.bitfield[pieceIndex] = true;
    peer.downloadedBytes += file.pieceSize;
    sourcePeer.uploadedBytes += file.pieceSize;

    await peer.save();
    await sourcePeer.save();

    await TransferLog.create({
      fileId,
      pieceIndex,
      fromPeerLabel: sourcePeer.peerLabel,
      toPeerLabel: peer.peerLabel
    });

    io.emit('swarm-update', { fileId: fileId.toString() });

    console.log(`${peer.peerLabel} received piece ${pieceIndex} from ${sourcePeer.peerLabel} (rarity: ${frequency[pieceIndex]})`);
  }
}

module.exports = { runExchangeRound };