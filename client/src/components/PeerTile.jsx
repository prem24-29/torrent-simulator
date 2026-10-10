/* ============================================================
   PeerTile.jsx
   A single square tile in the peer grid.
   - Background is always the idle colour (set in CSS).
   - A coloured div grows from the bottom to show `progress`.
   - Colour of the fill: gold = seeding, warn = stalled, pink = downloading.
   - Shows the peer label as small centred text (z-index above fill).
   - On hover: calls onHover with the peer + mouse position.
   - On click: calls onSelect with the peer id.
   - `highlighted` = true when this peer is in the hovered peer's connections.
   - `selected`    = true when this peer is the clicked (detail-view) peer.
   ============================================================ */
import React from 'react';

// Decide the fill colour from the peer's status and waitingForPiece flag.
// Only three signals: seeding=gold, stalled=warn, else pink.
function fillColor(peer) {
  if (peer.status === 'seeding')          return 'var(--gold)';
  if (peer.waitingForPiece !== null)      return 'var(--warn)';
  return 'var(--pink)';
}

function PeerTile({ peer, highlighted, selected, onHover, onLeave, onSelect }) {
  function handleMouseMove(e) {
    // Pass the peer data plus cursor position so the hover card can position itself
    onHover(peer, { x: e.clientX, y: e.clientY });
  }

  let className = 'peer-tile';
  if (highlighted) className += ' highlighted';
  if (selected)    className += ' selected';

  return (
    <div
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
      onClick={() => onSelect(peer.id)}
      title={peer.label}
    >
      {/* The filled portion — its height is progress × 100% */}
      <div
        className="peer-tile-fill"
        style={{
          height:          `${(peer.progress ?? 0) * 100}%`,
          backgroundColor: fillColor(peer),
        }}
      />
      {/* Label on top of the fill */}
      <span className="peer-tile-label">{peer.label}</span>
    </div>
  );
}

export default PeerTile;
