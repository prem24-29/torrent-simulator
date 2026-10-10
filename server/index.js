require('dotenv').config();
const File = require('./models/File');
const Peer = require('./models/Peer');
const { runExchangeRound } = require('./exchange');
const TransferLog = require('./models/TransferLog');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const state = require('./state');
const { config, getUnchokeSlots } = require('./config');
const { driftAll } = require('./bandwidth');
const { formConnections, findRelay } = require('./connections');
const { pickRandomUnchoked } = require('./choke');
const { getReciprocity } = require('./reciprocity');
const { buildLiveState } = require('./live');
const { EVENT_TYPES, getEvents, clearEvents } = require('./events');
const { setArmed, setPinned, setAll, getArmState, isKnown } = require('./explain');

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

let simulationRunning = true;
let roundInProgress = false;

const PIECE_SIZE = 16*1024; //16KB per piece

const TIERS = ['slow', 'medium', 'fast'];
const NAT_PROBABILITY = 0.3;

function isPositiveInt(v) {
  return Number.isInteger(v) && v >= 1;
}

function randomTier() {
  return TIERS[Math.floor(Math.random() * TIERS.length)];
}

function randomBehindNAT() {
  return Math.random() < NAT_PROBABILITY;
}

const ROLES = ['seeder', 'leecher', 'random'];

// Build a bitfield for a role. "random" keeps each piece with probability `fill`.
function makeBitfield(pieceCount, role, fill = 0.5) {
  if (role === 'seeder') return new Array(pieceCount).fill(true);
  if (role === 'leecher') return new Array(pieceCount).fill(false);
  return Array.from({ length: pieceCount }, () => Math.random() < fill);
}

// Remove all peers of a file, their logs, and every piece of live state for them.
async function wipePeersOfFile(fileId) {
  const fid = String(fileId);
  clearEvents(fid); // clear the in-memory event log for this file
  const doomed = await Peer.find({ fileId }, '_id');
  await Peer.deleteMany({ fileId });
  const ids = new Set(doomed.map((d) => d._id.toString()));

  for (const id of ids) {
    delete state.peers[id];
    delete state.connections[id];
    delete state.unchoked[id];
    delete state.optimistic[id];
  }
  for (const k of Object.keys(state.tunnels)) {
    if (k.split('|').some((x) => ids.has(x))) delete state.tunnels[k];
  }
  for (let i = state.transfers.length - 1; i >= 0; i--) {
    if (state.transfers[i].fileId === fid) state.transfers.splice(i, 1);
  }
  await TransferLog.deleteMany({ fileId });
  return ids.size;
}

app.delete('/api/files/:fileId', async (req, res) => {
  const file = await File.findById(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const peersRemoved = await wipePeersOfFile(file._id);
  await File.deleteOne({ _id: file._id });

  io.emit('swarm-update', { fileId: String(file._id) });
  res.json({ message: `File "${file.originalName}" removed`, peersRemoved });
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
    res.send('Server is alive');
})


app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    const fileBuffer = fs.readFileSync(req.file.path);
    const pieceHashes = [];

    for (let offset = 0; offset < fileBuffer.length; offset += PIECE_SIZE){
        const piece = fileBuffer.subarray(offset, offset + PIECE_SIZE);
        const hash = crypto.createHash('sha256').update(piece).digest('hex');
        pieceHashes.push(hash);
    }

    const savedFile = await File.create({
        originalName: req.file.originalname,
        sizeBytes: fileBuffer.length,
        pieceSize: PIECE_SIZE,
        pieceCount: pieceHashes.length,
        pieceHashes: pieceHashes
    });

    res.json({
        message: 'File received, hashed, and saved',
        fileId: savedFile._id,
        originalName: savedFile.originalName,
        sizeBytes: savedFile.sizeBytes,
        pieceCount: savedFile.pieceCount
    });
});


app.post('/api/tracker/announce', async (req, res) => {
    console.log('Received body:', req.body);
    const { fileId, peerLabel, bitfield, tier, behindNAT } = req.body;

    const file = await File.findById(fileId);
    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }

    if (bitfield !== undefined) {
    const valid =
        Array.isArray(bitfield) &&
        bitfield.length === file.pieceCount &&
        bitfield.every((b) => typeof b === 'boolean');

      if (!valid) {
          return res.status(400).json({
              error: `bitfield must be an array of exactly ${file.pieceCount} booleans`
          });
      }
    }

    if (tier !== undefined && !TIERS.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${TIERS.join(', ')}` });
    }
    if (behindNAT !== undefined && typeof behindNAT !== 'boolean') {
        return res.status(400).json({ error: 'behindNAT must be true or false' });
    }

    let peer = await Peer.findOne({ fileId, peerLabel });

    if (peer) {
        if (bitfield) peer.bitfield = bitfield;
        if (tier !== undefined) peer.tier = tier;
        if (behindNAT !== undefined) peer.behindNAT = behindNAT;
        peer.lastSeenAt = new Date();
        await peer.save();
    } else {
        peer = await Peer.create({
            fileId,
            peerLabel,
            bitfield: bitfield || new Array(file.pieceCount).fill(false),
            tier: tier || randomTier(),
            behindNAT: behindNAT !== undefined ? behindNAT : randomBehindNAT()
        });
    }

    res.json({ message: 'Peer announced', peer });
});

app.get('/api/tracker/:fileId/peers', async (req, res) => { 
    const peers = await Peer.find({ fileId: req.params.fileId });
    res.json({ peers });
})

app.get('/api/live/:fileId', async (req, res) => {
  const file = await File.findById(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const peers = await Peer.find({ fileId: req.params.fileId });
  res.json(buildLiveState(file, peers, state, config, getUnchokeSlots(), simulationRunning));
});

app.post('/api/dev/seed-peers', async (req, res) => {
  const { fileId, count } = req.body;

  const file = await File.findById(fileId);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const createdPeers = [];

  for (let i = 0; i < count; i++) {
    const bitfield = new Array(file.pieceCount)
      .fill(false)
      .map(() => Math.random() < 0.5);

    const peer = await Peer.create({
      fileId,
      peerLabel: `dev_peer_${Date.now()}_${i}`,
      bitfield,
      tier: randomTier(),
      behindNAT: randomBehindNAT()
    });

    createdPeers.push(peer);
  }

  io.emit('swarm-update', { fileId });

  res.json({ message: `${count} random peers created`, peers: createdPeers });
});


app.delete('/api/dev/clear-peers', async (req, res) => {
  const { fileId } = req.body || {};

  if (fileId) {
    clearEvents(fileId); // clear the in-memory event log for this file
    const doomed = await Peer.find({ fileId }, '_id');
    await Peer.deleteMany({ fileId });
    for (const d of doomed) {
      delete state.connections[d._id.toString()];
      delete state.unchoked[d._id.toString()];
      delete state.optimistic[d._id.toString()];
    }

    for (const k of Object.keys(state.tunnels)) {
      const [x, y] = k.split('|');
      if (doomed.some((d) => [x, y].includes(d._id.toString()))) delete state.tunnels[k];
    }

    for (const id of Object.keys(state.peers)) {
      if (state.peers[id].fileId === fileId) delete state.peers[id];
    }
    io.emit('swarm-update', { fileId });
    return res.json({ message: `All peers cleared for file ${fileId}` });
  }

  await Peer.deleteMany({});
  for (const id of Object.keys(state.peers)) delete state.peers[id];
  for (const id of Object.keys(state.connections)) delete state.connections[id];
  for (const id of Object.keys(state.unchoked)) delete state.unchoked[id];
  for (const id of Object.keys(state.optimistic)) delete state.optimistic[id];
  for (const k of Object.keys(state.tunnels)) delete state.tunnels[k];
  for (const f of await File.find({}, '_id')) clearEvents(f._id);
  io.emit('swarm-update', { fileId: null });
  res.json({ message: 'All peers cleared across all files' });
});


app.delete('/api/dev/clear-logs', async (req, res) => {
  const { fileId } = req.body || {};

  if (fileId) {
    await TransferLog.deleteMany({ fileId });
    io.emit('swarm-update', { fileId });
    return res.json({ message: `Transfer logs cleared for file ${fileId}` });
  }

  await TransferLog.deleteMany({});
  io.emit('swarm-update', { fileId: null });
  res.json({ message: 'All transfer logs cleared across all files' });
});


app.post('/api/simulate/pause', (req, res) => {
  simulationRunning = false;
  res.json({ message: 'Simulation paused' });
});


app.post('/api/simulate/resume', (req, res) => {
  simulationRunning = true;
  res.json({ message: 'Simulation resumed' });
});


app.get('/api/dev/frequency/:fileId', async (req, res) => {
  const file = await File.findById(req.params.fileId);
  const peers = await Peer.find({ fileId: req.params.fileId });

  const frequency = new Array(file.pieceCount).fill(0);
  for (const peer of peers) {
    for (let i = 0; i < file.pieceCount; i++) {
      if (peer.bitfield[i]) frequency[i]++;
    }
  }

  res.json({ frequency });
});


app.get('/api/dev/state', (req, res) => {
  res.json(state);
});


app.post('/api/dev/form-connections', async (req, res) => {
  const { fileId } = req.body || {};
  const peers = await Peer.find({ fileId });
  const conns = formConnections(peers, config.connectionLimit);
  for (const id of Object.keys(conns)) state.connections[id] = conns[id];
  res.json({ connections: conns });
});


app.get('/api/dev/relay/:fileId', async (req, res) => {
  const { a, b } = req.query; // peer labels
  const peers = await Peer.find({ fileId: req.params.fileId });
  const peerA = peers.find((p) => p.peerLabel === a);
  const peerB = peers.find((p) => p.peerLabel === b);
  if (!peerA || !peerB) return res.status(404).json({ error: 'peer not found' });

  const peersById = {};
  const labelById = {};
  for (const p of peers) {
    peersById[p._id.toString()] = p;
    labelById[p._id.toString()] = p.peerLabel;
  }
  const relayId = findRelay(peerA._id.toString(), peerB._id.toString(), state.connections, peersById);
  res.json({ relayId, relayLabel: relayId ? labelById[relayId] : null });
});


app.get('/api/config', (req, res) => {
  res.json({
    connectionLimit: config.connectionLimit,
    unchokeSlots: getUnchokeSlots(),
    unchokeSlotsIsOverridden: config.unchokeSlotsOverride !== null,
    chokeIntervalMs: config.chokeIntervalMs,
    maxConcurrentDownloads: config.maxConcurrentDownloads,
    reshuffleIntervalMs: config.reshuffleIntervalMs,
    optimisticIntervalMs: config.optimisticIntervalMs
  });
});

app.post('/api/config/connection-limit', (req, res) => {
  const { value } = req.body || {};
  if (!isPositiveInt(value)) {
    return res.status(400).json({ error: 'value must be a whole number, 1 or more' });
  }
  config.connectionLimit = value;
  res.json({ connectionLimit: config.connectionLimit, unchokeSlots: getUnchokeSlots() });
});

app.post('/api/config/unchoke-slots', (req, res) => {
  const { value } = req.body || {};
  if (value === null) {
    config.unchokeSlotsOverride = null;
  } else if (isPositiveInt(value)) {
    config.unchokeSlotsOverride = value;
  } else {
    return res.status(400).json({ error: 'value must be a whole number, 1 or more, or null to clear' });
  }
  res.json({
    unchokeSlots: getUnchokeSlots(),
    unchokeSlotsIsOverridden: config.unchokeSlotsOverride !== null
  });
});

app.post('/api/config/choke-interval', (req, res) => {
  const { value } = req.body || {};
  if (!isPositiveInt(value) || value < 500) {
    return res.status(400).json({ error: 'value must be a whole number of milliseconds, 500 or more' });
  }
  config.chokeIntervalMs = value;
  res.json({ chokeIntervalMs: config.chokeIntervalMs });
});

app.post('/api/config/max-downloads', (req, res) => {
  const { value } = req.body || {};
  if (!isPositiveInt(value)) {
    return res.status(400).json({ error: 'value must be a whole number, 1 or more' });
  }
  config.maxConcurrentDownloads = value;
  res.json({ maxConcurrentDownloads: config.maxConcurrentDownloads });
});


app.get('/api/files', async (req, res) => {
  const files = await File.find().sort({ uploadedAt: 1 });
  res.json({ files });
});


app.get('/api/tracker/:fileId/activity', async (req, res) => {
  const logs = await TransferLog.find({ fileId: req.params.fileId })
    .sort({ timestamp: -1 })
    .limit(10);
  res.json({ logs });
});

// Bandwidth drift runs on its own clock, separate from the exchange tick.
setInterval(() => {
  if (!simulationRunning) return;
  driftAll();
}, 2000);

//setInterval is a built-in JavaScript function that runs whatever function 
//you give it repeatedly, forever, every x seconds, until the process stops
setInterval(async () => {
  if (!simulationRunning) return;
  if (roundInProgress) return;

  roundInProgress = true;
  const t0 = Date.now();
  try {
    const fileIds = await Peer.distinct('fileId');
    for (const fileId of fileIds) {
      await runExchangeRound(fileId, io);
    }
  } finally {
    console.log(`round took ${Date.now() - t0} ms`);
    roundInProgress = false;
  }
}, 500);


const server = app.listen(5000, () => {
  console.log('Server running on http://localhost:5000');
});

const io = new Server(server, {
  cors: { origin: '*' }
});


app.post('/api/dev/rechoke', async (req, res) => {
  const { fileId } = req.body || {};
  const peers = await Peer.find({ fileId });
  const byId = {};
  for (const p of peers) byId[p._id.toString()] = p;
  for (const peer of peers) {
    const id = peer._id.toString();
    const conns = (state.connections[id] || []).map((x) => byId[x]).filter(Boolean);
    const isSeeder = peer.bitfield.every(Boolean);
    const scores = isSeeder ? {} : await getReciprocity(fileId, peer.peerLabel, file.pieceSize);
    const picked = isSeeder
      ? pickByLinkRate(peer, conns, getUnchokeSlots(), state.peers)
      : pickByReciprocity(peer, conns, getUnchokeSlots(), scores);
    state.unchoked[id] = picked.map((p) => p._id.toString());
  }
  res.json({ unchoked: state.unchoked });
});


app.get('/api/dev/reciprocity/:fileId/:peerLabel', async (req, res) => {
  const file = await File.findById(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const windowMs = Number(req.query.windowMs) || 10000;
  const result = await getReciprocity(req.params.fileId, req.params.peerLabel, file.pieceSize, windowMs);
  res.json({ windowMs, bytesReceivedFrom: result });
});

app.post('/api/dev/scenario', async (req, res) => {
  const { fileId, groups } = req.body || {};
  const file = await File.findById(fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!Array.isArray(groups)) return res.status(400).json({ error: 'groups must be an array' });
    for (const g of groups) {
    if (!ROLES.includes(g.role)) {
      return res.status(400).json({ error: `role must be "seeder", "leecher" or "random" (got "${g.role}")` });
    }
    if (g.fill !== undefined && (typeof g.fill !== 'number' || g.fill < 0 || g.fill > 1)) {
      return res.status(400).json({ error: 'fill must be a number from 0 to 1' });
    }
  }
   
  const fid = String(fileId);
  clearEvents(fid); // clear the in-memory event log for this file

  // Clear this file's peers and their live state (same cleanup as clear-peers)
  const doomed = await Peer.find({ fileId }, '_id');
  await Peer.deleteMany({ fileId });
  const ids = new Set(doomed.map((d) => d._id.toString()));

  for (const id of ids) {
    delete state.connections[id];
    delete state.unchoked[id];
    delete state.optimistic[id];
    delete state.peers[id];
  }

  for (const k of Object.keys(state.tunnels)) {
    if (k.split('|').some((x) => ids.has(x))) delete state.tunnels[k];
  }

  // Strict: remove this file's transfers in place, so every file keeps the same array
  for (let i = state.transfers.length - 1; i >= 0; i--) {
    if (state.transfers[i].fileId === fid) state.transfers.splice(i, 1);
  }

  await TransferLog.deleteMany({ fileId });

  // Build the new peers
  const created = [];
  for (const g of groups) {
    const count = g.count || 1;
    for (let i = 0; i < count; i++) {
      const peer = await Peer.create({
        fileId,
        peerLabel: count === 1 ? g.label : `${g.label}${i + 1}`,
        tier: TIERS.includes(g.tier) ? g.tier : randomTier(),
        behindNAT: typeof g.behindNAT === 'boolean' ? g.behindNAT : false,
        bitfield: makeBitfield(file.pieceCount, g.role, g.fill)
      });
      created.push({ label: peer.peerLabel, tier: peer.tier, behindNAT: peer.behindNAT, role: g.role });
    }
  }

  io.emit('swarm-update', { fileId: fid });
  res.json({ created });
});

app.post('/api/dev/add-peer', async (req, res) => {
  const { fileId, label, role, tier, behindNAT, fill } = req.body || {};

  const file = await File.findById(fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  if (typeof label !== 'string' || label.trim() === '') {
    return res.status(400).json({ error: 'label is required' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be "seeder", "leecher" or "random"' });
  }
  if (fill !== undefined && (typeof fill !== 'number' || fill < 0 || fill > 1)) {
    return res.status(400).json({ error: 'fill must be a number from 0 to 1' });
  }

  const exists = await Peer.findOne({ fileId, peerLabel: label.trim() });
  if (exists) return res.status(409).json({ error: `A peer named "${label.trim()}" already exists in this file` });

  const peer = await Peer.create({
    fileId,
    peerLabel: label.trim(),
    tier: tier || randomTier(),
    behindNAT: behindNAT !== undefined ? behindNAT : randomBehindNAT(),
    bitfield: makeBitfield(file.pieceCount, role, fill)
  });

  io.emit('swarm-update', { fileId: String(fileId) });
  res.json({ peer: { label: peer.peerLabel, tier: peer.tier, behindNAT: peer.behindNAT, role } });
});

app.post('/api/config/reshuffle-interval', (req, res) => {
  const { value } = req.body || {};
  if (!isPositiveInt(value) || value < 1000) {
    return res.status(400).json({ error: 'value must be a whole number of milliseconds, 1000 or more' });
  }
  config.reshuffleIntervalMs = value;
  res.json({ reshuffleIntervalMs: config.reshuffleIntervalMs });
});

app.post('/api/config/optimistic-interval', (req, res) => {
  const { value } = req.body || {};
  if (!isPositiveInt(value) || value < 1000) {
    return res.status(400).json({ error: 'value must be a whole number of milliseconds, 1000 or more' });
  }
  config.optimisticIntervalMs = value;
  res.json({ optimisticIntervalMs: config.optimisticIntervalMs });
});

app.get('/api/events/:fileId', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json({ types: EVENT_TYPES, events: getEvents(req.params.fileId, since) });
});

app.get('/api/explain', (req, res) => {
  res.json({ types: getArmState() });
});

app.post('/api/explain/arm', (req, res) => {
  const { type, armed } = req.body || {};
  if (!isKnown(type)) return res.status(400).json({ error: 'unknown event type' });
  if (typeof armed !== 'boolean') return res.status(400).json({ error: 'armed must be true or false' });
  setArmed(type, armed);
  res.json({ types: getArmState() });
});

app.post('/api/explain/pin', (req, res) => {
  const { type, pinned } = req.body || {};
  if (!isKnown(type)) return res.status(400).json({ error: 'unknown event type' });
  if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'pinned must be true or false' });
  setPinned(type, pinned);
  res.json({ types: getArmState() });
});

app.post('/api/explain/arm-all', (req, res) => {
  const { armed } = req.body || {};
  if (typeof armed !== 'boolean') return res.status(400).json({ error: 'armed must be true or false' });
  setAll(armed);
  res.json({ types: getArmState() });
});