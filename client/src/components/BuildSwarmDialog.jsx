/* ============================================================
   BuildSwarmDialog.jsx
   Dialog with add/remove rows for building a swarm scenario.
   Each row: label, role (seeder/leecher/random), tier, behind NAT, count.
   Rows with role "random" show an extra "Pieces owned (%)" input whose
   value is sent as `fill` (0–1 fraction). Fill is omitted for other roles.
   WARNING: This replaces all existing peers of this file.
   Pauses first (if running), sends POST /api/dev/scenario,
   then resumes if it was running before.
   ============================================================ */
import React, { useState } from 'react';
import { API_BASE } from '../apiConfig.js';

// Creates a blank row. `fillPct` is only used when role === 'random'.
function newRow() {
  return { label: '', role: 'leecher', tier: 'medium', behindNAT: false, count: 1, fillPct: '50' };
}

function BuildSwarmDialog({ fileId, wasRunning, onClose, onBuilt }) {
  const [rows, setRows]       = useState([newRow()]);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  // Update a single field in a single row by its index
  function updateRow(index, field, value) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, newRow()]);
  }

  function removeRow(index) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  async function handleBuild() {
    setError('');

    // Validate: all labels non-empty, counts >= 1, fill% in range for random rows
    for (const row of rows) {
      if (!row.label.trim()) { setError('All rows need a label.'); return; }
      if (Number(row.count) < 1) { setError('Count must be at least 1.'); return; }
      if (row.role === 'random' && row.fillPct !== '') {
        const n = Number(row.fillPct);
        if (isNaN(n) || n < 0 || n > 100) {
          setError(`Row "${row.label}": pieces owned must be 0 to 100.`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      // Step 1: pause if running
      if (wasRunning) {
        await fetch(`${API_BASE}/api/simulate/pause`, { method: 'POST' });
      }

      // Step 2: send the scenario
      const body = {
        fileId,
        groups: rows.map(r => {
          const group = {
            label:     r.label.trim(),
            role:      r.role,
            tier:      r.tier,
            behindNAT: r.behindNAT,
            count:     Number(r.count),
          };
          // Only include fill for random role, and only when a value is entered.
          // Convert the percentage to a 0–1 fraction.
          if (r.role === 'random' && r.fillPct !== '') {
            group.fill = Number(r.fillPct) / 100;
          }
          return group;
        }),
      };
      const res  = await fetch(`${API_BASE}/api/dev/scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Build failed.'); return; }

      // Step 3: resume if it was running before
      if (wasRunning) {
        await fetch(`${API_BASE}/api/simulate/resume`, { method: 'POST' });
      }

      onBuilt(); // tell parent to re-fetch live data
      onClose();
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" style={{ maxWidth: 700 }}>
        <h2>Build swarm</h2>
        <div className="build-swarm-warning">
          ⚠ This replaces all existing peers of this file.
        </div>

        {/* Column headers */}
        <div className="build-swarm-row" style={{ marginTop: 0 }}>
          <label>Label</label>
          <label>Role</label>
          <label>Pieces (%)</label>
          <label>Tier</label>
          <label>Behind NAT</label>
          <label>Count</label>
          <span />
        </div>

        {rows.map((row, i) => (
          <React.Fragment key={i}>
            <div className="build-swarm-row">
              <input
                type="text"
                value={row.label}
                onChange={e => updateRow(i, 'label', e.target.value)}
                placeholder="seed1"
              />
              <select value={row.role} onChange={e => updateRow(i, 'role', e.target.value)}>
                <option value="seeder">Seeder</option>
                <option value="leecher">Leecher</option>
                <option value="random">Random</option>
              </select>
              {row.role === 'random' ? (
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={row.fillPct}
                  onChange={e => updateRow(i, 'fillPct', e.target.value)}
                  placeholder="50"
                  title="Pieces owned (0-100%)"
                />
              ) : (
                <input
                  type="text"
                  disabled
                  value="—"
                  style={{ textAlign: 'center', opacity: 0.5, cursor: 'not-allowed' }}
                />
              )}
              <select value={row.tier} onChange={e => updateRow(i, 'tier', e.target.value)}>
                <option value="slow">Slow</option>
                <option value="medium">Medium</option>
                <option value="fast">Fast</option>
              </select>
              <select
                value={row.behindNAT ? 'yes' : 'no'}
                onChange={e => updateRow(i, 'behindNAT', e.target.value === 'yes')}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
              <input
                type="number"
                min="1"
                value={row.count}
                onChange={e => updateRow(i, 'count', e.target.value)}
              />
              <button
                className="build-swarm-remove-btn"
                onClick={() => removeRow(i)}
                title="Remove row"
                disabled={rows.length === 1}
              >
                ✕
              </button>
            </div>
            {row.role === 'random' && (
              <div className="modal-note" style={{ marginTop: 2, marginBottom: 6 }}>
                Starts with a random subset of the pieces. Include a seeder in the swarm so every piece exists somewhere.
              </div>
            )}
          </React.Fragment>
        ))}

        <button className="build-swarm-add-btn" onClick={addRow}>+ Add row</button>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-row">
          <button className="btn-primary" onClick={handleBuild} disabled={loading}>
            {loading ? 'Building…' : 'Build swarm'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default BuildSwarmDialog;
