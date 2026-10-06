const { linkRate } = require('./bandwidth');

test('direct link is limited by the slower end', () => {
  expect(linkRate([{ cap: 400, pool: 1 }, { cap: 200, pool: 1 }])).toBe(200);
});

test('shares are split evenly across the pool', () => {
  expect(linkRate([{ cap: 400, pool: 4 }, { cap: 1600, pool: 1 }])).toBe(100);
});

test('a relay adds two more points to the path', () => {
  const rate = linkRate([
    { cap: 400, pool: 1 },   // sender upload
    { cap: 1600, pool: 1 },  // receiver download
    { cap: 150, pool: 1 },   // relay upload
    { cap: 600, pool: 1 }    // relay download
  ]);
  expect(rate).toBe(150);
});

test('a busy relay slows the tunnel', () => {
  const idle = linkRate([{ cap: 400, pool: 1 }, { cap: 150, pool: 1 }]);
  const busy = linkRate([{ cap: 400, pool: 1 }, { cap: 150, pool: 3 }]);
  expect(busy).toBeLessThan(idle);
  expect(busy).toBe(50);
});