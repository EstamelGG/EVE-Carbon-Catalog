import assert from 'node:assert/strict';
import test from 'node:test';
import { diffuseAtlases, layeredTexture } from './layered-mesh-material.js';

test('untagged projection and mask textures follow their authored use', () => {
  const atlas = { url: 'res/example/renamed.ktx2', sourceTransfer: 'unspecified' };
  const mask = { url: 'res/example/coverage.ktx2', sourceTransfer: 'unspecified' };
  const colors = diffuseAtlases([{ textures: { DiffuseMap1: atlas, MaskMap: mask } }]);
  assert.equal(layeredTexture(atlas, 'DiffuseMap1').colorSpace, 'srgb');
  assert.equal(layeredTexture(atlas, 'MaskMap', colors).colorSpace, 'srgb');
  assert.equal(layeredTexture(mask, 'MaskMap', colors), mask);
  assert.equal(layeredTexture(atlas, 'NormalMap', colors), atlas);
});

test('explicit transfer and sampler overrides have priority over slot defaults', () => {
  const source = { url: 'res/example/map.ktx2', sourceTransfer: 'linear' };
  assert.equal(layeredTexture(source, 'DiffuseMap1').colorSpace, 'srgb-linear');
  assert.equal(layeredTexture({ ...source, sourceTransfer: 'srgb' }, 'MaskMap').colorSpace, 'srgb');
  const override = { ...source, colorSpace: '' };
  assert.equal(layeredTexture(override, 'DiffuseMap2'), override);
});
