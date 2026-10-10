/* ============================================================
   DetailView.jsx
   Shown when the user clicks a peer tile. Two parts:
   1. An isolated grid (left): only the selected peer + its
      current connections. Tiles appear/disappear live.
   2. A side panel (right): rich info about the selected peer,
      its in-flight transfers, and the ConnectionsTable.

   Props:
   - selectedPeer:  the full peer object from the live response
   - allPeers:      all peers (needed to look up connections)
   - transfers:     the transfers array from the live response
   - fileId:        needed by ConnectionsTable for reciprocity fetch
   - onBack:        callback when user clicks "Back"
   ============================================================ */
import React from 'react';
import PeerGrid from './PeerGrid.jsx';
import ConnectionsTable from './ConnectionsTable.jsx';

// Format KB/s: round to 1 decimal, or show "?" if null
function kbs(val) {
  return val != null ? `${Math.round(val)} KB/s` : '?';
}

// Filter transfers where this peer is sender or receiver
function transfersForPeer(transfers, peerId) {
  return transfers.filter(t => t.fromId === peerId || t.toId === peerId);
}

function DetailView({ selectedPeer, allPeers, transfers, fileId, onBack }) {
  if (!selectedPeer) return null;

  // The isolated grid shows: selected peer + peers in its connections
  const connectionIds = new Set(selectedPeer.connections.map(c => c.id));
  const isolatedPeers = allPeers.filter(
    p => p.id === selectedPeer.id || connectionIds.has(p.id)
  );

  const myTransfers = transfersForPeer(transfers, selectedPeer.id);

  // Labels of peers this peer has unchoked
  const unchokedLabels = selectedPeer.unchoked.map(u => u.label).join(', ') || 'none';
  const optimisticLabel = selectedPeer.optimistic?.label || 'none';

  return (
    /* detail-layout is now a flex column, so grid area is on top */
    <div className="detail-layout">

      {/* Top: isolated peer grid — shrinks to fit its tiles */}
      <div className="detail-grid-area">
        <button className="detail-back-btn" onClick={onBack}>← Back</button>
        <div className="detail-grid-note">
          Connections update as peers reshuffle.
        </div>
        {/* Reuse PeerGrid but with the subset of peers.
            We pass null for selectedPeerId highlight here to avoid infinite loops;
            the selected tile is already visually distinct via its colour. */}
        <PeerGrid
          peers={isolatedPeers}
          selectedPeerId={selectedPeer.id}
          onSelectPeer={() => {}} /* clicking tiles in isolation does nothing */
        />
      </div>

      {/* Below: full-width detail panel */}
      <div className="detail-panel">
        {/* Header row: name + hex id */}
        <h3>{selectedPeer.label}</h3>
        <div className="detail-hex">{selectedPeer.id}</div>

        {/* Three info columns side by side (stack on narrow screens) */}
        <div className="detail-info-cols">

          {/* Column 1: Info */}
          <div>
            <div className="detail-section-title">Info</div>
            <div>Tier: <strong>{selectedPeer.tier}</strong></div>
            <div>{selectedPeer.behindNAT ? 'Behind NAT' : 'Public'}</div>
            <div>Upload: <strong>{kbs(selectedPeer.uploadCap)}</strong></div>
            <div>Download: <strong>{kbs(selectedPeer.downloadCap)}</strong></div>
            <div>Progress: <strong>{Math.round((selectedPeer.progress ?? 0) * 100)}%</strong></div>
            <div>
              Waiting:{' '}
              {selectedPeer.waitingForPiece !== null
                ? <strong>piece {selectedPeer.waitingForPiece}</strong>
                : 'not waiting'}
            </div>
            <div>Active downloads: <strong>{selectedPeer.activeDownloads}</strong></div>
          </div>

          {/* Column 2: Choking */}
          <div>
            <div className="detail-section-title">Choking</div>
            <div>Serving: <strong>{unchokedLabels}</strong></div>
            <div>Optimistic: <strong>{optimisticLabel}</strong></div>
          </div>

          {/* Column 3: In-flight transfers */}
          <div>
            <div className="detail-section-title">In-flight transfers</div>
            {myTransfers.length === 0 ? (
              <div className="muted">None right now.</div>
            ) : (
              myTransfers.map((t, i) => {
                const dir = t.fromId === selectedPeer.id ? '↑ sending' : '↓ receiving';
                const via = t.relayLabel ? ` via ${t.relayLabel}` : '';
                return (
                  <div className="transfer-row" key={i}>
                    {dir} piece {t.pieceIndex} ({Math.round(t.progress * 100)}%){via}
                    {' '}{dir.includes('send') ? `→ ${t.toLabel}` : `← ${t.fromLabel}`}
                  </div>
                );
              })
            )}
          </div>

        </div>{/* end detail-info-cols */}

        {/* Connections — full width so the table has room */}
        <div className="detail-section">
          <div className="detail-section-title">Connections</div>
          <ConnectionsTable
            selectedPeer={selectedPeer}
            allPeers={allPeers}
            fileId={fileId}
          />
        </div>
      </div>

    </div>
  );
}

export default DetailView;
