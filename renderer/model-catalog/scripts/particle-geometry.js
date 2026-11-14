import {DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry} from 'three';

export const particleFields = [
  ['particleCenter', 3], ['particleVelocity', 3], ['particleStretch', 1], ['particleSize', 2],
  ['particleTint', 4], ['particleAngle', 1], ['particleTile', 1], ['particleAge', 1], ['particleOffset', 4],
];

export function particleGeometry(plane, capacity, geometry = new InstancedBufferGeometry()) {
  geometry.index = plane.index;
  geometry.attributes = {...plane.attributes};
  geometry.instanceCount = 0;
  for (const [name, size] of particleFields) {
    const attr = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
    geometry.setAttribute(name, attr.setUsage(DynamicDrawUsage));
  }
  return geometry;
}
