const mongoose = require('mongoose');
const TransferLog = require('./models/TransferLog');

// Bytes each sender delivered to `peerLabel` within the last `windowMs`.
// Returns { fromPeerLabel: bytes }. Labels are unique within a file, so we key on them.
async function getReciprocity(fileId, peerLabel, pieceSize, windowMs = 10000) {
  const since = new Date(Date.now() - windowMs);
  const rows = await TransferLog.aggregate([
    {
      $match: {
        fileId: new mongoose.Types.ObjectId(String(fileId)),
        toPeerLabel: peerLabel,
        timestamp: { $gte: since }
      }
    },
    { $group: { _id: '$fromPeerLabel', pieces: { $sum: 1 } } }
  ]);

  const result = {};
  for (const r of rows) result[r._id] = r.pieces * pieceSize;
  return result;
}

module.exports = { getReciprocity };