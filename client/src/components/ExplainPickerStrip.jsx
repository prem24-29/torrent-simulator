/* ============================================================
   ExplainPickerStrip.jsx
   The compact strip shown directly under the header when
   Explanation mode is ON. It lists all 7 event types from
   GET /api/explain, each with an armed checkbox, a pin toggle,
   and the syllabus text as a subtitle.

   Design rule: the server is the source of truth. After every
   POST we receive a fresh `types` object in the response and
   pass it up to App.jsx via `onTypesUpdate`. We never keep a
   local copy of checked state.

   Props:
   - types       : the `types` map from the latest explain response
   - onTypesUpdate: callback(newTypes) – called after every POST
                    so App.jsx can update its explainData
   ============================================================ */
import React, { useState } from 'react';
import { API_BASE } from '../apiConfig.js';

// Helper: POST to an explain endpoint and call onTypesUpdate with the
// fresh types returned. Shows an error message on failure.
async function postExplain(path, body, setError, onTypesUpdate) {
  try {
    const res  = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Request failed.');
    } else {
      setError('');
      onTypesUpdate(data.types);
    }
  } catch {
    setError('Network error — is the server running?');
  }
}

function ExplainPickerStrip({ types, onTypesUpdate }) {
  const [error, setError] = useState('');

  // `types` is a plain object keyed by type id. Convert to an array so we
  // can render them in the order the server returns them (Object.entries
  // preserves insertion order in modern JS engines, which mirrors the server
  // response order).
  const typeEntries = Object.entries(types || {});

  // "Check all" — arms every type
  async function handleCheckAll() {
    await postExplain('/api/explain/arm-all', { armed: true }, setError, onTypesUpdate);
  }

  // "Uncheck all" — disarms every type and clears pins
  async function handleUncheckAll() {
    await postExplain('/api/explain/arm-all', { armed: false }, setError, onTypesUpdate);
  }

  // Toggle armed state for one type
  async function handleArmChange(typeKey, nowArmed) {
    await postExplain('/api/explain/arm', { type: typeKey, armed: nowArmed }, setError, onTypesUpdate);
  }

  // Toggle pinned state for one type
  async function handlePinToggle(typeKey, nowPinned) {
    await postExplain('/api/explain/pin', { type: typeKey, pinned: nowPinned }, setError, onTypesUpdate);
  }

  return (
    <div className="explain-strip">
      {/* Row of bulk actions */}
      <div className="explain-strip-actions">
        <button className="reciprocity-btn" onClick={handleCheckAll}>Check all</button>
        <button className="reciprocity-btn" onClick={handleUncheckAll}>Uncheck all</button>
      </div>

      {/* Grid of event-type items, wrapping into at most ~2 rows */}
      <div className="explain-strip-grid">
        {typeEntries.map(([key, t]) => (
          <div className="explain-type-item" key={key}>
            <div className="explain-type-top">
              {/* Armed checkbox */}
              <input
                type="checkbox"
                id={`explain-arm-${key}`}
                checked={!!t.armed}
                onChange={e => handleArmChange(key, e.target.checked)}
              />
              {/* Type name as label tied to the checkbox */}
              <label
                htmlFor={`explain-arm-${key}`}
                className="explain-type-name"
                style={{ margin: 0 }}
              >
                {t.name}
              </label>

              {/* Pin toggle — stays armed even after it has paused once */}
              <button
                className={`explain-pin-btn${t.pinned ? ' pinned' : ''}`}
                onClick={() => handlePinToggle(key, !t.pinned)}
                title="Stay armed even after it has paused the swarm once"
              >
                📌 Keep armed
              </button>
            </div>

            {/* Syllabus reference in small muted text */}
            <div className="explain-syllabus">{t.syllabus}</div>

            {/* Warn when a noisy type is armed or pinned — it will pause often */}
            {t.noisy && (t.armed || t.pinned) && (
              <div className="explain-noisy-note">
                This happens often and will pause the swarm frequently.
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="explain-strip-error">{error}</div>}
    </div>
  );
}

export default ExplainPickerStrip;
