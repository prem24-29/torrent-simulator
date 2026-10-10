const { recordEvent, getEvents, clearEvents, MAX_EVENTS } = require('./events');

test('records an event and returns it for its file only', () => {
  clearEvents('f1'); clearEvents('f2');
  recordEvent('tunnel', 'f1', ['a', 'b'], 'a and b tunnel');
  recordEvent('tunnel', 'f2', ['c'], 'c');
  const list = getEvents('f1');
  expect(list.length).toBe(1);
  expect(list[0].peers).toEqual(['a', 'b']);
});

test('ids increase and sinceId filters', () => {
  clearEvents('f1');
  const a = recordEvent('stall', 'f1', ['a'], 'x');
  const b = recordEvent('stall', 'f1', ['a'], 'y');
  expect(b.id).toBeGreaterThan(a.id);
  expect(getEvents('f1', a.id).map((e) => e.id)).toEqual([b.id]);
});

test('unknown types are ignored', () => {
  clearEvents('f1');
  expect(recordEvent('nonsense', 'f1', [], 'x')).toBe(null);
  expect(getEvents('f1').length).toBe(0);
});

test('log is capped', () => {
  clearEvents('f1');
  for (let i = 0; i < MAX_EVENTS + 20; i++) recordEvent('complete', 'f1', [], 'e' + i);
  expect(getEvents('f1').length).toBe(MAX_EVENTS);
});

test('clear removes only that file', () => {
  clearEvents('f1'); clearEvents('f2');
  recordEvent('tunnel', 'f1', [], 'x');
  recordEvent('tunnel', 'f2', [], 'y');
  clearEvents('f1');
  expect(getEvents('f1').length).toBe(0);
  expect(getEvents('f2').length).toBe(1);
});