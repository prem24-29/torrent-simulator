// Live simulation state. Lives in memory only; MongoDB keeps the durable record.
// Keys are peer _id strings (peerLabel is only unique within one file).
const state = {
  peers: {},        // peerId -> live data (capacity, byte budget, ...), added in layer B
  transfers: [],    // in-flight transfers, added in layer B
  connections: {},   // peerId -> list of connected peerIds, added in layer C
  unchoked: {},
  optimistic: {},    // peerId -> { target: peerId or null, nextAt: timestamp }
  tunnels: {}       // "idA|idB" (sorted) -> relay peer id
};

module.exports = state;