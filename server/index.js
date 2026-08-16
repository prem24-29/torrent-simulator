const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ dest: 'uploads/' });

const PIECE_SIZE = 16*1024; //16KB per piece

app.get('/', (req, res) => {
    res.send('Server is alive');
})

app.post('/api/files/upload', upload.single('file'), (req, res) => {
    const fileBuffer = fs.readFileSync(req.file.path);
    const pieceHashes = [];

    for (let offset = 0; offset < fileBuffer.length; offset += PIECE_SIZE){
        const piece = fileBuffer.subarray(offset, offset + PIECE_SIZE);
        const hash = crypto.createHash('sha256').update(piece).digest('hex');
        pieceHashes.push(hash);
    }

    res.json({ 
        message: 'File received',
        originalName: req.file.originalname,
        sizeBytes: fileBuffer.length,
        pieceSize: PIECE_SIZE,
        pieceCount: pieceHashes.length,
        pieceHashes: pieceHashes
        });
});

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});