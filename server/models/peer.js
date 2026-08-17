const mongoose = require('mongoose');

const peerSchema = new mongoose.Schema({
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    peerLabel: { type: String, required: true },
    bitfield: [Boolean],
    uploadedBytes: { type: Number, default: 0 },
    downloadedBytes: { type: Number, default: 0 },
    status: { type: String, enum: ['seeding', 'downloading', 'idle'], default: 'idle' },
    lastSeenAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Peer', peerSchema);