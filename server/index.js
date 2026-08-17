require('dotenv').config();
const File = require('./models/File');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose')

const app = express();
const upload = multer({ dest: 'uploads/' });

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

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});