// Mesh supplements are drawn with their authored transforms and texture inputs.
/*! Source-authored ubershader mesh effects and projected decals. See third-party-notices.txt. */
import { Object3D, Mesh, ShaderMaterial, GLSL3, Matrix4, Quaternion, Vector3, Vector4, Color, PointLight } from 'three';
import {setSourceLightRadii} from './source-light-contract.js';
import {hangarLightIntensity} from './hangar-lighting.js';
import { installKillMarks } from './kill-marks.js';
import { installGlowDecals } from './glow-decals.js';
import { beforeSceneRender } from './effect-resources.js';
import { createTransformCache } from './effect-performance.js';
import { createFlareVisibility } from './flare-visibility.js';
import { createFlareBatch } from './flare-batch.js';
import { decalBoneTransform } from './decal-projection.js';
import { createPaintDecal } from './paint-decal.js';
import { authoredLocal, authoredWorld } from './ship-authored-spotlights.js';
import { applyGateModifiers, gateBones } from './gate-transforms.js';
import { createLayeredMeshMaterial, regularVertex, layerCoordinates } from './layered-mesh-material.js';

// Native texturecolor.fx: UV scaling/translation, sampled color and brightness.
// Opaque child meshes must write depth before the additive effect shells.
export function opaqueTextureMaterial(resources, parameters, map) {
  const material = resources.own(new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: regularVertex,
    fragmentShader: `in vec2 beamUV; out vec4 fragColor;
uniform sampler2D diffuseMap; uniform vec4 color, translation, scaling; uniform float brightness;
void main(){fragColor=texture(diffuseMap,beamUV*scaling.xy+translation.xy)*color*brightness;}`,
    uniforms: {
      diffuseMap: {value: map},
      color: {value: new Vector4(...parameters.DiffuseColor)},
      translation: {value: new Vector4(...(parameters.TextureTranslation || [0,0,0,0]))},
      scaling: {value: new Vector4(...(parameters.TextureScaling || [1,1,1,1]))},
      brightness: {value: parameters.Brightness?.[0] ?? 1},
    },
    transparent: false, depthTest: true, depthWrite: true,
  }));
  material.userData.eveBloomEmission = true;
  return material;
}

// The two scrolling textures modulate a scalar height field. Its surface gradient
// bends the normal, following Mikkelsen, Bump Mapping Unparametrized Surfaces.
// Constant-height regions keep the original normal. Reflection rays originate
// at each surface point for a perspective camera.
export const cubeVertex=`out vec2 beamUV; out vec3 worldNormal,worldPoint;
void main(){
  beamUV=uv;
  worldNormal=normalize(transpose(inverse(mat3(modelMatrix)))*normal);
  worldPoint=(modelMatrix*vec4(position,1)).xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1);
}`;
export const cubeFragment=`in vec2 beamUV; in vec3 worldNormal,worldPoint; out vec4 fragColor;
uniform sampler2D map0,map1,maskMap; uniform samplerCube cubeMap;
uniform vec4 transform0,transform1,scroll0,scroll1,lightColor,normalScale;
uniform float time;
${layerCoordinates}
void main(){
  vec4 wave0=texture(map0,layerUV(beamUV,transform0,scroll0));
  vec4 wave1=texture(map1,layerUV(beamUV,transform1,scroll1));
  vec4 mask=texture(maskMap,beamUV);
  float height=dot(normalScale.xyz,wave0.rgb*wave1.rgb*mask.rgb);
  vec3 n=normalize(worldNormal),dx=dFdx(worldPoint),dy=dFdy(worldPoint);
  vec3 xGradient=cross(dy,n),yGradient=cross(n,dx);
  float determinant=dot(dx,xGradient);
  if(abs(determinant)>1e-12){
    n=normalize(n-(dFdx(height)*xGradient+dFdy(height)*yGradient)/determinant);
  }
  vec3 incident=isOrthographic ? -vec3(viewMatrix[0].z,viewMatrix[1].z,viewMatrix[2].z) : normalize(worldPoint-cameraPosition);
  float coverage=clamp(wave0.a*wave1.a*mask.a*lightColor.a,0.0,1.0);
  fragColor=vec4(texture(cubeMap,reflect(incident,n)).rgb*lightColor.rgb*coverage,coverage);
}`;

export async function installSupplements(viewer, scene, root, data, resources, getState, onCommit, owner) {
  if (!data) return () => {};
  const entries=[];
  const childLights=[];
  for(const record of data.lights||[]){
    if(((record.flags??1)&1)===0 || record.display===false)continue;
    const object=new Object3D(),color=record.color??[1,1,1];
    const light=new PointLight(new Color(...color.slice(0,3)),record.brightness??1);
    light.name=record.name||'Tr2PointLight';
    light.position.fromArray(record.position??[0,0,0]);
    object.add(light);object.matrixAutoUpdate=false;root.add(object);
    entries.push({object,transforms:record.transforms});
    childLights.push({object,light,record:{brightness:1,...record}});
  }
  const vector=(p,k,d)=>({value:new Vector4(...(p[k] || d))});
  await Promise.all(data.meshes.map(async record=>{
    const p=record.parameters;
    if (record.material==='texture-color' && record.blend==='opaque') {
      const map=await resources.texture(record.textures.DiffuseMap,{repeat:true});
      const object=new Mesh(resources.geometry(record.geometry),opaqueTextureMaterial(resources,p,map));
      object.name=record.name; object.matrixAutoUpdate=false; object.frustumCulled=false;
      root.add(object); entries.push({object,transforms:record.transforms});
      return;
    }
    if (record.material==='uber-cube') {
      const maps=await Promise.all(['DiffuseMap1','DiffuseMap2','MaskMap','MainCubeMap']
        .map(role=>resources.texture(record.textures[role],{repeat:role!=='MainCubeMap'})));
      const uniforms={time:{value:0},
        map0:{value:maps[0]},map1:{value:maps[1]},maskMap:{value:maps[2]},cubeMap:{value:maps[3]},
        lightColor:vector(p,'DiffuseColor',[1,1,1,1]),normalScale:vector(p,'ScaleAlongNormal',[0,0,0,0])};
      for(let i=0;i<2;i++){
        uniforms['transform'+i]=vector(p,'TextureTransform'+(i+1),[0,0,1,1]);
        uniforms['scroll'+i]=vector(p,'TextureScroll'+(i+1),[0,0,0,0]);
      }
      const object=new Mesh(resources.geometry(record.geometry),resources.additiveMaterial(cubeVertex,cubeFragment,uniforms));
      object.name=record.name;object.matrixAutoUpdate=false;object.frustumCulled=false;
      root.add(object);entries.push({object,transforms:record.transforms});
      return;
    }
    const material = await createLayeredMeshMaterial(record, resources, record.layers);
    const object = new Mesh(resources.geometry(record.geometry), material);
    object.name=record.name; object.matrixAutoUpdate=false; object.frustumCulled=false;
    root.add(object);entries.push({object,transforms:record.transforms});
  }));
  for (const record of data.flares) {
    const object=new Object3D();
    object.material = { uniforms: {
      localTransform:{value:authoredLocal(record.node)},parentScale:{value:1},
      lightColor:{value:new Vector3(...record.color.slice(0,3)).multiplyScalar(record.brightness)} } };
    object.matrixAutoUpdate=false;entries.push({object,transforms:record.parents,flare:record.node,minScreenSize:record.minScreenSize});
  }
  const paintBones = [];
  for (const record of data.decals.filter(record => !record.material)) {
    const material=await createPaintDecal(record,resources,viewer.decalLightingUniforms);
    const object = new Mesh(resources.geometry(record.geometry), material);
    object.name = 'EVE projected decal';
    const update = decalBoneTransform(viewer, scene, root, record.parentBoneIndex, owner);
    if (update) {
      object.matrixAutoUpdate = false;
      paintBones.push({object, update});
    }
    root.add(object);
  }
  const disposeKillMarks = await installKillMarks(viewer, scene, root,
    data.decals.filter(record => record.material === 'kill-counter'), resources, onCommit, owner);
  let disposeGlowDecals;
  try {
    disposeGlowDecals = await installGlowDecals(viewer, scene, root,
      data.decals.filter(record => record.material === 'glow'), resources, () => getState().elapsed, owner);
  } catch (error) { disposeKillMarks(); throw error; }
  const eye=new Vector3(),rotation=new Quaternion(),inverse=new Matrix4();
  const paths=entries.map(entry=>entry.transforms);
  const hasBones=paths.some(path=>path.some(node=>node.transformModifiers?.some(m=>m.type.endsWith('AttachToBone'))));
  const boneAt=hasBones && gateBones(owner?.document??viewer.originalGltfJson,owner?.model??scene.model);
  const identityAnimation={node:source=>source};
  function evaluate(node,parent,eye,rotation){
    if(!node.transformModifiers?.length)return authoredWorld(node,parent,eye,rotation);
    const world=parent.clone().multiply(authoredLocal(node));
    if(!applyGateModifiers(world,node.transformModifiers,identityAnimation,root,eye,rotation,boneAt))
      world.makeScale(0,0,0);
    return world;
  }
  const transforms = createTransformCache(paths, hasBones?evaluate:authoredWorld,
    node=>node.transformModifiers?.some(modifier=>!modifier.type.endsWith('ModifierSRT')));
  const world = new Matrix4(), center = new Vector3();
  const visibility = entries.some(entry => entry.flare) ? createFlareVisibility() : null;
  const updateFlares = createFlareBatch(root, entries.filter(entry => entry.flare), resources);
  const view=new Matrix4(),projection=new Matrix4(),rootWorld=new Matrix4(),viewport=new Vector4();
  const clocks=entries.map(entry=>entry.object.material?.uniforms.time).filter(Boolean);
  let previousCamera,previousWidth,previousDepth;
  const unsubscribe=beforeSceneRender(scene,(camera,renderer)=>{
    if (!root.visible) return;
    for (const {object, update} of paintBones) {
      update(object.matrix);
      object.updateMatrixWorld(true);
    }
    const elapsed=getState().elapsed;
    for(const {light,record,object} of childLights){
      light.intensity=hangarLightIntensity(record,elapsed);
      setSourceLightRadii(light,record.radius??0,record.innerRadius,object.matrixWorld.getMaxScaleOnAxis());
    }
    for(const uniform of clocks)uniform.value=elapsed;
    const width=camera.viewport?.z??renderer.getCurrentViewport(viewport).z;
    if(!hasBones && previousCamera===camera && previousWidth===width && previousDepth===camera.reversedDepth &&
       view.equals(camera.matrixWorldInverse) && rootWorld.equals(root.matrixWorld) && projection.equals(camera.projectionMatrix))return;
    previousCamera=camera;previousWidth=width;previousDepth=camera.reversedDepth;
    view.copy(camera.matrixWorldInverse);projection.copy(camera.projectionMatrix);rootWorld.copy(root.matrixWorld);
    camera.getWorldPosition(eye);camera.getWorldQuaternion(rotation);inverse.copy(root.matrixWorld).invert();
    visibility?.begin(camera, renderer, root.matrixWorld, inverse);
    transforms.update(root.matrixWorld, eye, rotation);
    for(const [index, entry] of entries.entries()){
      world.copy(transforms.get(index));
      if(entry.flare){
        const uniforms = entry.object.material.uniforms;
        entry.object.visible = visibility.test(entry.flare, uniforms.localTransform.value, world, entry.minScreenSize);
        if (!entry.object.visible) continue;
        uniforms.parentScale.value=visibility.billboardScale(uniforms.localTransform.value);
        visibility.billboardCenter(center);
        world.makeTranslation(center.x, center.y, center.z);
      }
      entry.object.matrix.copy(world).premultiply(inverse);
      if(!entry.flare)entry.object.updateMatrixWorld(true);
      entry.object.visible = entry.object.matrix.elements.every(Number.isFinite) && Math.abs(entry.object.matrix.determinant()) > 1e-18;
    }
    updateFlares();
  });
  viewer.dataset.supplements=JSON.stringify({meshes:data.meshes.length,decals:data.decals.length,unsupported:data.unsupported.length});
  return () => { unsubscribe(); disposeKillMarks(); disposeGlowDecals(); };
}
