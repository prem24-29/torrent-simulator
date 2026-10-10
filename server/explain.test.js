const { setArmed, setPinned, setAll, getArmState, isKnown, triggerFromEvents, setPause, getPause, clearPause } = require('./explain');

beforeEach(() => { 
    setAll(false); 
    clearPause();
});

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

const ev = (id, type) => ({ id, type, peers: [], message: 'm' + id });

test('nothing armed means no pause', () => {
  expect(triggerFromEvents([ev(1, 'tunnel'), ev(2, 'stall')])).toEqual([]);
});

test('an armed type matches and unchecks itself', () => {
  setArmed('tunnel', true);
  const m = triggerFromEvents([ev(1, 'tunnel'), ev(2, 'stall')]);
  expect(m.map((e) => e.id)).toEqual([1]);
  expect(getArmState().tunnel.armed).toBe(false);
});

test('a pinned type matches and stays armed', () => {
  setPinned('stall', true);
  triggerFromEvents([ev(1, 'stall')]);
  expect(getArmState().stall.armed).toBe(true);
});

test('several armed types: all their events are returned in order', () => {
  setArmed('tunnel', true);
  setArmed('stall', true);
  const m = triggerFromEvents([ev(1, 'stall'), ev(2, 'connection'), ev(3, 'tunnel'), ev(4, 'stall')]);
  expect(m.map((e) => e.id)).toEqual([1, 3, 4]);
  expect(getArmState().tunnel.armed).toBe(false);
  expect(getArmState().stall.armed).toBe(false);
});

test('a type that did not fire stays armed', () => {
  setArmed('tunnel', true);
  setArmed('complete', true);
  triggerFromEvents([ev(1, 'tunnel')]);
  expect(getArmState().complete.armed).toBe(true);
});

test('pause record: first event is the headline, and it can be cleared', () => {
  setPause([ev(5, 'tunnel'), ev(6, 'stall')]);
  expect(getPause().headline.id).toBe(5);
  expect(getPause().events.length).toBe(2);
  clearPause();
  expect(getPause()).toBe(null);
});