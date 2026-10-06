const Peer = require('./models/Peer');
const File = require('./models/File');
const TransferLog = require('./models/TransferLog');
const { ensurePeerState } = require('./bandwidth');
const state = require('./state');
const { config, getUnchokeSlots } = require('./config');
const { pickRandomUnchoked } = require('./choke');
const { formConnections, reshufflerPeer } = require('./connections');
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

const EMIT_INTERVAL_MS = 1000;
const lastEmit = {};     // fileId -> time of the last emit
const pendingEmit = {};  // fileId -> timer waiting to send the trailing emit

// Send 'swarm-update' at most once per EMIT_INTERVAL_MS per file.
function emitSwarmUpdate(io, fid) {
  const now = Date.now();
  const wait = (lastEmit[fid] || 0) + EMIT_INTERVAL_MS - now;

  if (wait <= 0) {
    lastEmit[fid] = now;
    io.emit('swarm-update', { fileId: fid });
  } else if (!pendingEmit[fid]) {
    pendingEmit[fid] = setTimeout(() => {
      pendingEmit[fid] = null;
      lastEmit[fid] = Date.now();
      io.emit('swarm-update', { fileId: fid });
    }, wait);
  }
}


// The piece a peer is stuck waiting for, or null if it isn't waiting.
// Waiting = still missing pieces, but no connection holds any of them.
function findWaitingPiece(peer, myConns, pieceCount) {
  const missing = [];
  for (let i = 0; i < pieceCount; i++) {
    if (!peer.bitfield[i]) missing.push(i);
  }
  if (missing.length === 0) return null;
  if (missing.some((i) => myConns.some((c) => c.bitfield[i]))) return null;
  return pickRarestPiece(missing, countPieceFrequency(myConns, pieceCount));
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

  // Temporary bootstrap (replaced by the reshuffle in C7): peers with no list yet get connections
  if (peers.some((p) => state.connections[p._id.toString()] === undefined)) {
    const conns = formConnections(peers, config.connectionLimit);
    for (const id of Object.keys(conns)) state.connections[id] = conns[id];
  }


    // Temporary bootstrap (D8 replaces with a timer): peers with no unchoke set get one
  for (const peer of peers) {
    const id = peer._id.toString();
    if (state.unchoked[id] !== undefined) continue;
    const conns = (state.connections[id] || []).map((x) => byId[x]).filter(Boolean);
    state.unchoked[id] = pickRandomUnchoked(peer, conns, getUnchokeSlots()).map((p) => p._id.toString());
  }


  // Jittered reshuffle: each peer re-picks on its own schedule
  const now = Date.now();
  for (const peer of peers) {
    const ps = state.peers[peer._id.toString()];
    if (now < ps.nextReshuffleAt) continue;
    reshufflePeer(peer, peers, state.connections, config.connectionLimit);
    ps.nextReshuffleAt = now + 25000 * (0.8 + Math.random() * 0.4);
  }

  // PHASE 1: advance in-flight transfers (iterate backwards so removing is safe)
  // Count how many transfers each sender is serving right now (fixed for this tick)
  const sendCount = {};
  for (const t of state.transfers) {
    if (t.fileId !== fid) continue;
    sendCount[t.fromId] = (sendCount[t.fromId] || 0) + 1;
  }

  // Count how many pieces each receiver is getting right now (fixed for this tick)
  const recvCount = {};
  for (const t of state.transfers) {
    if (t.fileId !== fid) continue;
    recvCount[t.toId] = (recvCount[t.toId] || 0) + 1;
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
    const downloadShare = state.peers[t.toId].downloadCap / recvCount[t.toId];
    const rate = Math.min(uploadShare, downloadShare);
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

    emitSwarmUpdate(io, fid);
    console.log(`${receiver.peerLabel} received piece ${t.pieceIndex} from ${sender.peerLabel}`);
  }

  // PHASE 2: fill each peer's download slots, never picking a piece already in flight

  // Per receiver: how many transfers it has, and which pieces are reserved
  const incoming = {};
  const reserved = {};
  for (const t of state.transfers) {
    if (t.fileId !== fid) continue;
    incoming[t.toId] = (incoming[t.toId] || 0) + 1;
    if (!reserved[t.toId]) reserved[t.toId] = new Set();
    reserved[t.toId].add(t.pieceIndex);
  }

  for (const peer of peers) {
    const peerId = peer._id.toString();
    if (!reserved[peerId]) reserved[peerId] = new Set();

    // Only my connections can serve me
    const myConns = (state.connections[peerId] || []).map((id) => byId[id]).filter(Boolean);
        // Of my connections, those that have unchoked me (the only ones that can serve me)
    const servingMe = myConns.filter((c) => (state.unchoked[c._id.toString()] || []).includes(peerId));
    // Rarity as this peer sees it: only its own connections count
    const localFrequency = countPieceFrequency(myConns, file.pieceCount);
    
    state.peers[peerId].waitingForPiece = findWaitingPiece(peer, myConns, file.pieceCount);

    while ((incoming[peerId] || 0) < config.maxConcurrentDownloads) {
      // Pieces I lack, haven't reserved, and at least one connection holds
      const wanted = [];
      for (let i = 0; i < file.pieceCount; i++) {
        if (!peer.bitfield[i] && !reserved[peerId].has(i) && servingMe.some((c) => c.bitfield[i])) wanted.push(i);
      }
      if (wanted.length === 0) break;

      const pieceIndex = pickRarestPiece(wanted, localFrequency);

      const candidates = servingMe.filter((c) => c.bitfield[pieceIndex]);
      const source = candidates[Math.floor(Math.random() * candidates.length)];

      state.transfers.push({
        fileId: fid,
        fromId: source._id.toString(),
        toId: peerId,
        pieceIndex,
        bytesDone: state.peers[peerId].carryBytes
      });
      state.peers[peerId].carryBytes = 0;

      reserved[peerId].add(pieceIndex);
      incoming[peerId] = (incoming[peerId] || 0) + 1;
    }
  }
}

module.exports = { runExchangeRound, countPieceFrequency, pickRarestPiece, findWaitingPiece };