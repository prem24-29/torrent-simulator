const mongoose = require('mongoose');

const peerSchema = new mongoose.Schema({
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    //Above we tell mongoose that the type if ObjectId. The ref field then tells it that "whatever ObjectId gets stored here is expected to be the _id of a document that lives in the File collection"
    /*fileId is a field whose type is MongoDB's ObjectId format,
    and the ref: 'File' tells Mongoose that this particular ObjectId 
    is meant to point to a document in the File collection" — two separate pieces of information (the data type, and the relationship it represents)*/
    peerLabel: { type: String, required: true },
    bitfield: [Boolean],
    uploadedBytes: { type: Number, default: 0 },
    downloadedBytes: { type: Number, default: 0 },
    status: { type: String, enum: ['seeding', 'downloading', 'idle'], default: 'idle' },
    lastSeenAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Peer', peerSchema);