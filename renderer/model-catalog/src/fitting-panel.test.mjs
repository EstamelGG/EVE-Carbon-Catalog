import test from 'node:test';
import assert from 'node:assert/strict';
import { fittingSlotLayout, fittingSupported } from './fitting-panel.mjs';

test('slot layout fits between four and eight columns with bounded gaps', () => {
  assert.deepEqual(fittingSlotLayout({ width: 296, count: 5 }), {
    columns: 5,
    gap: 14,
  });
  assert.deepEqual(fittingSlotLayout({ width: 346, count: 7 }), {
    columns: 6,
    gap: 11.6,
  });
  assert.deepEqual(fittingSlotLayout({ width: 1000, count: 7 }), {
    columns: 7,
    gap: 24,
  });
  assert.deepEqual(fittingSlotLayout({ width: 1000, count: 12 }), {
    columns: 8,
    gap: 24,
  });
});

test('slot layout never exceeds the available slot count', () => {
  assert.deepEqual(fittingSlotLayout({ width: 1000, count: 3 }), {
    columns: 3,
    gap: 24,
  });
  assert.deepEqual(fittingSlotLayout({ width: 1000, count: 5 }), {
    columns: 5,
    gap: 24,
  });
});

test('fitting metadata is prefetched only for standalone hulls', () => {
  assert.equal(fittingSupported({ fitting: 'res/fitting/hull.json', groupID: 26 }), true);
  assert.equal(fittingSupported({ groupID: 26 }), false);
  assert.equal(
    fittingSupported({
      fitting: 'res/fitting/hull.json',
      groupID: 963,
      subsystemParts: [],
    }),
    false,
  );
});
