const Peer = require('./models/Peer');
const File = require('./models/File');
const TransferLog = require('./models/TransferLog');

async function runExchangeRound(fileId, io) {
  const file = await File.findById(fileId);
  if (!file) return;

  const peers = await Peer.find({ fileId });
  if (peers.length < 2) return; // need at least 2 peers for exchange to make sense

  for (const peer of peers) {
    const missingIndexes = peer.bitfield
      .map((has, index) => (has ? null : index))
      .filter((index) => index !== null);

    if (missingIndexes.length === 0) continue; // this peer already has everything

    //Dumb random selection of a missing piece to request from another peer
    const pieceIndex = missingIndexes[Math.floor(Math.random() * missingIndexes.length)];

    const candidates = peers.filter(
      (other) => other._id.toString() !== peer._id.toString() && other.bitfield[pieceIndex]
    );

    if (candidates.length === 0) continue; // nobody in the swarm has this piece yet

    const sourcePeer = candidates[Math.floor(Math.random() * candidates.length)];

    peer.bitfield[pieceIndex] = true;
    peer.downloadedBytes += file.pieceSize;
    sourcePeer.uploadedBytes += file.pieceSize;

    //Persist both changes back to MongoDB
    //Remember that until .save() runs, these changes only exist in memory inside this function
    await peer.save();
    await sourcePeer.save();

    console.log(`${peer.peerLabel} received piece ${pieceIndex} from ${sourcePeer.peerLabel}`);
    await TransferLog.create({
        fileId,
        pieceIndex,
        fromPeerLabel: sourcePeer.peerLabel,
        toPeerLabel: peer.peerLabel
    });
    io.emit('swarm-update', { fileId: fileId.toString() });
  }
}

module.exports = { runExchangeRound };