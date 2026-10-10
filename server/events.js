// In-memory event log for explanation mode. Cleared with the peers; capped at 300.
const MAX_EVENTS = 300;

// The seven armable types: plain-words name plus the syllabus session each one illustrates.
const EVENT_TYPES = {
  connection: { name: 'A connection forms or is dropped', syllabus: 'Session 35: connection establishment, Sessions 25/27: admission control' },
  tunnel: { name: 'A tunnel forms or breaks', syllabus: 'Session 28: tunnelling' },
  unchoke: { name: 'Unchoke slots are re-assigned', syllabus: 'Sessions 25/27/36: traffic throttling, bandwidth allocation' },
  optimistic: { name: 'The optimistic slot rotates', syllabus: 'Session 36: fair bandwidth allocation' },
  'choke-drop': { name: 'In-flight transfers are dropped by a choke', syllabus: 'Sessions 25/27: traffic throttling' },
  stall: { name: 'A peer becomes stalled or recovers', syllabus: 'Session 26: scheduling (rarest-first)' },
  complete: { name: 'A peer completes the file', syllabus: 'Session 5: framing and error control (hash-verified pieces)' }
};

const events = [];   // oldest first; changed in place, never replaced
let nextId = 1;

// Record one event. `peers` is a list of peer labels; `message` is the finished sentence.
function recordEvent(type, fileId, peers, message) {
  if (!EVENT_TYPES[type]) {
    console.warn(`recordEvent: unknown type "${type}"`);
    return null;
  }
  const event = { id: nextId++, time: Date.now(), fileId: String(fileId), type, peers, message };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return event;
}

// Events for one file, optionally only those newer than `sinceId`.
function getEvents(fileId, sinceId = 0) {
  const fid = String(fileId);
  return events.filter((e) => e.fileId === fid && e.id > sinceId);
}

// Remove one file's events in place.
function clearEvents(fileId) {
  const fid = String(fileId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].fileId === fid) events.splice(i, 1);
  }
}

module.exports = { EVENT_TYPES, recordEvent, getEvents, clearEvents, MAX_EVENTS };