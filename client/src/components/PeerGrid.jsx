/* ============================================================
   PeerGrid.jsx
   The main peer tile grid plus the floating hover tooltip card.

   Responsibilities:
   - Renders one PeerTile per peer in `peers`.
   - Tracks which tile is hovered and the mouse position.
   - Works out which tile ids to highlight (the hovered peer's connections).
   - Shows the hover tooltip (PeerHoverCard) at the cursor.
   - Calls `onSelectPeer` when a tile is clicked.
   - `explainHighlightLabels` (Set<string>) — labels of peers named in the
     currently selected explain event; those tiles get an accent outline.
   ============================================================ */
import React, { useState } from 'react';
import PeerTile from './PeerTile.jsx';

// The hover tooltip card — shown at cursor position, not a child of the tile
// so it is never clipped by overflow:hidden on the tile.
function PeerHoverCard({ peer, pos }) {
  if (!peer || !pos) return null;

  // Position the card 14px to the right of the cursor, clamped to viewport
  const style = {
    left: Math.min(pos.x + 14, window.innerWidth - 240),
    top:  Math.min(pos.y + 14, window.innerHeight - 220),
  };

  const upKB   = peer.uploadCap   != null ? Math.round(peer.uploadCap)   : '?';
  const downKB = peer.downloadCap != null ? Math.round(peer.downloadCap) : '?';

  return (
    <div className="peer-hover-card" style={style}>
      <div className="hover-card-label">{peer.label}</div>
      <div>Tier: {peer.tier}</div>
      <div>{peer.behindNAT ? 'Behind NAT' : 'Public'}</div>
      <div>Upload: {upKB} KB/s</div>
      <div>Download: {downKB} KB/s</div>
      <div>Progress: {Math.round((peer.progress ?? 0) * 100)}%</div>
      {peer.waitingForPiece !== null && (
        <div>⏳ Waiting for piece {peer.waitingForPiece}</div>
      )}
    </div>
  );
}

// explainHighlightLabels defaults to an empty Set so callers that don't
// use Explanation mode can omit the prop without errors.
function PeerGrid({ peers, selectedPeerId, onSelectPeer, explainHighlightLabels = new Set() }) {
  // `hoveredPeer` = the peer object currently under the cursor
  const [hoveredPeer, setHoveredPeer] = useState(null);
  // `hoverPos`    = { x, y } in viewport coordinates
  const [hoverPos, setHoverPos]       = useState(null);

  // The set of ids we want to outline (the hovered peer's connections)
  const highlightIds = new Set(
    hoveredPeer ? hoveredPeer.connections.map(c => c.id) : []
  );

  function handleHover(peer, pos) {
    setHoveredPeer(peer);
    setHoverPos(pos);
  }

  function handleLeave() {
    setHoveredPeer(null);
    setHoverPos(null);
  }

  return (
    <div className="peer-grid-section">
      <div className="peer-grid">
        {peers.map(peer => (
          <PeerTile
            key={peer.id}
            peer={peer}
            highlighted={highlightIds.has(peer.id)}
            selected={peer.id === selectedPeerId}
            // True when this peer's label is in the explain event's peers list
            explainHighlight={explainHighlightLabels.has(peer.label)}
            onHover={handleHover}
            onLeave={handleLeave}
            onSelect={onSelectPeer}
          />
        ))}
      </div>

      {/* Tooltip is rendered outside the grid to avoid clipping */}
      <PeerHoverCard peer={hoveredPeer} pos={hoverPos} />
    </div>
  );
}

export default PeerGrid;
