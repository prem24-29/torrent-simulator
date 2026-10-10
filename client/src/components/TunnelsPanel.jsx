/* ============================================================
   TunnelsPanel.jsx
   Displays a plain-English line for every active NAT tunnel.
   Format: "nat_seed ⇄ nat_leech via relay_pub"
   Data comes from the `tunnels` array in the live response.
   ============================================================ */
import React from 'react';

function TunnelsPanel({ tunnels }) {
  return (
    <div className="tunnels-panel card">
      <div className="tunnels-title">Tunnels</div>
      {/* tunnels-body has a fixed height and internal scroll so this panel
          never changes size regardless of how many tunnels exist */}
      <div className="tunnels-body">
        {tunnels && tunnels.length > 0 ? (
          tunnels.map((t, i) => (
            <div className="tunnel-line" key={i}>
              {t.aLabel} ⇄ {t.bLabel} via {t.relayLabel}
            </div>
          ))
        ) : (
          <div className="tunnels-empty">No tunnels right now.</div>
        )}
      </div>
    </div>
  );
}

export default TunnelsPanel;
