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