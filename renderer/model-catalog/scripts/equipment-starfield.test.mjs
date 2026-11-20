import assert from 'node:assert/strict';
import test from 'node:test';
import {starfieldGeometry} from './equipment-starfield.js';

test('packed equipment scenes can omit the default star distances', () => {
  const packed = {numStars: 1500, minFlashRate: .1, maxFlashRate: .4, minFlashIntensity: .5};
  const stars = starfieldGeometry(packed);
  const explicit = starfieldGeometry({...packed, minDist: 100, maxDist: 300});
  assert.equal(stars.instanceCount, 1500);
  assert.deepEqual(stars.getAttribute('starPosition').array, explicit.getAttribute('starPosition').array);
  const flash = stars.getAttribute('starFlash');
  for (let i = 0; i < stars.instanceCount; i++) {
    assert.ok(flash.getW(i) >= Math.fround(.1) && flash.getW(i) <= Math.fround(.4));
    assert.ok(flash.getY(i) >= .5);
  }
});

test('invalid explicit star distances still report the field name', () => {
  assert.throws(() => starfieldGeometry({minDist: null}), /Invalid starfield parameter: minDist/);
});
