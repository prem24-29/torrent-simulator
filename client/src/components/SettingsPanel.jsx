/* ============================================================
   SettingsPanel.jsx
   Settings modal showing all 6 config parameters.
   Opens GET /api/config when panel opens (because only that
   endpoint has `unchokeSlotsIsOverridden`). Each setting has
   its own input + Apply button that POST to its own endpoint.
   Shows the server's `error` field if validation fails.
   ============================================================ */
import React, { useState, useEffect } from 'react';
import { API_BASE } from '../apiConfig.js';

// A single settings field with label, input, apply button and optional note.
// `toMs` = multiply value by 1000 before sending (for interval fields shown in seconds).
// `min`  = minimum allowed value (in the units shown to the user).
function SettingField({ label, endpoint, value, setValue, toMs, min, note, children }) {
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);

  async function handleApply() {
    setError('');
    setSaved(false);
    // Validate minimum
    const num = Number(value);
    if (isNaN(num) || !Number.isInteger(num) || num < min) {
      setError(`Must be a whole number ≥ ${min}${toMs ? ' seconds' : ''}.`);
      return;
    }
    const wire = toMs ? num * 1000 : num;

    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/config/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: wire }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Server error.');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-field">
      <label>{label}{toMs ? ' (seconds)' : ''}</label>
      <div className="settings-input-row">
        <input
          type="number"
          min={min}
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); setSaved(false); }}
        />
        <button className="btn-primary" onClick={handleApply} disabled={loading}>
          {loading ? '…' : saved ? '✓' : 'Apply'}
        </button>
        {/* Extra controls (e.g. "Back to automatic") */}
        {children}
      </div>
      {error && <div className="modal-error">{error}</div>}
      {note  && <div className="modal-note">{note}</div>}
    </div>
  );
}

function SettingsPanel({ onClose }) {
  // Local state for each config value
  const [connLimit,     setConnLimit]     = useState('');
  const [unchokeSlots,  setUnchokeSlots]  = useState('');
  const [unchokeAuto,   setUnchokeAuto]   = useState(false); // true = server controls it
  const [chokeMs,       setChokeMs]       = useState('');
  const [optimisticMs,  setOptimisticMs]  = useState('');
  const [reshuffleMs,   setReshuffleMs]   = useState('');
  const [maxDl,         setMaxDl]         = useState('');

  const [unchokeError, setUnchokeError] = useState('');
  const [unchokeLoading, setUnchokeLoading] = useState(false);

  // Fetch current config when the panel opens.
  // We use /api/config (not /api/live) because only it has `unchokeSlotsIsOverridden`.
  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then(cfg => {
        setConnLimit(String(cfg.connectionLimit));
        // If the server controls unchoke slots, show "automatic" in the input
        setUnchokeAuto(!cfg.unchokeSlotsIsOverridden);
        setUnchokeSlots(cfg.unchokeSlotsIsOverridden ? String(cfg.unchokeSlots) : '');
        // Intervals are stored in ms; convert to seconds for display
        setChokeMs(String(cfg.chokeIntervalMs / 1000));
        setOptimisticMs(String(cfg.optimisticIntervalMs / 1000));
        setReshuffleMs(String(cfg.reshuffleIntervalMs / 1000));
        setMaxDl(String(cfg.maxConcurrentDownloads));
      });
  }, []);

  // Send { value: null } to hand control back to the server
  async function handleUnchokeAutomatic() {
    setUnchokeError('');
    setUnchokeLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/config/unchoke-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUnchokeError(data.error || 'Server error.');
      } else {
        setUnchokeAuto(true);
        setUnchokeSlots('');
      }
    } catch {
      setUnchokeError('Network error.');
    } finally {
      setUnchokeLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <h2>Settings</h2>

        <SettingField
          label="Connection limit"
          endpoint="connection-limit"
          value={connLimit}
          setValue={setConnLimit}
          min={1}
          note="Applies at each peer's next reshuffle."
        />

        {/* Unchoke slots has an extra "Back to automatic" button */}
        <div className="settings-field">
          <label>Unchoke slots</label>
          <div className="settings-input-row">
            <input
              type={unchokeAuto ? 'text' : 'number'}
              min={1}
              value={unchokeAuto ? 'automatic' : unchokeSlots}
              onChange={e => {
                setUnchokeAuto(false);
                setUnchokeSlots(e.target.value);
                setUnchokeError('');
              }}
              readOnly={unchokeAuto}
              placeholder={unchokeAuto ? 'automatic' : ''}
            />
            {/* Apply button for unchoke-slots (with manual validation) */}
            <button
              className="btn-primary"
              disabled={unchokeAuto || unchokeLoading}
              onClick={async () => {
                setUnchokeError('');
                const n = Number(unchokeSlots);
                if (!Number.isInteger(n) || n < 1) {
                  setUnchokeError('Must be a whole number ≥ 1.');
                  return;
                }
                setUnchokeLoading(true);
                try {
                  const res  = await fetch(`${API_BASE}/api/config/unchoke-slots`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: n }),
                  });
                  const data = await res.json();
                  if (!res.ok) setUnchokeError(data.error || 'Server error.');
                  else setUnchokeAuto(false);
                } catch { setUnchokeError('Network error.'); }
                finally { setUnchokeLoading(false); }
              }}
            >
              {unchokeLoading ? '…' : 'Apply'}
            </button>
            <button
              className="btn-ghost"
              onClick={handleUnchokeAutomatic}
              disabled={unchokeAuto || unchokeLoading}
              title="Let the server decide based on tier speeds"
            >
              Automatic
            </button>
          </div>
          {unchokeError && <div className="modal-error">{unchokeError}</div>}
        </div>

        <SettingField
          label="Choke interval"
          endpoint="choke-interval"
          value={chokeMs}
          setValue={setChokeMs}
          toMs
          min={1}   /* min 500 ms = 0.5 s; we validate in seconds so ≥ 1 keeps it simple */
          note="Minimum 500 ms. Applies at each peer's next re-choke."
        />

        <SettingField
          label="Optimistic unchoke interval"
          endpoint="optimistic-interval"
          value={optimisticMs}
          setValue={setOptimisticMs}
          toMs
          min={1}
          note="Minimum 1000 ms."
        />

        <SettingField
          label="Reshuffle interval"
          endpoint="reshuffle-interval"
          value={reshuffleMs}
          setValue={setReshuffleMs}
          toMs
          min={1}
          note="Minimum 1000 ms."
        />

        <SettingField
          label="Max concurrent downloads"
          endpoint="max-downloads"
          value={maxDl}
          setValue={setMaxDl}
          min={1}
        />

        <div className="modal-row">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
