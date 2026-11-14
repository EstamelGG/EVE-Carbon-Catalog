import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MeshoptSimplifier} from '../model-catalog/node_modules/meshoptimizer/meshopt_simplifier.js';

const [published, output, python = 'python'] = process.argv.slice(2);
if (!output) throw Error('Usage: node tools/build-hangar-detail.mjs PUBLISHED OUTPUT PYTHON3');
await MeshoptSimplifier.ready;
const hash = data => createHash('sha256').update(data).digest('hex');
const dest = path.join(output, 'assets', 'hangar-low');
await fs.mkdir(dest, {recursive: true});
const textureCache = new Map();
const index = JSON.parse(await fs.readFile(path.join(published, 'data/hangars.json')));
for (const room of index.hangars) {
  const source = path.join(published, room.model);
  const doc = JSON.parse(await fs.readFile(source));
  const buffers = await Promise.all(doc.buffers.map(b => fs.readFile(path.resolve(path.dirname(source), b.uri))));
  // The publisher emits tightly packed float positions and unsigned triangle indices.
  function readAccessor(id, types) {
    const a = doc.accessors[id], view = doc.bufferViews[a.bufferView], Type = types[a.componentType];
    if (!Type || a.sparse || view.byteStride) throw Error('Unexpected layout in '+source);
    const data = buffers[view.buffer];
    return new Type(data.buffer, data.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0),
      a.count * (a.type === 'VEC3' ? 3 : 1));
  }
  const chunks = [];
  let bytes = 0, triangles = 0;
  for (const mesh of doc.meshes) for (const prim of mesh.primitives) {
    if (prim.mode != null && prim.mode !== 4) continue;
    const indices = readAccessor(prim.indices, {5123:Uint16Array, 5125:Uint32Array});
    triangles += indices.length / 3;
    if (indices.length < 96) continue;
    const positions = readAccessor(prim.attributes.POSITION, {5126:Float32Array});
    const [lod] = MeshoptSimplifier.simplify(Uint32Array.from(indices), positions, 3,
      3 * Math.floor(indices.length / 6), 0.008, ['LockBorder']);
    if (lod.length === 0 || lod.length >= indices.length) continue;
    const packed = new indices.constructor(lod);
    const view = doc.bufferViews.push({buffer:buffers.length, byteOffset:bytes, byteLength:packed.byteLength, target:34963})-1;
    prim.indices = doc.accessors.push({bufferView:view, componentType:doc.accessors[prim.indices].componentType,
      count:lod.length, type:'SCALAR'})-1;
    chunks.push(Buffer.from(packed.buffer));
    bytes += packed.byteLength;
    if (bytes % 4) { chunks.push(Buffer.alloc(2)); bytes += 2; }
    triangles -= (indices.length-lod.length)/3;
  }
  // Both model directories sit directly under assets; existing shared buffers keep their relative URLs.
  if (chunks.length) {
    const data = Buffer.concat(chunks), uri = hash(data)+'.bin';
    await fs.writeFile(path.join(dest,uri),data);
    doc.buffers.push({uri,byteLength:data.length});
  }
  const maps = doc.materials.flatMap(m => m.extras?.ccpdecNative?.textures || []);
  const missing = [...new Set(maps.flatMap(m => Object.values(m)))].filter(uri => !textureCache.has(uri));
  if (missing.length) {
    const files = missing.map(uri => path.resolve(path.dirname(source),uri));
    const result = execFileSync(python,[fileURLToPath(new URL('./hangar-low-textures.py',import.meta.url)),dest],
      {input:JSON.stringify(files),encoding:'utf8'});
    JSON.parse(result).forEach((file,i) => textureCache.set(missing[i],file || missing[i]));
  }
  for (const mapsByRole of maps) for (const [role,uri] of Object.entries(mapsByRole)) mapsByRole[role]=textureCache.get(uri);
  const json = JSON.stringify(doc), revision = hash(json);
  await fs.writeFile(path.join(dest,revision+'.gltf'),json);
  room.environmentLOD = {model:'assets/hangar-low/'+revision+'.gltf',modelRevision:revision,triangles};
  console.log(room.key,triangles);
}
await fs.mkdir(path.join(output,'data'),{recursive:true});
const indexPath=path.join(output,'data/hangars.json');
await fs.writeFile(indexPath+'.tmp',JSON.stringify(index));
await fs.rename(indexPath+'.tmp',indexPath);
