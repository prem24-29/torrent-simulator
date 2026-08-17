const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  originalName: String,
  sizeBytes: Number,
  pieceSize: Number,
  pieceCount: Number,
  pieceHashes: [String],
  uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('File', fileSchema);