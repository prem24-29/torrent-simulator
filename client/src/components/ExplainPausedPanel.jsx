/* ============================================================
   ExplainPausedPanel.jsx
   Fixed-to-bottom panel shown whenever the simulation is paused
   by an explanation event (`paused` is not null).

   It does NOT push other content — it sits over the page at the
   bottom of the viewport. App.jsx adds extra padding-bottom to
   the page when this panel is visible so the activity feed is
   not hidden behind it.

   Props:
   - paused          : the `paused` object from the explain response
                       (null = hidden)
   - types           : the `types` map for looking up names/syllabus
   - selectedEventId : which event's peers are highlighted in the grid
   - onSelectEvent   : callback(event) — called when the user clicks a row
   - onContinue      : callback() — called after POST /api/explain/continue
   ============================================================ */
import React, { useState } from 'react';

const API_BASE = 'http://localhost:5000';

function ExplainPausedPanel({ paused, types, selectedEventId, onSelectEvent, onContinue }) {
  const [continueError, setContinueError] = useState('');
  const [loading,       setLoading]       = useState(false);

  // Panel is only rendered when `paused` is not null
  if (!paused) return null;

  const { headline, events } = paused;
  // Look up the headline type's syllabus for the title line
  const headlineType = types?.[headline.type] ?? {};

  async function handleContinue() {
    setLoading(true);
    setContinueError('');
    try {
      const res  = await fetch(`${API_BASE}/api/explain/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setContinueError(data.error || 'Continue failed.');
      } else {
        onContinue(data); // pass the full response so App.jsx can update state
      }
    } catch {
      setContinueError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="explain-paused-panel">
      {/* Title: type name + syllabus tag */}
      <div className="explain-paused-title">
        Simulation paused: {headlineType.name ?? headline.type}
      </div>
      {headlineType.syllabus && (
        <div className="explain-paused-syllabus">{headlineType.syllabus}</div>
      )}

      {/* The headline event's message in larger type */}
      <div className="explain-paused-message">{headline.message}</div>

      {/* List of all matching events if there are more than one */}
      {events && events.length > 1 && (
        <>
          <div className="explain-events-title">
            Everything that happened in this round ({events.length} events)
          </div>
          {events.map(ev => {
            const evType = types?.[ev.type] ?? {};
            const isActive = ev.id === selectedEventId;
            return (
              <div
                key={ev.id}
                className={`explain-event-row${isActive ? ' active-event' : ''}`}
                onClick={() => onSelectEvent(ev)}
              >
                {/* Short type tag on the left */}
                <span className="explain-event-type-tag">{evType.name ?? ev.type}</span>
                <span>{ev.message}</span>
              </div>
            );
          })}
        </>
      )}

      {/* Footer: Continue button + any error */}
      <div className="explain-paused-footer">
        <button className="btn-primary" onClick={handleContinue} disabled={loading}>
          {loading ? 'Continuing…' : 'Continue'}
        </button>
        {continueError && (
          <span style={{ color: 'var(--warn)', fontSize: '0.8rem' }}>{continueError}</span>
        )}
      </div>
    </div>
  );
}

export default ExplainPausedPanel;
