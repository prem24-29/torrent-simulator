const { setArmed, setPinned, setAll, getArmState, isKnown } = require('./explain');

beforeEach(() => setAll(false));

test('everything starts unarmed and unpinned', () => {
  const s = getArmState();
  for (const t of Object.keys(s)) {
    expect(s[t].armed).toBe(false);
    expect(s[t].pinned).toBe(false);
  }
});

test('arming one type leaves the others alone', () => {
  setArmed('tunnel', true);
  const s = getArmState();
  expect(s.tunnel.armed).toBe(true);
  expect(s.stall.armed).toBe(false);
});

test('pinning arms the type', () => {
  setPinned('tunnel', true);
  const s = getArmState();
  expect(s.tunnel.armed).toBe(true);
  expect(s.tunnel.pinned).toBe(true);
});

test('disarming a pinned type unpins it', () => {
  setPinned('tunnel', true);
  setArmed('tunnel', false);
  const s = getArmState();
  expect(s.tunnel.armed).toBe(false);
  expect(s.tunnel.pinned).toBe(false);
});

test('check all arms everything and keeps pins', () => {
  setPinned('stall', true);
  setAll(true);
  const s = getArmState();
  expect(Object.values(s).every((x) => x.armed)).toBe(true);
  expect(s.stall.pinned).toBe(true);
});

test('uncheck all disarms everything and clears pins', () => {
  setPinned('stall', true);
  setAll(false);
  const s = getArmState();
  expect(Object.values(s).every((x) => !x.armed && !x.pinned)).toBe(true);
});

test('unknown types are rejected', () => {
  expect(isKnown('nonsense')).toBe(false);
  expect(setArmed('nonsense', true)).toBe(false);
  expect(setPinned('nonsense', true)).toBe(false);
});

test('frequent types are flagged noisy', () => {
  const s = getArmState();
  expect(s.unchoke.noisy).toBe(true);
  expect(s.tunnel.noisy).toBe(false);
});