import { InstancedBufferGeometry, InstancedBufferAttribute, Mesh, DynamicDrawUsage } from 'three';
import { flareVertex, flareFragment } from './lighting-shaders.js';

export function createFlareBatch(root, entries, resources) {
  if (!entries.length) return () => {};
  const plane = resources.plane(), geometry = resources.own(new InstancedBufferGeometry());
  geometry.index = plane.index;
  geometry.attributes = { ...plane.attributes };
  const attribute = (name, size, dynamic = false) => {
    const value = new InstancedBufferAttribute(new Float32Array(entries.length * size), size);
    if (dynamic) value.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, value);
    return value;
  };
  const centers = attribute('flareCenter', 3, true), scales = attribute('flareScale', 1, true);
  const axisX = attribute('flareAxisX', 3, true), axisY = attribute('flareAxisY', 3, true);
  const colors = attribute('flareColor', 3, true), slots = new Array(entries.length);
  const vertex = flareVertex({instanced: true});
  const fragment = flareFragment({instanced: true});
  const material = resources.additiveMaterial(vertex, fragment, {});
  // Additive quads need only one rasterization, even though viewed from either side.
  material.forceSinglePass = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = 'EVE batched authored flares';
  mesh.frustumCulled = false; // Billboard vertices expand in view space.
  root.add(mesh);
  geometry.instanceCount = 0;
  return () => {
    let count = 0, reassigned = false;
    for (const entry of entries) {
      if (!entry.object.visible) continue;
      const {matrix, material} = entry.object, u = material.uniforms;
      centers.setXYZ(count, matrix.elements[12], matrix.elements[13], matrix.elements[14]);
      scales.setX(count, u.parentScale.value);
      if (slots[count] !== entry) {
        const e = u.localTransform.value.elements, c = u.lightColor.value;
        axisX.setXYZ(count, e[0], e[1], e[2]);
        axisY.setXYZ(count, e[4], e[5], e[6]);
        colors.setXYZ(count, c.x, c.y, c.z);
        slots[count] = entry;
        reassigned = true;
      }
      count++;
    }
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count) centers.needsUpdate = scales.needsUpdate = true;
    if (reassigned) axisX.needsUpdate = axisY.needsUpdate = colors.needsUpdate = true;
  };
}
