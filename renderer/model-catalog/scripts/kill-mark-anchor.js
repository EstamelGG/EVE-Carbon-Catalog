import { Box3, Sphere, Vector3 } from 'three';

// Decal geometry can cover an entire hull panel. Match the shader's Y/Z
// projection clipping, always using the first mark's cell so changes to the
// kill count cannot move the bubble or its focus target.
// Like Three's DecalGeometry, clip in projector space before transforming back.
// Our counter uses the Y/Z cell of its web material; X is unrestricted.
// https://github.com/mrdoob/three.js/blob/r183/examples/jsm/geometries/DecalGeometry.js
function clipCellEdge(polygon, axis, sign, limit) {
  const clipped = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = limit - sign * a[axis], db = limit - sign * b[axis];
    if (da >= 0) clipped.push(a);
    if ((da >= 0) !== (db >= 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
  }
  return clipped;
}

export function killMarkAnchor(mesh) {
  const geometry = mesh.geometry,
    projection = mesh.material.uniforms?.decalProjection?.value;
  const positions = geometry.getAttribute('position'),
    normals = geometry.getAttribute('normal');
  const normal = new Vector3(),
    bounds = new Box3();
  if (projection) {
    const inverse = projection.clone().invert(),
      index = geometry.index;
    const vertexCount = index?.count ?? positions.count;
    const scaling = mesh.material.uniforms.textureScaling?.value;
    const yMin = scaling?.x >= 0.5 ? 1 - 2 / 9 : -1;
    const yMax = scaling?.x >= 0.5 ? 1 : -1 + 2 / 9;
    const zMin = scaling?.y >= 0.5 ? 1 - 2 / 3 : -1;
    const zMax = scaling?.y >= 0.5 ? 1 : -1 + 2 / 3;
    for (let i = 0; i < vertexCount; i += 3) {
      const ids = [0, 1, 2].map((offset) => (index ? index.getX(i + offset) : i + offset));
      let polygon = ids.map(id => new Vector3().fromBufferAttribute(positions, id).applyMatrix4(projection));
      polygon = clipCellEdge(polygon, 'y', 1, yMax);
      polygon = clipCellEdge(polygon, 'y', -1, -yMin);
      polygon = clipCellEdge(polygon, 'z', 1, zMax);
      polygon = clipCellEdge(polygon, 'z', -1, -zMin);
      if (polygon.length < 3) continue;
      for (const point of polygon) point.applyMatrix4(inverse);
      const authored = new Vector3();
      if (normals) for (const id of ids) authored.add(new Vector3().fromBufferAttribute(normals, id));
      for (let j = 1; j < polygon.length - 1; j++) {
        const a = polygon[0], b = polygon[j], c = polygon[j + 1];
        const face = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
        // A triangle touching just the cell boundary produces no painted surface.
        if (face.lengthSq() === 0) continue;
        bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c);
        if (face.dot(authored) < 0) face.negate();
        normal.add(face);
      }
    }
  }
  if (bounds.isEmpty()) {
    geometry.computeBoundingBox();
    bounds.copy(geometry.boundingBox);
    if (normals)
      for (let i = 0; i < normals.count; i++)
        normal.add(new Vector3().fromBufferAttribute(normals, i));
  }
  const sphere = bounds.getBoundingSphere(new Sphere());
  return { anchor: sphere.center, radius: sphere.radius, normal: normal.normalize() };
}
