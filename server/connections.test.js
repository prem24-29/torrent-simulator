const { getCandidatePeers } = require('./connections');
const { formConnections, reshufflePeer } = require('./connections');
const { scoreCandidate, rankCandidates } = require('./connections');

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

test('links are symmetric', () => {
  const peers = [bits('a', '00'), bits('b', '10'), bits('c', '01')];
  const conns = formConnections(peers, 8);
  for (const id of Object.keys(conns)) {
    for (const other of conns[id]) expect(conns[other]).toContain(id);
  }
});

test('no peer exceeds the limit', () => {
  const peers = [];
  for (let i = 0; i < 10; i++) peers.push(bits('p' + i, i === 0 ? '1111' : '0000'));
  const conns = formConnections(peers, 3);
  for (const id of Object.keys(conns)) expect(conns[id].length).toBeLessThanOrEqual(3);
});

test('no self links and no duplicates', () => {
  const peers = [bits('a', '00'), bits('b', '11'), bits('c', '10')];
  const conns = formConnections(peers, 8);
  for (const id of Object.keys(conns)) {
    expect(conns[id]).not.toContain(id);
    expect(new Set(conns[id]).size).toBe(conns[id].length);
  }
});

test('peers with nothing to offer each other stay unconnected', () => {
  const peers = [bits('a', '11'), bits('b', '11')];
  const conns = formConnections(peers, 8);
  expect(conns['a']).toEqual([]);
  expect(conns['b']).toEqual([]);
});

test('reshuffle keeps links symmetric and capped', () => {
  const peers = [bits('a', '00'), bits('b', '10'), bits('c', '01'), bits('d', '11')];
  const conns = formConnections(peers, 2);
  reshufflePeer(peers[0], peers, conns, 2);
  for (const id of Object.keys(conns)) {
    expect(conns[id].length).toBeLessThanOrEqual(2);
    for (const other of conns[id]) expect(conns[other]).toContain(id);
  }
});

test('reshuffle never links a peer to itself', () => {
  const peers = [bits('a', '00'), bits('b', '11')];
  const conns = formConnections(peers, 8);
  reshufflePeer(peers[0], peers, conns, 8);
  expect(conns['a']).not.toContain('a');
});

const { canConnectDirectly } = require('./connections');

const nat = (id, str) => ({ ...bits(id, str), behindNAT: true });

test('two NATd peers cannot connect directly', () => {
  expect(canConnectDirectly(nat('a', '0'), nat('b', '1'))).toBe(false);
});

test('NATd to public, and public to public, can connect', () => {
  expect(canConnectDirectly(nat('a', '0'), bits('p', '1'))).toBe(true);
  expect(canConnectDirectly(bits('p', '1'), bits('q', '0'))).toBe(true);
});

test('formation never links two NATd peers', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('c', '11')];
  const conns = formConnections(peers, 8);
  expect(conns['a']).not.toContain('b');
  expect(conns['b']).not.toContain('a');
  expect(conns['a']).toContain('c');
});

test('reshuffle never links two NATd peers', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('c', '11')];
  const conns = formConnections(peers, 8);
  reshufflePeer(peers[0], peers, conns, 8);
  expect(conns['a']).not.toContain('b');
  expect(conns['b']).not.toContain('a');
});

const { findRelay } = require('./connections');

const P = (nat) => ({ behindNAT: nat });

test('relay is a public peer both are connected to', () => {
  const conns = { a: ['r'], b: ['r'], r: ['a', 'b'] };
  const byId = { a: P(true), b: P(true), r: P(false) };
  expect(findRelay('a', 'b', conns, byId)).toBe('r');
});

test('no relay when there is no mutual connection', () => {
  const conns = { a: ['r1'], b: ['r2'] };
  const byId = { a: P(true), b: P(true), r1: P(false), r2: P(false) };
  expect(findRelay('a', 'b', conns, byId)).toBe(null);
});

test('a NATd mutual connection cannot relay', () => {
  const conns = { a: ['n'], b: ['n'] };
  const byId = { a: P(true), b: P(true), n: P(true) };
  expect(findRelay('a', 'b', conns, byId)).toBe(null);
});

test('relay uses the random source when several qualify', () => {
  const conns = { a: ['r1', 'r2'], b: ['r1', 'r2'] };
  const byId = { a: P(true), b: P(true), r1: P(false), r2: P(false) };
  expect(findRelay('a', 'b', conns, byId, () => 0)).toBe('r1');
  expect(findRelay('a', 'b', conns, byId, () => 0.99)).toBe('r2');
});

test('no relay when either peer has no connections', () => {
  const byId = { a: P(true), b: P(true) };
  expect(findRelay('a', 'b', {}, byId)).toBe(null);
});

const { tunnelKey, pruneTunnels, formTunnels } = require('./connections');

test('tunnel key ignores order', () => {
  expect(tunnelKey('a', 'b')).toBe(tunnelKey('b', 'a'));
});

test('two NATd peers get a tunnel through a shared public peer', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('r', '11')];
  const conns = { a: ['r'], b: ['r'], r: ['a', 'b'] };
  const tunnels = {};
  formTunnels(peers, conns, tunnels, 8);
  expect(conns['a']).toContain('b');
  expect(conns['b']).toContain('a');
  expect(tunnels['a|b']).toBe('r');
  expect(conns['r']).toEqual(['a', 'b']); // the relay spends no extra slot
});

test('no tunnel without a mutual public peer', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('r', '11')];
  const conns = { a: ['r'], b: [], r: ['a'] };
  const tunnels = {};
  formTunnels(peers, conns, tunnels, 8);
  expect(conns['a']).not.toContain('b');
  expect(tunnels).toEqual({});
});

test('no tunnel when the first peer is at the limit', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('r', '11'), bits('x', '11')];
  const conns = { a: ['r', 'x'], b: ['r'], r: ['a', 'b'], x: ['a'] };
  const tunnels = {};
  formTunnels(peers, conns, tunnels, 2);
  expect(tunnels).toEqual({});
});

test('no tunnel when the other peer is at the limit', () => {
  const peers = [nat('a', '00'), nat('b', '11'), bits('r', '11'), bits('y', '11')];
  const conns = { a: ['r'], b: ['r', 'y'], r: ['a', 'b'], y: ['b'] };
  const tunnels = {};
  formTunnels(peers, conns, tunnels, 2);
  expect(tunnels).toEqual({});
});

test('prune keeps a tunnel that still holds', () => {
  const conns = { a: ['r', 'b'], b: ['r', 'a'], r: ['a', 'b'] };
  const tunnels = { 'a|b': 'r' };
  pruneTunnels(conns, tunnels);
  expect(tunnels['a|b']).toBe('r');
  expect(conns['a']).toContain('b');
});

test('prune removes a tunnel whose relay link is gone, and the link entries', () => {
  const conns = { a: ['b'], b: ['a'], r: [] };
  const tunnels = { 'a|b': 'r' };
  pruneTunnels(conns, tunnels);
  expect(tunnels).toEqual({});
  expect(conns['a']).toEqual([]);
  expect(conns['b']).toEqual([]);
});