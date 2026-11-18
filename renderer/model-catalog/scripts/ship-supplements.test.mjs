import test from 'node:test';
import assert from 'node:assert/strict';
import {populateInstances} from './ship-supplements.js';

function target() {
  return {
    count: 0,
    matrices: [],
    instanceMatrix: {needsUpdate: false},
    setMatrixAt(index, matrix) { this.matrices[index] = matrix.clone(); },
  };
}

test('instance rows compose the SOF translation, quaternion and scale', () => {
  const object = target();
  populateInstances(object, [[10, 20, 30, 0, 0, 0, 1, 2, 3, 4, 9]]);
  assert.equal(object.count, 1);
  assert.equal(object.instanceMatrix.needsUpdate, true);
  const matrix = object.matrices[0];
  assert.deepEqual([matrix.elements[12], matrix.elements[13], matrix.elements[14]], [10, 20, 30]);
  assert.deepEqual([matrix.elements[0], matrix.elements[5], matrix.elements[10]], [2, 3, 4]);
});

test('a zero quaternion falls back to identity while keeping the row translation', () => {
  const object = target();
  populateInstances(object, [[1, 2, 3, 0, 0, 0, 0, 1, 1, 1, 0]]);
  const matrix = object.matrices[0];
  assert.deepEqual([matrix.elements[0], matrix.elements[5], matrix.elements[10]], [1, 1, 1]);
  assert.deepEqual([matrix.elements[12], matrix.elements[13], matrix.elements[14]], [1, 2, 3]);
});
