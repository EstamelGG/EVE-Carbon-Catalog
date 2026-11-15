import { Mesh,Vector3,Matrix3,Matrix4 } from 'three';
import {scalarInput} from './cloud-brightness.js';
import {particleGeometry} from './particle-geometry.js';
import {gpuAtlasMaterial} from './gpu-particle-batch.js';
import {defaultMaxGpuParticles} from './gpu-particle-slots.js';
import {CpuParticleSort} from './cpu-particle-sort.js';
import { GateParticlePool,particleColor } from './gate-particle-simulation.js';
import { declaredGateParameters,gateMaterial } from './gate-materials.js';
import {gpuParticleSize} from './gpu-particle-curves.js';
import {GpuEmissionMotion,maxGpuFrameTime} from './gpu-particle-birth.js';
import {gpuEmitterInScene} from './gpu-particle-dynamics.js';
import {atlasParticleMaterial} from './atlas-particle-material.js';
import { layeredParticleMaterial } from './particle-material.js';
import { cloudParticleMaterial } from './cloud-particle-material.js';
import {particleAttributes, particleVertex, projectParticle, spriteScaleControls} from './particle-billboard.js';

// EveChildParticleSystem updates its emitters in order, then each system once.
// Current packs retain the owning node even without animation IDs. Older packs
// can identify that same node from the published transform path and leaf fxID.
// https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildParticleSystem.cpp#L252-L267
export function groupParticleSystems(records) {
  const groups = [], shared = new Map();
  for (const record of records) {
    const index = record.emitter.systemIndex;
    let key;
    if ((record.emitter.type.endsWith('DynamicEmitter') || record.emitter.type.endsWith('StaticEmitter')) && Number.isInteger(index) && index >= 0) {
      if (record.particleNodeIndex != null) key = `node/${record.particleNodeIndex}/${index}`;
      else if (record.transforms?.at(-1)?.fxID != null) {
        key = JSON.stringify([record.transforms.map(node => [node.fxID, node.name]), index]);
      }
    }
    if (key !== undefined && shared.has(key)) shared.get(key).push(record);
    else {
      const group = [record];
      groups.push(group);
      if (key !== undefined) shared.set(key, group);
    }
  }
  return groups;
}

export async function gateParticles(record,resources,root,siblingRecords=[], shareGpu=false, gpuCapacity=defaultMaxGpuParticles) {
  const gpu=record.emitter.type.endsWith('GpuUniqueEmitter');
  const system = record.systems?.[0];
  // Legacy packs may omit the element declaration. New CPU packs expose POSITION as element type 1.
  const sortByDistance = system?.requiresSorting && (!system.elements || system.elements.some(e => e.elementType === 1));
  const capacity = gpu ? gpuCapacity : Math.min(4096, Math.max(0, system?.maxParticleCount ?? 256));
  const pool=new GateParticlePool(record,capacity,siblingRecords),objects=[],passes=[],softPasses=[];
  const gpuDraw = gpu && shareGpu ? {root, pool, visible:false} : null;
  let uploadCapacity = gpu ? Math.min(256, capacity) : capacity;
  const sourceGeometry = gpuDraw ? null : record.geometry ? resources.geometry(record.geometry) : resources.plane();
  const geometry = gpuDraw ? null : resources.own(particleGeometry(sourceGeometry, uploadCapacity));
  const transit=record.materials.find(m=>m.shader==='gateparticles.fx');
  // Both DX11 and DX12 packaged static option tables declare PARTICLE_DEPARTURE at the default index.
  const event=transit?(transit.options?.EFFECT_TYPE||'PARTICLE_DEPARTURE'):null;
  if(gpu) {
    const [map, volume] = await Promise.all([
      resources.texture(record.atlas),
      record.noiseVolume && resources.texture(record.noiseVolume),
    ]);
    pool.gpuDynamics.volume = volume?.image;
    if (gpuDraw) {
      gpuDraw.atlas = map;
      gpuDraw.atlasKey = record.atlas?.url ? (resources.resolveURL?.(record.atlas.url) ?? record.atlas.url) : map;
      gpuDraw.grid = record.atlasGrid;
    } else {
      const material=gpuAtlasMaterial(resources, map, record.atlasGrid);
      const mesh=new Mesh(geometry,material);objects.push(mesh);
    }
  } else for(const source of record.materials) {
    if(source.shader==='2layermask.fx') {
      const pass=await cloudParticleMaterial(source,resources,particleVertex);
      passes.push({source,pass});softPasses.push(pass);
      const mesh=new Mesh(geometry,pass.material);mesh.userData.eveArea=source;objects.push(mesh);continue;
    }
    if(['1layerdynv2.fx','2layermodulatenoatlasv2.fx','2layerdynmaskv2.fx'].includes(source.shader)) {
      const createMaterial = source.shader === '1layerdynv2.fx' ? atlasParticleMaterial : layeredParticleMaterial;
      const pass=await createMaterial(source,resources,particleVertex);
      passes.push({source,pass});const mesh=new Mesh(geometry,pass.material);mesh.userData.eveArea=source;objects.push(mesh);continue;
    }
    const pass=await gateMaterial(source,resources);passes.push({source,pass});
    if(['motionvector.fx','motionvectorramp.fx'].includes(source.shader)) {
      softPasses.push(pass);
      const hasLifetime=system?.elements?.some(e=>e.elementType===0);
      const staticClock=source.options?.PARTICLE_TYPE==='PARTICLE_STATIC'
        || (source.options?.PARTICLE_TYPE!=='PARTICLE_DYNAMIC' && hasLifetime===false);
      pass.material.vertexShader=particleVertex
        .replace('void main()', 'uniform vec4 Depth;out vec3 effectEye,effectNormal;out float effectDepth,softDistance;\nvoid main()')
        .replace(/}\s*$/, 'effectEye=vec3(0,0,1);effectNormal=vec3(0,0,1);effectDepth=-mvPosition.z;softDistance=max(0.0,Depth.x)*length(modelMatrix[0].xyz);}');
      pass.material.fragmentShader='uniform float time;in vec4 gateTint;in float gateAge;\n'+pass.material.fragmentShader
        .replaceAll('CurrentTime.x',staticClock?'time':'(gateAge*AtlasInfo.z)')
        .replace(/}\s*$/,'fragColor*=gateTint;}');
    } else if(source.blend==='distortionAreas') {
      const prior=pass.material.onBeforeCompile;
      pass.material.onBeforeCompile=shader=>{
        prior(shader);shader.vertexShader=particleAttributes+'\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',projectParticle);
        shader.fragmentShader='varying vec4 gateTint;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','diffuseColor.a*=gateTint.a;\n#include <opaque_fragment>');
      };
      pass.material.customProgramCacheKey=()=> 'eve-gate-particle-distortion-v1-'+Boolean(source.textures.MaskMap);
    } else {
      pass.material.vertexShader=particleVertex;
      pass.material.fragmentShader='in vec4 gateTint;\n'+pass.material.fragmentShader.replace(/}\s*$/,`
        fragColor.rgb*=gateTint.rgb*gateTint.a;${source.blend==='transparentAreas'?'fragColor.a*=gateTint.a;':''}}`);
    }
    const mesh=new Mesh(geometry,pass.material);mesh.userData.eveArea=source;objects.push(mesh);
  }
  // Camera-facing sheets need one two-sided draw, never separate back/front passes.
  for(const mesh of objects){mesh.material.forceSinglePass=true;mesh.name=record.name;mesh.frustumCulled=false;root.add(mesh);}
  const local=new Matrix4(),sortTransform=new Matrix4(),velocityTransform=new Matrix3();
  const cpuSort = !gpu && sortByDistance ? new CpuParticleSort() : null;
  const dynamics = pool.dynamics;
  const changesEachTick = (dynamics.hasLifetime && system?.applyAging !== false)
    || (system?.updateSimulation !== false && (dynamics.hasMotion || system?.constraints?.length > 0));
  const hasStaticEmitter=[record,...siblingRecords].some(r=>r.emitter.type.endsWith('StaticEmitter'));
  const staticMatrix = cpuSort && !siblingRecords.length && !changesEachTick && record.emitter.type.endsWith('StaticEmitter') ? new Matrix4() : null;
  let uploadRevision = -1, uploadScale, uploadStretch, uploadSuppression, uploadRotation;
  const gpuOrder = [], sortKeys = [];
  const scaleVector=new Vector3(),position=new Vector3(),particleVelocity=new Vector3();
  const zeroOffset=[0,0,0,0],defaultSizes=[1,1,1];
  const spriteDefaults = declaredGateParameters(record.materials[0]);
  if (gpu) pool.motion = new GpuEmissionMotion();
  let last=null, pulseKey=null;
  return {reset(){pool.reset();pool.motion?.reset();last=null;if(geometry)geometry.instanceCount=0;if(gpuDraw)gpuDraw.visible=false;cpuSort?.reset();uploadRevision=-1;},update(animation,world,visible,elapsed,camera,viewportWidth){
    const evaluateEmitter=record=>{
      const emitter=animation.node(record.emitter);
      if(!emitter.rateBindings?.length)return emitter;
      let rate=emitter.rate??0;
      for(const binding of emitter.rateBindings){
        const range=binding.ranges.find(r=>r.name===animation.hullName);
        if(!range && (!binding.playing || binding.ranges.length))continue;
        const time=range?range.start+Math.min(animation.hullTime??0,Math.max(0,(range.end??0)-range.start)):elapsed;
        rate=scalarInput(binding.keys,time)*binding.scale+binding.offset;
      }
      return {...emitter,rate};
    };
    const sourceEmitter=evaluateEmitter(record),parameters=animation.parameters(record.materials[0]||{parameters:{}});
    const siblings = siblingRecords.length ? siblingRecords.map(evaluateEmitter) : siblingRecords;
    local.copy(root.matrixWorld).invert().multiply(world);
    scaleVector.setFromMatrixScale(local);
    const emitter = gpu ? gpuEmitterInScene(sourceEmitter, local, scaleVector) : sourceEmitter;
    const localX = scaleVector.x;
    const worldX = scaleVector.setFromMatrixColumn(world, 0).length();
    const useWorldScale = parameters.UseWorldScale ?? spriteDefaults?.UseWorldScale;
    const sprite = spriteScaleControls({
      UseWorldScale:useWorldScale,
      VelocityStretch:parameters.VelocityStretch ?? spriteDefaults?.VelocityStretch,
      SpriteFactors2:parameters.SpriteFactors2 ?? spriteDefaults?.SpriteFactors2,
    },localX,worldX);
    const sizeScale = gpu ? emitter.parentSizeScale : sprite.sizeScale;
    velocityTransform.setFromMatrix4(local);
    const pulse=animation.pulse;
    const kind=event==='PARTICLE_ARRIVAL'?'arrival':event==='PARTICLE_DEPARTURE'?'departure':null;
    const triggered=kind!=null && pulse?.kind===kind && pulseKey!==pulse;
    if(triggered)pulseKey=pulse;
    const frameDt=last===null?0:Math.max(0,elapsed-last);last=elapsed;
    // Emitters continue to tick every frame. When the CPU interest sphere was
    // outside, its system integrates the accumulated time on the fourth tick.
    const cpuInterval = cpuSort?.advance(frameDt,changesEachTick) ?? Math.min(frameDt,1/3);
    const dt=Math.min(gpu ? maxGpuFrameTime : .3,frameDt);
    let meetsLod = true;
    if(record.minScreenSize>0 && camera && viewportWidth>0) {
      const radius=(record.lodSphereRadius??0)*world.getMaxScaleOnAxis();
      camera.getWorldPosition(position);
      const d2=position.distanceToSquared(particleVelocity.setFromMatrixPosition(world))-radius*radius;
      const pixels=radius<=0 ? 0 : d2<=0 ? Infinity : radius*viewportWidth*camera.projectionMatrix.elements[0]/Math.sqrt(d2);
      meetsLod=pixels>=record.minScreenSize;
    }
    const emitVisible=visible && (meetsLod || (record.reflectionMode??3)!==3 || !(record.lodSphereRadius>0));
    const drawVisible=visible && meetsLod && record.meshDisplay!==false;
    const enabled=gpu ? !kind && emitter.continuousEmitter!==false : !kind && emitVisible;
    if (gpu) {
      pool.motion.frame(emitter, frameDt);
      if (enabled && dt>0) {
        const births = pool.motion.frameBirths(emitter, frameDt, Number(emitVisible));
        if (births===null) pool.remainder=0;
        emitter.rate=(births??0)/dt;
      }
    }
    const previousCount = pool.emittedCount;
    if(triggered)pool.trigger(emitter,siblings);
    // Tr2GpuParticleSystem::Update dispatches Emit before a single UpdateParticle.
    if (gpu) {
      if (dt > 0) pool.step(dt, emitter, enabled);
    } else if(dt>0 && !cpuSort && !hasStaticEmitter && record.emitter.rateBindings){
      // A short jet can live for less than one display frame. Distribute births
      // through the frame so integrating one large step cannot erase the batch.
      const steps=Math.ceil(dt*60), interval=dt/steps;
      for(let i=0;i<steps;i++)pool.step(interval,emitter,enabled,0,siblings);
    } else if (dt>0 || hasStaticEmitter) {
      pool.step(dt,emitter,enabled,0,siblings,false);
      if(cpuInterval>0)pool.dynamics.update(pool.items,cpuInterval);
    }
    if (gpu && pool.emittedCount > previousCount) pool.motion.finishDispatch();
    if (gpuDraw) {
      // UpdateEmitterParams replaces an emitter's persistent record on an Emit
      // request. Existing particles can remain visible after that emitter stops.
      gpuDraw.visible = pool.items.length > 0;
      if (pool.emittedCount > previousCount) {
        gpuDraw.emitter = {...emitter};
        for (const field of ['sizes', 'color0', 'color1', 'color2', 'color3']) {
          if (emitter[field]) gpuDraw.emitter[field] = emitter[field].slice();
        }
        gpuDraw.sizeScale = sizeScale;
      }
      gpuDraw.rotationOffset = parameters.SpriteFactors?.[1] || 0;
      return;
    }
    if (pool.items.length > uploadCapacity) {
      uploadCapacity = Math.min(capacity, 2 ** Math.ceil(Math.log2(pool.items.length)));
      geometry.dispose();
      particleGeometry(sourceGeometry, uploadCapacity, geometry);
    }
    geometry.instanceCount=pool.items.length;
    for(const mesh of objects)mesh.visible=drawVisible&&pool.items.length>0&&(!mesh.userData.eveArea||animation.node(mesh.userData.eveArea).display!==false);
    for(const {source,pass} of passes)pass.update(animation.parameters(source),elapsed);
    // Hidden emitters still simulate. Sort and upload when the draw is visible.
    if(!objects.some(mesh=>mesh.visible))return;
    const particles = pool.items;
    let drawOrder = cpuSort?.drawOrder(particles, world, camera);
    if (gpu) {
      // Infinity does not release a simulation slot in Update.fx, but cannot
      // supply a usable WebGL vertex. Compact only the draw list.
      if(camera)sortTransform.multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
      gpuOrder.length=0;
      for(let i=0;i<particles.length;i++) {
        const center=particles[i].position;
        if(!Number.isFinite(center.x)||!Number.isFinite(center.y)||!Number.isFinite(center.z))continue;
        if(camera)sortKeys[i]=-position.copy(center).applyMatrix4(sortTransform).z;
        gpuOrder.push(i);
      }
      drawOrder=camera?gpuOrder.sort((a,b)=>sortKeys[b]-sortKeys[a]):gpuOrder;
      geometry.instanceCount=drawOrder.length;
    }
    // GR2 static particles keep the same streams. Web packing also bakes the local
    // transform, size, stretch and rotation into attributes, so check those before reuse.
    const rotationOffset = parameters.SpriteFactors?.[1] || 0;
    if (staticMatrix) {
      if (uploadRevision === cpuSort.revision && staticMatrix.equals(local) && uploadScale === sizeScale
          && uploadStretch === sprite.fullStretch && uploadSuppression === sprite.suppression
          && uploadRotation === rotationOffset) return;
      uploadRevision = cpuSort.revision;
      staticMatrix.copy(local);
      uploadScale = sizeScale;
      uploadStretch = sprite.fullStretch;
      uploadSuppression = sprite.suppression;
      uploadRotation = rotationOffset;
    }
    const center=geometry.getAttribute('particleCenter'),size=geometry.getAttribute('particleSize'),tint=geometry.getAttribute('particleTint'),angle=geometry.getAttribute('particleAngle'),tile=geometry.getAttribute('particleTile');
    const velocity=geometry.getAttribute('particleVelocity'),stretch=geometry.getAttribute('particleStretch'),age=geometry.getAttribute('particleAge');
    const offset=geometry.getAttribute('particleOffset');
    for(let i=0;i<geometry.instanceCount;i++) {
      const p=particles[drawOrder ? drawOrder[i] : i],life=p.life>0?p.age/p.life:0;
      position.copy(p.position);
      if (!gpu) position.applyMatrix4(local);
      age.setX(i,life);
      offset.setXYZW(i,...(p.offset||zeroOffset));
      center.setXYZ(i,position.x,position.y,position.z);tint.setXYZW(i,...particleColor(p,emitter,parameters));
      const sizeAtAge = gpu ? p.size * gpuParticleSize(emitter.sizes || defaultSizes, life, emitter.sizeVariance, p.gpuSeed)
        : p.size + ((p.endSize ?? p.size) - p.size) * life;
      const radius = sizeAtAge * sizeScale;
      size.setXY(i,Math.max(0,radius),Math.max(0,radius));
      particleVelocity.copy(p.velocity);
      if (!gpu) particleVelocity.applyMatrix3(velocityTransform);
      velocity.setXYZ(i,particleVelocity.x,particleVelocity.y,particleVelocity.z);
      const birthRamp = sprite.suppression > 0 ? Math.min(1, life / sprite.suppression) : 1;
      const signedMotion = emitter.velocityStretchRotation ?? 0;
      stretch.setX(i, gpu ? Math.max(0, -signedMotion) : sprite.fullStretch * birthRamp);
      const spinRate = gpu ? Math.max(0, signedMotion) : p.spinVelocity;
      angle.setX(i,p.spin+spinRate*p.age+rotationOffset);tile.setX(i,gpu ? emitter.textureIndex || 0 : p.atlas || 0);
    }
    for(const attr of [center,size,tint,angle,tile,velocity,stretch,age,offset]){
      attr.clearUpdateRanges();attr.addUpdateRange(0,geometry.instanceCount*attr.itemSize);attr.needsUpdate=true;
    }
  },softPasses,gpuDraw,dispose(){objects.forEach(o=>o.removeFromParent());},get count(){return pool.items.length;}};
}
