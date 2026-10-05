const { getCandidatePeers } = require('./connections');

const makePeer = (id) => ({ _id: { toString: () => id } });

test('excludes the peer itself', () => {
  const a = makePeer('a');
  const all = [a, makePeer('b'), makePeer('c')];
  const result = getCandidatePeers(a, all);
  expect(result.map((p) => p._id.toString())).toEqual(['b', 'c']);
});

test('returns an empty list when alone in the swarm', () => {
  const a = makePeer('a');
  expect(getCandidatePeers(a, [a])).toEqual([]);
});

test('does not modify the original list', () => {
  const a = makePeer('a');
  const all = [a, makePeer('b')];
  getCandidatePeers(a, all);
  expect(all.length).toBe(2);
});

const { scoreCandidate, rankCandidates } = require('./connections');

const bits = (id, str) => ({
  _id: { toString: () => id },
  bitfield: str.split('').map((c) => c === '1')
});

test('score counts only pieces I miss and they hold', () => {
  const me = bits('me', '1100');
  const other = bits('o', '1011'); // has piece 2 and 3 that I lack; piece 0 I already have
  expect(scoreCandidate(me, other)).toBe(2);
});

test('score is 0 when they have nothing I need', () => {
  const me = bits('me', '1110');
  expect(scoreCandidate(me, bits('o', '1100'))).toBe(0);
});

test('rank orders by score, highest first', () => {
  const me = bits('me', '0000');
  const low = bits('low', '1000');
  const high = bits('high', '1110');
  const mid = bits('mid', '1100');
  const result = rankCandidates(me, [low, high, mid], 3);
  expect(result.map((p) => p._id.toString())).toEqual(['high', 'mid', 'low']);
});

test('rank breaks ties using the random source', () => {
  const me = bits('me', '00');
  const b = bits('b', '10');
  const c = bits('c', '01');
  const seq = [0.9, 0.1]; // b gets 0.9, c gets 0.1 -> c first
  let i = 0;
  const result = rankCandidates(me, [b, c], 2, () => seq[i++]);
  expect(result.map((p) => p._id.toString())).toEqual(['c', 'b']);
});

test('rank respects the limit', () => {
  const me = bits('me', '000');
  const all = [bits('a', '100'), bits('b', '110'), bits('c', '111')];
  expect(rankCandidates(me, all, 2).length).toBe(2);
});

test('rank leaves out useless candidates instead of padding', () => {
  const me = bits('me', '10');
  const useless = bits('u', '10');
  const useful = bits('f', '11');
  const result = rankCandidates(me, [useless, useful], 8);
  expect(result.map((p) => p._id.toString())).toEqual(['f']);
});

test('rank does not modify the original list', () => {
  const me = bits('me', '00');
  const all = [bits('a', '10'), bits('b', '11')];
  rankCandidates(me, all, 1);
  expect(all.length).toBe(2);
});