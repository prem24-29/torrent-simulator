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
const { formConnections } = require('./connections');
const { pickRandomUnchoked } = require('./choke');
const { getReciprocity } = require('./reciprocity');

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
    const doomed = await Peer.find({ fileId }, '_id');
    await Peer.deleteMany({ fileId });
    for (const d of doomed) {
      delete state.connections[d._id.toString()];
      delete state.unchoked[d._id.toString()];
      delete state.optimistic[d._id.toString()];
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


app.get('/api/config', (req, res) => {
  res.json({
    connectionLimit: config.connectionLimit,
    unchokeSlots: getUnchokeSlots(),
    unchokeSlotsIsOverridden: config.unchokeSlotsOverride !== null,
    chokeIntervalMs: config.chokeIntervalMs,
    maxConcurrentDownloads: config.maxConcurrentDownloads
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
  try {
    const fileIds = await Peer.distinct('fileId');
    for (const fileId of fileIds) {
      await runExchangeRound(fileId, io);
    }
  } finally {
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