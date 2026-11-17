import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canFitEquipment,
  groupHardpoints,
  planEquipmentPlacements,
  selectHardpoints,
} from './equipment-hardpoints.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
const slots = groupHardpoints([
  { name: 'locator_turret_1a', transform: identity },
  { name: 'locator_launcher_1a', transform: shifted },
]);

test('launcher and chain equipment can use turret-only hull mounts', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  for (const locatorName of ['locator_launcher_', 'locator_chain_']) {
    assert.equal(
      canFitEquipment(turretOnly, 1, { categoryID: 7, locatorName }),
      true,
    );
  }
});

test('an exact launcher mount is preferred over the turret fallback', () => {
  const mounts = selectHardpoints(slots, 1, 'locator_launcher_');
  assert.deepEqual(mounts.map(({ name }) => name), ['locator_launcher_1a']);
});

test('fallback mounts can be planned onto turret slots', () => {
  const turretOnly = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  const equipment = [{ id: 1875, categoryID: 7, locatorName: 'locator_launcher_' }];
  const plan = planEquipmentPlacements(
    turretOnly,
    new Map([[1, 1875]]),
    equipment,
    6,
  );
  assert.deepEqual(plan.get(1).mounts.map(({ name }) => name), ['locator_turret_1a']);
});

test('unrelated equipment families stay incompatible', () => {
  assert.equal(
    canFitEquipment(slots, 1, {
      categoryID: 7,
      locatorName: 'locator_bomb_',
    }),
    false,
  );
});

test('new locator families match exactly without code changes', () => {
  const custom = groupHardpoints([
    { name: 'locator_custom_weapon_1a', transform: identity },
  ]);
  assert.equal(
    canFitEquipment(custom, 1, {
      categoryID: 7,
      locatorName: 'locator_custom_weapon_',
    }),
    true,
  );
});

test('declared aliases cover atomic and doomsday equipment families', () => {
  const turret = groupHardpoints([
    { name: 'locator_turret_1a', transform: identity },
  ]);
  const xl = groupHardpoints([
    { name: 'locator_xl_1a', transform: identity },
  ]);
  assert.equal(
    canFitEquipment(turret, 1, {
      categoryID: 7,
      locatorName: 'locator_atomic_',
    }),
    true,
  );
  assert.equal(
    canFitEquipment(xl, 1, {
      categoryID: 66,
      locatorName: 'locator_doomsday_',
    }, 65),
    true,
  );
});
