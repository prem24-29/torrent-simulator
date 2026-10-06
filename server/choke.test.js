const { isInterested, filterInterested, pickRandomUnchoked, pickByReciprocity, pickByLinkRate, pickOptimistic } = require('./choke');

const named = (label, str) => ({ ...bits(label, str), peerLabel: label });

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

test('unchoke picks only interested connections', () => {
  const me = bits('me', '110');
  const wants = bits('w', '000');
  const full = bits('f', '111');
  const result = pickRandomUnchoked(me, [wants, full], 4);
  expect(result.map((p) => p._id.toString())).toEqual(['w']);
});

test('unchoke respects the slot count', () => {
  const me = bits('me', '11');
  const all = [bits('a', '00'), bits('b', '00'), bits('c', '00')];
  expect(pickRandomUnchoked(me, all, 2).length).toBe(2);
});

test('unchoke does not modify the original list', () => {
  const me = bits('me', '11');
  const all = [bits('a', '00'), bits('b', '00')];
  pickRandomUnchoked(me, all, 1);
  expect(all.length).toBe(2);
});

test('reciprocity ranks the biggest senders first', () => {
  const me = named('me', '11');
  const a = named('a', '00');
  const b = named('b', '00');
  const c = named('c', '00');
  const result = pickByReciprocity(me, [a, b, c], 2, { a: 16384, b: 49152, c: 0 });
  expect(result.map((p) => p.peerLabel)).toEqual(['b', 'a']);
});

test('reciprocity skips uninterested connections even if they sent a lot', () => {
  const me = named('me', '10');
  const full = named('full', '11');
  const needy = named('needy', '00');
  const result = pickByReciprocity(me, [full, needy], 2, { full: 99999, needy: 0 });
  expect(result.map((p) => p.peerLabel)).toEqual(['needy']);
});

test('reciprocity breaks ties with the random source', () => {
  const me = named('me', '11');
  const a = named('a', '00');
  const b = named('b', '00');
  const seq = [0.9, 0.1]; // a gets 0.9, b gets 0.1 -> b first
  let i = 0;
  const result = pickByReciprocity(me, [a, b], 2, {}, () => seq[i++]);
  expect(result.map((p) => p.peerLabel)).toEqual(['b', 'a']);
});

test('reciprocity respects the slot count', () => {
  const me = named('me', '11');
  const all = [named('a', '00'), named('b', '00'), named('c', '00')];
  expect(pickByReciprocity(me, all, 1, {}).length).toBe(1);
});

test('link rate ranks the fastest receivers first', () => {
  const seeder = bits('s', '11');
  const slow = bits('slow', '00');
  const fast = bits('fast', '00');
  const caps = {
    s: { uploadCap: 400 },
    slow: { downloadCap: 100 },
    fast: { downloadCap: 300 }
  };
  const result = pickByLinkRate(seeder, [slow, fast], 2, caps);
  expect(result.map((p) => p._id.toString())).toEqual(['fast', 'slow']);
});

test('link rate is limited by the seeder upload, so fast receivers tie', () => {
  const seeder = bits('s', '11');
  const a = bits('a', '00');
  const b = bits('b', '00');
  const caps = { s: { uploadCap: 50 }, a: { downloadCap: 200 }, b: { downloadCap: 1600 } };
  const seq = [0.9, 0.1]; // a gets 0.9, b gets 0.1 -> b first
  let i = 0;
  const result = pickByLinkRate(seeder, [a, b], 2, caps, () => seq[i++]);
  expect(result.map((p) => p._id.toString())).toEqual(['b', 'a']);
});

test('link rate skips uninterested connections', () => {
  const seeder = bits('s', '10');
  const full = bits('full', '11');
  const needy = bits('needy', '00');
  const caps = { s: { uploadCap: 400 }, full: { downloadCap: 1600 }, needy: { downloadCap: 200 } };
  const result = pickByLinkRate(seeder, [full, needy], 2, caps);
  expect(result.map((p) => p._id.toString())).toEqual(['needy']);
});

test('link rate respects the slot count', () => {
  const seeder = bits('s', '11');
  const all = [bits('a', '00'), bits('b', '00'), bits('c', '00')];
  const caps = { s: { uploadCap: 400 }, a: { downloadCap: 1 }, b: { downloadCap: 2 }, c: { downloadCap: 3 } };
  expect(pickByLinkRate(seeder, all, 2, caps).length).toBe(2);
});

test('optimistic picks an interested connection', () => {
  const me = bits('me', '11');
  const a = bits('a', '00');
  expect(pickOptimistic(me, [a], []).toString).toBeDefined();
  expect(pickOptimistic(me, [a], [])._id.toString()).toBe('a');
});

test('optimistic skips connections already unchoked', () => {
  const me = bits('me', '11');
  const a = bits('a', '00');
  const b = bits('b', '00');
  expect(pickOptimistic(me, [a, b], ['a'])._id.toString()).toBe('b');
});

test('optimistic skips uninterested connections', () => {
  const me = bits('me', '10');
  const full = bits('full', '11');
  expect(pickOptimistic(me, [full], [])).toBe(null);
});

test('optimistic returns null when nothing is left to pick', () => {
  const me = bits('me', '11');
  const a = bits('a', '00');
  expect(pickOptimistic(me, [a], ['a'])).toBe(null);
});

test('optimistic uses the random source', () => {
  const me = bits('me', '11');
  const all = [bits('a', '00'), bits('b', '00')];
  expect(pickOptimistic(me, all, [], () => 0.99)._id.toString()).toBe('b');
  expect(pickOptimistic(me, all, [], () => 0)._id.toString()).toBe('a');
});

const { isServing } = require('./choke');

test('serving when the receiver is in the unchoke set', () => {
  expect(isServing('s', 'r', { s: ['r'] }, {})).toBe(true);
});

test('serving when the receiver is the optimistic target', () => {
  expect(isServing('s', 'r', { s: [] }, { s: { target: 'r' } })).toBe(true);
});

test('not serving when the receiver is in neither', () => {
  expect(isServing('s', 'r', { s: ['x'] }, { s: { target: 'y' } })).toBe(false);
});

test('not serving when the sender has no entries at all', () => {
  expect(isServing('s', 'r', {}, {})).toBe(false);
});