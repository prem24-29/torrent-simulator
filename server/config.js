// Runtime-adjustable settings. In memory only, reset on server restart.
const config = {
  connectionLimit: 8,
  unchokeSlotsOverride: null,   // null = derived from connectionLimit
  chokeIntervalMs: 10000,
  maxConcurrentDownloads: 4
};

// Derived unchoke slots, unless a manual value has been set.
function getUnchokeSlots() {
  if (config.unchokeSlotsOverride !== null) return config.unchokeSlotsOverride;
  return Math.min(4, Math.ceil(config.connectionLimit / 2));
}

module.exports = { config, getUnchokeSlots };