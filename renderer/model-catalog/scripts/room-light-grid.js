import {DataTexture, FloatType, Matrix4, RGBAFormat, Vector3} from 'three';
import {hangarLightIntensity} from './hangar-lighting.js';

// Viewer implementation. A cell lists every authored light sphere touching it.
// Field meanings follow carbonengine/trinity, Lights/Tr2Light.cpp and
// shaders/include/Carbon/SpaceScene/DynamicLighting.fxh at f6f5ff8.
export function roomLightUniforms() {
  return {
    eveRoomLights: {value: null},
    eveRoomGridSize: {value: new Vector3()},
    eveRoomGridOrigin: {value: new Vector3()},
    eveRoomCellSize: {value: 1},
    eveViewToRoom: {value: new Matrix4()},
  };
}

export function buildRoomLightGrid(points = [], maxSize, spots = []) {
  const lights = [...points, ...spots];
  if (!lights.length) return null;
  const low = new Vector3(Infinity, Infinity, Infinity);
  const high = new Vector3(-Infinity, -Infinity, -Infinity);
  const center = new Vector3(), corner = new Vector3();
  for (const light of lights) {
    center.fromArray(light.position);
    low.min(corner.copy(center).addScalar(-light.radius));
    high.max(corner.copy(center).addScalar(light.radius));
  }
  const span = high.clone().sub(low);
  const cellSize = Math.max(span.x, span.y, span.z) / 64;
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) return null;
  const dim = span.divideScalar(cellSize).ceil().max(new Vector3(1, 1, 1));
  const cells = Array.from({length: dim.x * dim.y * dim.z}, () => []);
  const first = new Vector3(), last = new Vector3(), limit = dim.clone().addScalar(-1);
  for (const [index, light] of lights.entries()) {
    center.fromArray(light.position).sub(low).divideScalar(cellSize);
    const radius = light.radius / cellSize;
    first.copy(center).addScalar(-radius).floor().clampScalar(0, Infinity);
    last.copy(center).addScalar(radius).floor().min(limit);
    for (let z = first.z; z <= last.z; z++) {
      const dz = Math.max(z - center.z, 0, center.z - z - 1);
      for (let y = first.y; y <= last.y; y++) {
        const dy = Math.max(y - center.y, 0, center.y - y - 1);
        const section = radius * radius - dz * dz - dy * dy;
        for (let x = first.x; x <= last.x; x++) {
          const dx = Math.max(x - center.x, 0, center.x - x - 1);
          if (dx * dx <= section) cells[x + dim.x * (y + dim.y * z)].push(index);
        }
      }
    }
  }

  // Spot records add the emission axis and two cone cosines. A negative
  // cell-list pointer identifies a spot. Float indices are exact below 2^24.
  const records = cells.length, spotStart = records + points.length * 2;
  const lists = spotStart + spots.length * 4;
  const address = i => i < points.length ? records + i * 2 : spotStart + (i - points.length) * 4;
  const length = lists + cells.reduce((sum, cell) => sum + Math.ceil(cell.length / 4), 0);
  const width = Math.min(maxSize, Math.ceil(Math.sqrt(length))), height = Math.ceil(length / width);
  if (height > maxSize || length >= 2 ** 24) return null;
  const pixels = new Float32Array(width * height * 4);
  for (const [index, light] of lights.entries()) {
    const offset = address(index) * 4;
    pixels.set([...light.position, light.radius], offset);
    pixels.set([...light.color.slice(0, 3).map(c => c * light.brightness), light.innerRadius ?? 0], offset + 4);
    if (index >= points.length) {
      pixels.set([...light.direction, Math.cos(light.outerAngle * Math.PI / 180)], offset + 8);
      pixels[offset + 12] = Math.cos(light.innerAngle * Math.PI / 180);
    }
  }
  let cursor = lists;
  for (const [index, cell] of cells.entries()) {
    pixels.set([cursor, cell.length], index * 4);
    for (const [slot, light] of cell.entries()) pixels[cursor * 4 + slot] = light < points.length ? address(light) : -address(light);
    cursor += Math.ceil(cell.length / 4);
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType);
  const varying = [];
  for (const [index, source] of lights.entries()) {
    if (source.noiseAmplitude || source.brightnessBinding) varying.push({source, offset:(address(index) + 1) * 4});
  }
  let uploaded = false;
  texture.onUpdate = () => { uploaded = true; };
  texture.needsUpdate = true;
  // The sphere and its cell membership are fixed. Only its emission changes.
  // Keep a full upload pending until Three has initialized the sampler.
  function updateEmission(seconds) {
    texture.clearUpdateRanges();
    for (const {source, offset} of varying) {
      const brightness = hangarLightIntensity(source, seconds);
      for (let c = 0; c < 3; c++) pixels[offset + c] = source.color[c] * brightness;
      if (uploaded) texture.addUpdateRange(offset, 4);
    }
    texture.needsUpdate = true;
  }
  return {texture, dim, low, cellSize, updateEmission:varying.length ? updateEmission : null,
    dispose() { texture.dispose(); }};
}

export const roomLightPars=`
uniform highp sampler2D eveRoomLights;
uniform vec3 eveRoomGridSize,eveRoomGridOrigin;
uniform float eveRoomCellSize;
uniform mat4 eveViewToRoom;
vec4 eveRoomLightTexel(int i){
  int width=textureSize(eveRoomLights,0).x;
  return texelFetch(eveRoomLights,ivec2(i%width,i/width),0);
}`;

export const roomLightLoop=`
#ifdef EVE_DUST_LAYER
if(eveDust.b>0.0)
#endif
if(eveRoomGridSize.x>0.0){
  vec3 roomPoint=(eveViewToRoom*vec4(geometryPosition,1.)).xyz;
  ivec3 cell=ivec3(floor((roomPoint-eveRoomGridOrigin)/eveRoomCellSize));
  ivec3 dims=ivec3(eveRoomGridSize);
  if(all(greaterThanEqual(cell,ivec3(0)))&&all(lessThan(cell,dims))){
    int head=cell.x+dims.x*(cell.y+dims.y*cell.z);
    ivec2 list=ivec2(eveRoomLightTexel(head).xy);
    for(int i=0;i<list.y;i++){
      int pointer=int(eveRoomLightTexel(list.x+i/4)[i%4]);
      int record=abs(pointer);
      vec4 sphere=eveRoomLightTexel(record);
      vec3 delta=sphere.xyz-roomPoint;
      float squaredDistance=dot(delta,delta);
      if(squaredDistance<=0.0 || squaredDistance>=sphere.w*sphere.w)continue;
      vec3 viewDirection=transpose(mat3(eveViewToRoom))*delta;
      if(dot(geometryNormal,viewDirection)<=0.0)continue;
      float dist=sqrt(squaredDistance);
      float profile=1.0;
      if(pointer<0){
        vec4 axis=eveRoomLightTexel(record+2);
        if(axis.w>0.0)profile=eveSourceSpotAttenuation(axis.w,eveRoomLightTexel(record+3).x,-dot(axis.xyz,delta)/dist);
        if(profile<=0.0)continue;
      }
      vec4 emission=eveRoomLightTexel(record+1);
      IncidentLight lamp;
      lamp.direction=normalize(viewDirection);
      lamp.color=emission.rgb*(profile*eveSourceDistanceAttenuation(dist,sphere.w,emission.a));
      lamp.visible=true;
      PhysicalMaterial finish=material;
      float increment=eveSourceRoughnessIncrease(emission.a,dist);
      finish.roughness=sqrt(min(material.roughness*material.roughness+increment,1.0));
      RE_Direct(lamp,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,finish,reflectedLight);
    }
  }
}`;
