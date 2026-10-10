/* ============================================================
   AddPeerDialog.jsx
   Small form to add a single peer to the current file.
   - Role can be seeder, leecher, or random.
   - For "random" role, an optional "Pieces owned (%)" input
     (0–100) is shown; it is sent as `fill` (0–1 fraction).
     If left empty, `fill` is omitted so the server uses its
     default of 0.5.
   - For "random" tier/NAT, we omit those fields from the body
     (the backend decides).
   - Shows the server's error text on failure.
   Sends: POST /api/dev/add-peer
   ============================================================ */
import React, { useState } from 'react';

const API_BASE = 'http://localhost:5000';

function AddPeerDialog({ fileId, onClose }) {
  const [label,   setLabel]   = useState('');
  const [role,    setRole]    = useState('leecher');
  // fillPct is only used when role === 'random'. Empty string = omit from body.
  const [fillPct, setFillPct] = useState('50');
  const [tier,    setTier]    = useState('random');
  const [nat,     setNat]     = useState('random');
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!label.trim()) { setError('Label is required.'); return; }

    // Validate fill% only when role is random and the field is non-empty
    if (role === 'random' && fillPct !== '') {
      const n = Number(fillPct);
      if (isNaN(n) || n < 0 || n > 100) {
        setError('Pieces owned must be a number from 0 to 100.');
        return;
      }
    }

    // Build request body; omit tier/behindNAT when set to "random"
    const body = { fileId, label: label.trim(), role };
    if (tier !== 'random') body.tier = tier;
    if (nat  !== 'random') body.behindNAT = (nat === 'yes');

    // Add fill only for random role and only when a value is entered.
    // Convert percentage to a 0–1 fraction.
    if (role === 'random' && fillPct !== '') {
      body.fill = Number(fillPct) / 100;
    }

    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/dev/add-peer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // 409 = label taken, 400 = invalid; server sends { "error": "..." }
        setError(data.error || 'Unknown error');
      } else {
        setSuccess(`Peer "${data.peer.label}" added (${data.peer.tier}, ${data.peer.role}).`);
      }
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <h2>Add peer</h2>
        <form onSubmit={handleSubmit}>

          <div style={{ marginTop: 10 }}>
            <label>Label</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. late1"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="leecher">Leecher</option>
              <option value="seeder">Seeder</option>
              <option value="random">Random</option>
            </select>
            {/* Helper text shown only when random role is selected */}
            {role === 'random' && (
              <div className="modal-note" style={{ marginTop: 4 }}>
                Starts with a random subset of the pieces. Include a seeder in the swarm so every piece exists somewhere.
              </div>
            )}
          </div>

          {/* Fill percentage — only shown for random role */}
          {role === 'random' && (
            <div style={{ marginTop: 10 }}>
              <label>Pieces owned (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={fillPct}
                onChange={e => setFillPct(e.target.value)}
                placeholder="50"
              />
              <div className="modal-note">0 to 100. Leave empty to use the server default (50%).</div>
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <label>Tier</label>
            <select value={tier} onChange={e => setTier(e.target.value)}>
              <option value="random">Random</option>
              <option value="slow">Slow</option>
              <option value="medium">Medium</option>
              <option value="fast">Fast</option>
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Behind NAT?</label>
            <select value={nat} onChange={e => setNat(e.target.value)}>
              <option value="random">Random</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          {error   && <div className="modal-error">{error}</div>}
          {success && <div className="modal-success">{success}</div>}

          <div className="modal-row">
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Adding…' : 'Add peer'}
            </button>
            <button className="btn-ghost" type="button" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddPeerDialog;

