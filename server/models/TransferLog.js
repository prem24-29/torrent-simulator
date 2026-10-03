const mongoose = require('mongoose');

const transferLogSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  pieceIndex: Number,
  fromPeerLabel: String,
  toPeerLabel: String,
  timestamp: { type: Date, default: Date.now }
});

transferLogSchema.index({ fileId: 1, toPeerLabel: 1, timestamp: -1 });

module.exports = mongoose.model('TransferLog', transferLogSchema);