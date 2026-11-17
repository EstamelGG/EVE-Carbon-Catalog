import test from 'node:test';
import assert from 'node:assert/strict';
import {uniqueEquipmentAssets} from './fitting-directory.mjs';

test('keeps the smallest type ID for equipment sharing an asset', () => {
  const rows = [
    {id: 461, asset: 'heavy-a'},
    {id: 7043, asset: 'heavy-a'},
    {id: 2985, asset: 'heavy-b'},
    {id: 463, asset: 'mega'},
  ];
  assert.deepEqual(
    uniqueEquipmentAssets(rows).map(({id}) => id),
    [461, 2985, 463],
  );
});

test('does not merge distinct assets that share a model', () => {
  const rows = [
    {id: 8, model: 'same.glb', asset: 'same-a'},
    {id: 4, model: 'same.glb', asset: 'same-b'},
    {id: 9, model: 'other.glb', asset: 'other'},
  ];
  assert.deepEqual(uniqueEquipmentAssets(rows).map(({id}) => id), [8, 4, 9]);
});

test('rows without an asset stay visible', () => {
  const rows = [{id: 2}, {id: 1}, {id: 3, asset: ''}];
  assert.deepEqual(uniqueEquipmentAssets(rows).map(({id}) => id), [2, 1, 3]);
});
