const Peer = require('./models/peer');
const File = require('./models/File');
const TransferLog = require('./models/TransferLog');
const { ensurePeerState, linkRate } = require('./bandwidth');
const state = require('./state');
const { config, getUnchokeSlots } = require('./config');
const { pickByReciprocity, pickByLinkRate, pickOptimistic, isServing, sameIds, unchokeMessage, chokeDropMessage } = require('./choke');
const { getReciprocity } = require('./reciprocity');
const { formConnections, reshufflePeer, pruneTunnels, formTunnels, tunnelKey, diffTunnels, diffConnections, scoreCandidate } = require('./connections');
const { recordEvent } = require('./events');
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

  // Snapshot connection lists so we can report what this round changed
  const peerIds = peers.map((p) => p._id.toString());
  const connBefore = {};
  for (const id of peerIds) connBefore[id] = [...(state.connections[id] || [])];

  // Temporary bootstrap (replaced by the reshuffle in C7): peers with no list yet get connections
  if (peers.some((p) => state.connections[p._id.toString()] === undefined)) {
    const conns = formConnections(peers, config.connectionLimit);
    for (const id of Object.keys(conns)) state.connections[id] = conns[id];
  }

  // Jittered reshuffle: each peer re-picks on its own schedule
  const now = Date.now();
  for (const peer of peers) {
    const ps = state.peers[peer._id.toString()];
    if (now < ps.nextReshuffleAt) continue;
    reshufflePeer(peer, peers, state.connections, config.connectionLimit);
        ps.nextReshuffleAt = now + config.reshuffleIntervalMs * (0.8 + Math.random() * 0.4);
  }

    // Record direct links that appeared or vanished (tunnel links are reported as tunnel events)
  const connDiff = diffConnections(connBefore, state.connections, peerIds);
  for (const [a, b] of connDiff.formed) {
    const A = byId[a], B = byId[b];
    const ab = scoreCandidate(A, B); // pieces B holds that A lacks
    const ba = scoreCandidate(B, A);
    recordEvent('connection', fid, [A.peerLabel, B.peerLabel],
      `${A.peerLabel} and ${B.peerLabel} connected. ${A.peerLabel} can get ${ab} piece(s) from ${B.peerLabel}, and ${B.peerLabel} can get ${ba} from ${A.peerLabel}. Peers rank candidates by how many missing pieces they hold, and a link needs a free slot on both sides (limit ${config.connectionLimit}).`);
  }
  for (const [a, b] of connDiff.dropped) {
    if (state.tunnels[tunnelKey(a, b)]) continue;
    const A = byId[a], B = byId[b];
    const ab = scoreCandidate(A, B);
    const ba = scoreCandidate(B, A);
    const why = ab === 0 && ba === 0
      ? 'Neither holds a piece the other is missing, so the link had no purpose.'
      : `A peer re-picks its connections at each reshuffle and keeps only the most useful ones that have a free slot (limit ${config.connectionLimit}), and this link did not make the cut. ${A.peerLabel} could still get ${ab} piece(s) from ${B.peerLabel}, and ${B.peerLabel} ${ba} from ${A.peerLabel}.`;
    recordEvent('connection', fid, [A.peerLabel, B.peerLabel],
      `${A.peerLabel} and ${B.peerLabel} are no longer connected. ${why}`);
  }

  // Tunnels: drop broken ones, then fill free slots of NATd peers with relayed links
    // Tunnels: drop broken ones, then fill free slots of NATd peers with relayed links
  const tunnelsBefore = { ...state.tunnels };
  pruneTunnels(state.connections, state.tunnels);
  formTunnels(peers, state.connections, state.tunnels, config.connectionLimit);

  // Record what changed. Keys of other files' tunnels are skipped (their peers aren't in byId).
  const tunnelDiff = diffTunnels(tunnelsBefore, state.tunnels);
  for (const [key, relayId] of tunnelDiff.formed) {
    const [a, b] = key.split('|');
    if (!byId[a] || !byId[b] || !byId[relayId]) continue;
    const A = byId[a].peerLabel, B = byId[b].peerLabel, R = byId[relayId].peerLabel;
    recordEvent('tunnel', fid, [A, B, R],
      `${A} and ${B} are both behind NAT, so they cannot connect directly. ${R} is public and connected to both, so it now carries their traffic as a tunnel.`);
  }
  for (const [key, relayId] of tunnelDiff.broken) {
    const [a, b] = key.split('|');
    if (!byId[a] || !byId[b]) continue;
    const A = byId[a].peerLabel, B = byId[b].peerLabel;
    const R = byId[relayId] ? byId[relayId].peerLabel : 'the relay';
    recordEvent('tunnel', fid, [A, B, R],
      `The tunnel between ${A} and ${B} through ${R} ended, because one of the links it depended on was dropped.`);
  }

  // Drop unchoke entries whose link no longer exists
  for (const peer of peers) {
    const id = peer._id.toString();
    if (!state.unchoked[id]) continue;
    const mine = state.connections[id] || [];
    state.unchoked[id] = state.unchoked[id].filter((x) => mine.includes(x));
  }

  // Re-choke: each peer re-picks its unchoke set every chokeIntervalMs
  for (const peer of peers) {
    const id = peer._id.toString();
    const ps = state.peers[id];
    if (state.unchoked[id] !== undefined && now < ps.nextChokeAt) continue;

    const conns = (state.connections[id] || []).map((x) => byId[x]).filter(Boolean);
    const isSeeder = peer.bitfield.every(Boolean);
    const scores = isSeeder ? {} : await getReciprocity(fileId, peer.peerLabel, file.pieceSize);
    const picked = isSeeder
      ? pickByLinkRate(peer, conns, getUnchokeSlots(), state.peers)
      : pickByReciprocity(peer, conns, getUnchokeSlots(), scores);

    const prevSet = state.unchoked[id] || [];
    state.unchoked[id] = picked.map((p) => p._id.toString());
    ps.nextChokeAt = now + config.chokeIntervalMs;

    // Only report real changes
    if (!sameIds(prevSet, state.unchoked[id])) {
      const entries = picked.map((p) => ({
        label: p.peerLabel,
        value: isSeeder
          ? Math.round(Math.min(ps.uploadCap, state.peers[p._id.toString()].downloadCap))
          : Math.round((scores[p.peerLabel] || 0) / 1024)
      }));
      recordEvent('unchoke', fid, [peer.peerLabel, ...picked.map((p) => p.peerLabel)],
        unchokeMessage(peer.peerLabel, isSeeder, entries, getUnchokeSlots()));
    }
  }


  // Optimistic slot: one extra random interested connection, rotated on a jittered timer
  for (const peer of peers) {
    const id = peer._id.toString();
    const conns = (state.connections[id] || []).map((x) => byId[x]).filter(Boolean);
    const o = state.optimistic[id];
    const targetGone = o && o.target && !(state.connections[id] || []).includes(o.target);
    if (o && now < o.nextAt && !targetGone) continue;

    const target = pickOptimistic(peer, conns, state.unchoked[id] || []);
    const prevTarget = o ? o.target : null;
    state.optimistic[id] = {
      target: target ? target._id.toString() : null,
      nextAt: now + config.optimisticIntervalMs * (0.8 + Math.random() * 0.4)
    };

    if (target && target._id.toString() !== prevTarget) {
      const prevLabel = prevTarget && byId[prevTarget] ? byId[prevTarget].peerLabel : null;
      recordEvent('optimistic', fid, [peer.peerLabel, target.peerLabel],
        `${peer.peerLabel} gave its optimistic slot to ${target.peerLabel}${prevLabel ? ` (it was ${prevLabel})` : ''}. The target is chosen at random among interested connections that are not already unchoked, so a peer that has sent nothing yet still gets served and slow or new peers are not starved.`);
    }
  }

  // PHASE 1: advance in-flight transfers (iterate backwards so removing is safe)
  // Count how many transfers each sender is serving right now (fixed for this tick)
  
  // Completions are collected here and written to MongoDB once, at the end of PHASE 1
  const changedPeers = new Map(); // peerId -> peer document (updated in memory)
  const logRows = [];

  // Choke check: drop transfers whose sender no longer serves the receiver.
  // Partial progress (bytesDone) is discarded with the transfer.
  const drops = [];
  for (let i = state.transfers.length - 1; i >= 0; i--) {
    const t = state.transfers[i];
    if (t.fileId !== fid) continue;
    const s = byId[t.fromId];
    const r = byId[t.toId];
    const tunneled = !!state.tunnels[tunnelKey(t.fromId, t.toId)];
    const natBlocked = !!(s && r && s.behindNAT && r.behindNAT && !tunneled);
    if (natBlocked || !isServing(t.fromId, t.toId, state.unchoked, state.optimistic)) {
      drops.push({
        from: s ? s.peerLabel : 'a removed peer',
        to: r ? r.peerLabel : 'a removed peer',
        piece: t.pieceIndex,
        kb: Math.round(t.bytesDone / 1024),
        natBlocked
      });
      state.transfers.splice(i, 1);
    }
  }
  if (drops.length > 0) {
    console.log(`choked: dropped ${drops.length} in-flight transfer(s)`);
    const labels = [...new Set(drops.flatMap((d) => [d.from, d.to]))];
    recordEvent('choke-drop', fid, labels, chokeDropMessage(drops));
  }
  
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

  
    // Which relay (if any) carries a transfer, and how many tunnel transfers each relay carries
  const relayOf = (t) => state.tunnels[tunnelKey(t.fromId, t.toId)];
  const relayCount = {};
  for (const t of state.transfers) {
    if (t.fileId !== fid) continue;
    const r = relayOf(t);
    if (r) relayCount[r] = (relayCount[r] || 0) + 1;
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
    // Every peer's pools include the tunnel traffic it carries as a relay
    const upPool = (id) => (sendCount[id] || 0) + (relayCount[id] || 0);
    const downPool = (id) => (recvCount[id] || 0) + (relayCount[id] || 0);

    const points = [
      { cap: state.peers[t.fromId].uploadCap, pool: upPool(t.fromId) },
      { cap: state.peers[t.toId].downloadCap, pool: downPool(t.toId) }
    ];
    const relayId = relayOf(t);
    if (relayId && state.peers[relayId]) {
      points.push({ cap: state.peers[relayId].uploadCap, pool: upPool(relayId) });
      points.push({ cap: state.peers[relayId].downloadCap, pool: downPool(relayId) });
    }
    const rate = linkRate(points);
    t.bytesDone += rate * 1024 * TICK_SECONDS;

    if (t.bytesDone < file.pieceSize) continue;

    // Piece complete: this is the only moment MongoDB is written
    receiver.bitfield[t.pieceIndex] = true;
    if (receiver.bitfield.every(Boolean)) {
      recordEvent('complete', fid, [receiver.peerLabel, sender.peerLabel],
        `${receiver.peerLabel} now holds all ${file.pieceCount} pieces and becomes a seeder. Its last piece (${t.pieceIndex}) came from ${sender.peerLabel}.`);
    }
    receiver.downloadedBytes += file.pieceSize;
    sender.uploadedBytes += file.pieceSize;
    state.transfers.splice(i, 1);

    // Carry leftover bytes (capped at one piece) into the receiver's next transfer
    const leftover = t.bytesDone - file.pieceSize;
    state.peers[t.toId].carryBytes = Math.min(leftover, file.pieceSize);

    changedPeers.set(t.toId, receiver);
    changedPeers.set(t.fromId, sender);
    logRows.push({
      fileId,
      pieceIndex: t.pieceIndex,
      fromPeerLabel: sender.peerLabel,
      toPeerLabel: receiver.peerLabel,
      timestamp: new Date()
    });
  }

  // One write for all changed peers, one for all log rows
  if (logRows.length > 0) {
    await Peer.bulkWrite(
      [...changedPeers.values()].map((p) => ({
        updateOne: {
          filter: { _id: p._id },
          update: {
            $set: {
              bitfield: Array.from(p.bitfield),
              downloadedBytes: p.downloadedBytes,
              uploadedBytes: p.uploadedBytes
            }
          }
        }
      }))
    );
    await TransferLog.insertMany(logRows);
    emitSwarmUpdate(io, fid);
    console.log(`completed ${logRows.length} piece(s)`);
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

    const servingMe = myConns.filter((c) => {
      const cid = c._id.toString();
      const opt = state.optimistic[cid];
      return (state.unchoked[cid] || []).includes(peerId) || (opt && opt.target === peerId);
    });

    // Rarity as this peer sees it: only its own connections count
    const localFrequency = countPieceFrequency(myConns, file.pieceCount);
    
        const wasWaiting = state.peers[peerId].waitingForPiece;
    const nowWaiting = findWaitingPiece(peer, myConns, file.pieceCount);
    state.peers[peerId].waitingForPiece = nowWaiting;

    if (wasWaiting === null && nowWaiting !== null) {
      const missing = peer.bitfield.filter((h) => !h).length;
      const links = myConns.length === 0
        ? 'it has no connections at all'
        : `none of its ${myConns.length} connection(s) hold any of them`;
      recordEvent('stall', fid, [peer.peerLabel],
        `${peer.peerLabel} is stalled. It still misses ${missing} piece(s), but ${links} (the rarest it needs is piece ${nowWaiting}). It must wait for a reshuffle to find a connection that has what it needs.`);
    } else if (wasWaiting !== null && nowWaiting === null) {
      const done = peer.bitfield.every(Boolean);
      recordEvent('stall', fid, [peer.peerLabel],
        done
          ? `${peer.peerLabel} is no longer stalled: it completed the file.`
          : `${peer.peerLabel} is no longer stalled: a connection now holds a piece it needs.`);
    }

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