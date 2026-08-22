const mongoose = require('mongoose');

const transferLogSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  pieceIndex: Number,
  fromPeerLabel: String,
  toPeerLabel: String,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TransferLog', transferLogSchema);