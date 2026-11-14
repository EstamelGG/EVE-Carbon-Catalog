import { BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// CCP submits four beam quads and two lens quads per lamp.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpotlightSet.cpp#L50-L55
export function spotlightCone(zOffset = 0) {
  const count = 4, positions = [], uvs = [], indices = [];
  for (let fin = 0; fin < count; fin++) {
    const azimuth = Math.PI * fin / count;
    const x = Math.cos(azimuth), y = Math.sin(azimuth), tip = zOffset + 1;
    positions.push(x,y,zOffset, -x,-y,zOffset, -x,-y,tip, x,y,tip);
    uvs.push(0,1, 1,1, 1,0, 0,0);
    const start = fin * 4;
    indices.push(start,start+1,start+2, start,start+2,start+3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function spotlightLenses() {
  const disk = new PlaneGeometry(), streak = new PlaneGeometry();
  disk.setAttribute('lensRole', new Float32BufferAttribute([0,0,0,0], 1));
  streak.setAttribute('lensRole', new Float32BufferAttribute([1,1,1,1], 1));
  return mergeGeometries([disk, streak]);
}
