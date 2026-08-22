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

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'uploads/' });

let simulationRunning = true;

const PIECE_SIZE = 16*1024; //16KB per piece


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
    const { fileId, peerLabel, bitfield } = req.body;

    const file = await File.findById(fileId);
    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }

    let peer = await Peer.findOne({ fileId, peerLabel });

    if (peer) {
        peer.bitfield = bitfield;
        peer.lastSeenAt = new Date();
        await peer.save();
    } else {
        peer = await Peer.create({
            fileId,
            peerLabel,
            bitfield: bitfield || new Array(file.pieceCount).fill(false)
        });
    }

    res.json({ message: 'Peer announced', peer });
});

app.get('/api/tracker/:fileId/peers', async (req, res) => { 
    const peers = await Peer.find({ fileId: req.params.fileId });
    res.json({ peers });
})


app.post('/api/simulate/pause', (req, res) => {
  simulationRunning = false;
  res.json({ message: 'Simulation paused' });
});


app.post('/api/simulate/resume', (req, res) => {
  simulationRunning = true;
  res.json({ message: 'Simulation resumed' });
});


app.get('/api/files', async (req, res) => {
  const files = await File.find().sort({ uploadedAt: 1 });
  res.json({ files });
});


app.get('/api/tracker/:fileId/activity', async (req, res) => {
  const logs = await TransferLog.find({ fileId: req.params.fileId })
    .sort({ timestamp: -1 })
    .limit(20);
  res.json({ logs });
});

//setInterval is a built-in JavaScript function that runs whatever function 
//you give it repeatedly, forever, every x seconds, until the process stops
setInterval(async () => {
  if (!simulationRunning) return;

  const fileIds = await Peer.distinct('fileId');
  for (const fileId of fileIds) {
    await runExchangeRound(fileId, io);
  }
}, 2000);


const server = app.listen(5000, () => {
  console.log('Server running on http://localhost:5000');
});

const io = new Server(server, {
  cors: { origin: '*' }
});