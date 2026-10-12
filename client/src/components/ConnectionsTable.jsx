/* ============================================================
   ConnectionsTable.jsx
   Table listing every peer in the selected peer's `connections`.
   Each row shows: name, tier, link (direct or via relay),
   serving relationship, pieces they can give me, I can give them.
   Optionally shows a reciprocity column fetched on demand from
   GET /api/dev/reciprocity/:fileId/:peerLabel.
   ============================================================ */
import React, { useState } from 'react';
import { API_BASE } from '../apiConfig.js';

// Work out the serving relationship between `me` and `them`.
// "I serve them"  → their id is in my unchoked list or is my optimistic.
// "They serve me" → my id is in their unchoked list or is their optimistic.
function servingRelation(me, them) {
  const iServe  = me.unchoked.some(u => u.id === them.id)
                  || (me.optimistic && me.optimistic.id === them.id);
  const theyServe = them.unchoked.some(u => u.id === me.id)
                    || (them.optimistic && them.optimistic.id === me.id);
  if (iServe && theyServe) return 'both';
  if (iServe)              return 'I serve them';
  if (theyServe)           return 'they serve me';
  return 'neither';
}

// Count pieces where theirBitfield[i] is true and myBitfield[i] is false.
function canGiveMe(myBitfield, theirBitfield) {
  let count = 0;
  for (let i = 0; i < myBitfield.length; i++) {
    if (!myBitfield[i] && theirBitfield[i]) count++;
  }
  return count;
}

// Count pieces where myBitfield[i] is true and theirBitfield[i] is false.
function iCanGiveThem(myBitfield, theirBitfield) {
  let count = 0;
  for (let i = 0; i < myBitfield.length; i++) {
    if (myBitfield[i] && !theirBitfield[i]) count++;
  }
  return count;
}

// Format a timestamp as HH:MM:SS
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function ConnectionsTable({ selectedPeer, allPeers, fileId }) {
  // `recip` = the fetched reciprocity data (null if not yet loaded)
  const [recip,           setRecip]           = useState(null);
  const [recipTimestamp,  setRecipTimestamp]  = useState(null);
  const [showRecip,       setShowRecip]       = useState(false);
  const [recipLoading,    setRecipLoading]    = useState(false);
  const [recipNote,       setRecipNote]       = useState('');

  async function fetchReciprocity() {
    setRecipLoading(true);
    setRecipNote('');
    try {
      const res  = await fetch(
        `${API_BASE}/api/dev/reciprocity/${fileId}/${selectedPeer.label}`
      );
      const data = await res.json();
      setRecip(data.bytesReceivedFrom || {});
      setRecipTimestamp(Date.now());
      setShowRecip(true);
      if (Object.keys(data.bytesReceivedFrom || {}).length === 0) {
        setRecipNote('No data received in the last 10 seconds.');
      } else {
        setRecipNote('');
      }
    } catch {
      setRecipNote('Failed to fetch reciprocity data.');
    } finally {
      setRecipLoading(false);
    }
  }

  // Build an id→peer lookup for fast access
  const peerById = {};
  for (const p of allPeers) peerById[p.id] = p;

  const isSeeder = selectedPeer.status === 'seeding';

  return (
    <div>
      {/* Show/refresh reciprocity button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="reciprocity-btn" onClick={fetchReciprocity} disabled={recipLoading}>
          {recipLoading ? 'Loading…' : showRecip ? 'Refresh reciprocity' : 'Show reciprocity'}
        </button>
        {showRecip && recipTimestamp && (
          <span className="reciprocity-note">
            as of {formatTime(recipTimestamp)}, last 10 s
          </span>
        )}
      </div>

      {/* Seeder note — seeders rank by link rate, not reciprocity */}
      {showRecip && isSeeder && (
        <div className="modal-note" style={{ marginBottom: 8 }}>
          Seeders rank connections by link rate, not reciprocity.
        </div>
      )}

      {/* No data note */}
      {showRecip && recipNote && (
        <div className="modal-note" style={{ marginBottom: 8 }}>{recipNote}</div>
      )}

      <div className="connections-table-wrap">
        <table className="connections-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tier</th>
              <th>Link</th>
              <th>Serving</th>
              <th>They can give me</th>
              <th>I can give them</th>
              {/* Only show reciprocity column if data is loaded and peer isn't a seeder */}
              {showRecip && !isSeeder && <th>Bytes from them (10 s)</th>}
            </tr>
          </thead>
          <tbody>
            {selectedPeer.connections.map(conn => {
              const other = peerById[conn.id];
              if (!other) return null; // peer might have left

              const link    = conn.viaRelay ? `via ${conn.viaRelay}` : 'direct';
              const serving = servingRelation(selectedPeer, other);
              const give    = canGiveMe(selectedPeer.bitfield, other.bitfield);
              const take    = iCanGiveThem(selectedPeer.bitfield, other.bitfield);
              const kb      = showRecip && !isSeeder
                ? Math.round((recip?.[other.label] ?? 0) / 1024)
                : null;

              return (
                <tr key={conn.id}>
                  <td>{other.label}</td>
                  <td>{other.tier}</td>
                  <td>{link}</td>
                  <td>{serving}</td>
                  <td>{give}</td>
                  <td>{take}</td>
                  {showRecip && !isSeeder && <td>{kb} KB</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ConnectionsTable;
