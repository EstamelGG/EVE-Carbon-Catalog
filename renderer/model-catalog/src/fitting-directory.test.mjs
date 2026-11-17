import test from 'node:test';
import assert from 'node:assert/strict';
import {uniqueEquipmentModels} from './fitting-directory.mjs';

test('keeps the smallest type ID for equipment sharing a model', () => {
  const rows = [
    {id: 461, model: 'heavy.glb', asset: 'heavy-a'},
    {id: 7043, model: 'heavy.glb', asset: 'heavy-b'},
    {id: 2985, model: 'heavy-b.glb', asset: 'heavy-c'},
    {id: 463, model: 'mega.glb', asset: 'mega'},
  ];
  assert.deepEqual(
    uniqueEquipmentModels(rows).map(({id}) => id),
    [461, 2985, 463],
  );
});

test('does not merge distinct models even if they share an asset', () => {
  const rows = [
    {id: 8, model: 'first.glb', asset: 'same'},
    {id: 4, model: 'second.glb', asset: 'same'},
    {id: 9, model: 'other.glb', asset: 'other'},
  ];
  assert.deepEqual(uniqueEquipmentModels(rows).map(({id}) => id), [8, 4, 9]);
});

test('legacy rows without a model fall back to their asset', () => {
  const rows = [
    {id: 2, asset: 'heavy-a'},
    {id: 1, asset: 'heavy-a'},
    {id: 3, asset: ''},
  ];
  assert.deepEqual(uniqueEquipmentModels(rows).map(({id}) => id), [1, 3]);
});
