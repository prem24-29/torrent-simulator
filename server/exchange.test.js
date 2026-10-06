const { countPieceFrequency, pickRarestPiece, findWaitingPiece } = require('./exchange');

const peerWith = (str) => ({ bitfield: str.split('').map((c) => c === '1') });

test('frequency counts only the peers it is given', () => {
  const connections = [peerWith('1100'), peerWith('1000')];
  expect(countPieceFrequency(connections, 4)).toEqual([2, 1, 0, 0]);
});

test('frequency is all zeros with no connections', () => {
  expect(countPieceFrequency([], 3)).toEqual([0, 0, 0]);
});

test('rarest piece wins among the wanted ones', () => {
  const freq = [3, 1, 2];
  expect(pickRarestPiece([0, 1, 2], freq)).toBe(1);
});

test('only wanted pieces are considered', () => {
  const freq = [3, 1, 2];
  expect(pickRarestPiece([0, 2], freq)).toBe(2);
});

test('local view can disagree with the swarm view', () => {
  const swarm = [peerWith('10'), peerWith('10'), peerWith('01')];
  const swarmFreq = countPieceFrequency(swarm, 2); // [2, 1]: piece 1 is rarest swarm-wide
  const myConns = [swarm[0], swarm[1]];            // I only see two peers
  const localFreq = countPieceFrequency(myConns, 2); // [2, 0]

  expect(pickRarestPiece([0, 1], swarmFreq)).toBe(1);
  expect(pickRarestPiece([0, 1], localFreq)).toBe(1); // 0 holders locally
  expect(localFreq[1]).toBe(0);
});

test('not waiting when a connection holds a piece I miss', () => {
  expect(findWaitingPiece(peerWith('10'), [peerWith('01')], 2)).toBe(null);
});

test('waiting when no connection holds anything I miss', () => {
  expect(findWaitingPiece(peerWith('10'), [peerWith('10')], 2)).toBe(1);
});

test('waiting when I have no connections at all', () => {
  expect(findWaitingPiece(peerWith('00'), [], 2)).toBe(0);
});

test('not waiting once I have every piece', () => {
  expect(findWaitingPiece(peerWith('11'), [], 2)).toBe(null);
});