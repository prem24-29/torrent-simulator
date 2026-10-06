const { isInterested, filterInterested } = require('./choke');

const bits = (id, str) => ({
  _id: { toString: () => id },
  bitfield: str.split('').map((c) => c === '1')
});

test('interested when I hold a piece they miss', () => {
  expect(isInterested(bits('me', '10'), bits('o', '00'))).toBe(true);
});

test('not interested when they already have everything I have', () => {
  expect(isInterested(bits('me', '10'), bits('o', '11'))).toBe(false);
});

test('a peer with nothing is never interesting to others', () => {
  expect(isInterested(bits('me', '00'), bits('o', '00'))).toBe(false);
});

test('interest is one-directional', () => {
  const a = bits('a', '10');
  const b = bits('b', '01');
  expect(isInterested(a, b)).toBe(true);
  expect(isInterested(b, a)).toBe(true);
  const seeder = bits('s', '11');
  const leecher = bits('l', '10');
  expect(isInterested(seeder, leecher)).toBe(true);
  expect(isInterested(leecher, seeder)).toBe(false);
});

test('filter keeps only the interested connections', () => {
  const me = bits('me', '110');
  const wants = bits('w', '000');
  const full = bits('f', '111');
  const result = filterInterested(me, [wants, full]);
  expect(result.map((p) => p._id.toString())).toEqual(['w']);
});

test('filter does not modify the original list', () => {
  const me = bits('me', '10');
  const all = [bits('a', '00'), bits('b', '11')];
  filterInterested(me, all);
  expect(all.length).toBe(2);
});