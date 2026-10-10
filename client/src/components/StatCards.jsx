/* ============================================================
   StatCards.jsx
   Shows 6 summary numbers (Peers, Seeders, Leechers, etc.)
   in a row of cards. The numbers come from the `summary`
   field of the live API response.
   ============================================================ */
import React from 'react';

// Each card is just a label + big number.
function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <span className="stat-card-label">{label}</span>
      <span className="stat-card-value">{value ?? '—'}</span>
    </div>
  );
}

// StatCards receives the whole `summary` object from the live response.
function StatCards({ summary }) {
  if (!summary) return null;
  return (
    <div className="stat-cards">
      <StatCard label="Peers"          value={summary.totalPeers} />
      <StatCard label="Seeders"        value={summary.seeders} />
      <StatCard label="Leechers"       value={summary.leechers} />
      <StatCard label="Completion %"   value={summary.completionPercent + '%'} />
      <StatCard label="Active xfers"   value={summary.activeTransfers} />
      <StatCard label="Tunnels"        value={summary.tunnelCount} />
    </div>
  );
}

export default StatCards;
