/* ============================================================
   ActivityFeed.jsx
   Shows the latest piece-transfer activity events (up to 10),
   newest first, with relative timestamps like "3s ago".
   Data is fetched separately from /api/tracker/:fileId/activity
   on each live refresh, then passed in as `logs`.
   ============================================================ */
import React from 'react';

// Converts an ISO timestamp to a short "Xs ago" / "Xm ago" string.
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function ActivityFeed({ logs }) {
  return (
    <div className="activity-feed">
      <div className="activity-feed-title">Piece activity</div>
      {(!logs || logs.length === 0) ? (
        <div className="activity-empty">No activity yet.</div>
      ) : (
        logs.map((log, i) => (
          // Using index as key is acceptable: the list is capped at 10
          // and always replaced wholesale, not individually keyed.
          <div className="activity-row" key={i}>
            <span>
              <strong>{log.toPeerLabel}</strong> received piece {log.pieceIndex} from{' '}
              <strong>{log.fromPeerLabel}</strong>
            </span>
            <span className="activity-time">{timeAgo(log.timestamp)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default ActivityFeed;
