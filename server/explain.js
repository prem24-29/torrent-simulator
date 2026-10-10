// Explanation mode: which event types are armed (pause when they happen) and pinned (stay armed).
const { EVENT_TYPES } = require('./events');

// Types that fire often. Armed or pinned, they can pause the swarm every few seconds.
const NOISY = ['connection', 'unchoke', 'optimistic'];

const arm = {};   // type -> { armed, pinned }; changed in place, never replaced
for (const t of Object.keys(EVENT_TYPES)) arm[t] = { armed: false, pinned: false };

function isKnown(type) {
  return Object.prototype.hasOwnProperty.call(arm, type);
}

// Arm or disarm one type. Disarming also unpins it.
function setArmed(type, armed) {
  if (!isKnown(type)) return false;
  arm[type].armed = armed;
  if (!armed) arm[type].pinned = false;
  return true;
}

// Pin or unpin one type. Pinning also arms it.
function setPinned(type, pinned) {
  if (!isKnown(type)) return false;
  arm[type].pinned = pinned;
  if (pinned) arm[type].armed = true;
  return true;
}

// Check all (armed = true, pins unchanged) or uncheck all (armed = false, pins cleared).
function setAll(armed) {
  for (const t of Object.keys(arm)) setArmed(t, armed);
}

// A copy for the dashboard: names, syllabus tags, flags.
function getArmState() {
  const out = {};
  for (const t of Object.keys(arm)) {
    out[t] = {
      name: EVENT_TYPES[t].name,
      syllabus: EVENT_TYPES[t].syllabus,
      armed: arm[t].armed,
      pinned: arm[t].pinned,
      noisy: NOISY.includes(t)
    };
  }
  return out;
}

module.exports = { setArmed, setPinned, setAll, getArmState, isKnown };