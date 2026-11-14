import {materialGlb} from './material-glb.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {encodeTexture} from './texture-ktx.mjs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Run from the Renderer root. Viewer supplies offline format readers only.
const [viewerDir, resDir, published, output, ktx] = process.argv.slice(2);
if (!ktx) throw Error('Usage: node tools/build-streamed-hulls.mjs VIEWER RES PUBLISHED OUTPUT KTX');
const moduleAt = file => import(pathToFileURL(path.resolve(viewerDir,file)));
const {decodeGr2} = await moduleAt('geometry/gr2.mjs');
const {encodeGlb} = await moduleAt('geometry/glb.mjs');
const {parseDds,decodeDdsLevel} = await moduleAt('textures/dds.mjs');
const {MeshoptEncoder} = await moduleAt('resources/node_modules/meshoptimizer/meshopt_encoder.js');
await MeshoptEncoder.ready;
const requireViewer = createRequire(path.resolve(viewerDir,'package.json'));
await import(pathToFileURL(requireViewer.resolve('@carbonenginejs/runtime')));
const {CjsBlackFormat} = await import(pathToFileURL(requireViewer.resolve('@carbonenginejs/runtime/blue/formats/black')));
const readJSON = async file => JSON.parse(await fs.readFile(file,'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex').slice(0,20);
const resource = uri => fs.readFile(path.join(resDir,uri.toLowerCase().replace(/^res:\//,'')));
const outputDir = path.join(output,'assets/streamed-hulls');
await fs.mkdir(outputDir,{recursive:true});
async function publish(name,ext,bytes) {
  const file = name+'-'+digest(bytes)+'.'+ext;
  await fs.writeFile(path.join(outputDir,file),bytes);
  return file;
}
const recipes = new Map();
for (const entry of (await readJSON(path.join(published,'data/resources.json'))).resources) {
  if (entry.recipe.kind==='source-texture') recipes.set(path.posix.basename(entry.file),entry.recipe);
}
const converted = new Map();
async function texture(uri, scratch, normalMap) {
  const key = JSON.stringify([uri,normalMap]);
  if (converted.has(key)) return converted.get(key);
  const dds = parseDds(await resource(uri));
  const tiers=await encodeTexture({dds,uri,normalMap,scratch,ktx,decodeDdsLevel,
    save:(tier,bytes)=>publish(tier+'-'+path.posix.basename(uri,'.dds'),'ktx2',bytes)});
  converted.set(key,tiers);
  return tiers;
}
const scratch=await fs.mkdtemp(path.resolve(output,'hull-mips-'));
try {
  for (const id of [608,85236]) {
    const template=await readJSON(path.join(published,'assets/models/'+id+'.gltf'));
    const dna=template.extras.ccpdec.dna, [h,f,r]=dna.split(':');
    async function black(kind,name) {
      const uri='res:/dx9/model/spaceobjectfactory/'+kind+'/'+name+'.black';
      return CjsBlackFormat.read(await resource(uri),{emit:'json'}).object;
    }
    const [hull,faction,race]=await Promise.all([black('hulls',h),black('factions',f),black('races',r)]);
    const scene=decodeGr2(await resource(hull.geometryResFilePath));
    const maps=new Map(), textures={};
    for (const mat of template.materials) for (const [role,url] of Object.entries(mat.extras.ccpdecNative.textures)) {
      if (maps.has(url)) continue;
      const recipe=recipes.get(path.posix.basename(url));
      if (!recipe) throw Error('Missing DDS recipe: '+url);
      const pair=await texture(recipe.source,scratch,role==='NormalMap');
      maps.set(url,pair);textures[recipe.source]=pair;
    }
    const levels=[];
    for (const mesh of scene.meshes) {
      const bytes=encodeGlb({...scene,meshes:[{...mesh,lod:null}]});
      const tier=mesh.lod===null || mesh.lod>80 ? 'full' : 'low';
      const file=await publish(id+'-lod-'+(mesh.lod??'full'),'glb',materialGlb(bytes,template,maps,tier,MeshoptEncoder));
      levels.push({pixels:mesh.lod,triangles:mesh.indices.length/3,file,tier});
    }
    const manifest={version:1,dna,hull:h,faction:f,race:r,geometry:hull.geometryResFilePath,
      areas:hull.opaqueAreas.map(a=>({name:a.name,shader:a.shader})),primary:faction.areaTypes?.Primary,
      booster:race.booster?.shapeAtlasResPath,textures,levels,initial:levels.find(l=>l.pixels===null).file};
    const dest=path.join(outputDir,id+'.json');
    await fs.writeFile(dest+'.tmp',JSON.stringify(manifest));await fs.rename(dest+'.tmp',dest);
    console.log(id,levels.length,'levels',maps.size,'textures');
  }
} finally { await fs.rm(scratch,{recursive:true,force:true}); }
