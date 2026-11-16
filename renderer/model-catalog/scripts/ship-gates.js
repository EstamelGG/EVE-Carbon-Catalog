import {dockBodyDraws} from './hangar-dock-bodies.js';
import { Mesh,Object3D,Vector3,Vector4,Quaternion,Matrix4,BoxGeometry,PointLight,SpotLight,Color } from 'three';
import {setSourceLightRadii} from './source-light-contract.js';
import {hangarLightIntensity} from './hangar-lighting.js';
import { beforeSceneRender } from './effect-resources.js';
import { GateAnimation } from './gate-animation.js';
import { gateBones,gateWorld } from './gate-transforms.js';
import { gateMaterial } from './gate-materials.js';
import { diffuseAtlases } from './layered-mesh-material.js';
import {installGpuParticleBatches} from './gpu-particle-batch.js';
import { gateParticles, groupParticleSystems } from './gate-particles.js';
import {createFlareVisibility} from './flare-visibility.js';
import {createAnimatedFlareBatches} from './animated-flare-batch.js';
import { authoredLocal } from './ship-authored-spotlights.js';
import {sceneLines} from './scene-lines.js';
import {$renderer} from '@google/model-viewer/lib/model-viewer-base.js';
import {createEffectDepth} from './effect-depth.js';
import {createHangarTraffic} from './hangar-traffic.js';
import {createEffectFrameGuard} from './effect-frame.js';
import {createGateMeshBatches} from './gate-mesh-batch.js';
import {concurrentMap} from './concurrent-map.js';
import {createGateTransformCache} from './gate-transform-cache.js';

export async function installGateEffects(viewer,scene,root,data,resources,getTime,diagnosticKey=null,hangarBodies=[],onCommit=callback=>callback(),owner) {
  if(!data?.animation)return null;
  const animation=new GateAnimation(data.animation),meshes=[],particles=[],flares=[],lines=[];
  const lights=(data.lights||[]).map(record=>{
    const object=new Object3D(),light=record.spot?new SpotLight():new PointLight();
    object.matrixAutoUpdate=false;light.position.fromArray(record.position??[0,0,0]);
    if(light.isSpotLight){light.angle=(record.outerAngle??45)*Math.PI/180;light.penumbra=1-Math.min(1,(record.innerAngle??0)/Math.max(.001,record.outerAngle??45));light.target.position.fromArray(record.direction??[0,0,1]);if(!record.direction&&record.rotation)light.target.position.applyQuaternion(new Quaternion(...record.rotation));light.add(light.target);}
    object.add(light);root.add(object);return {record,object,light};
  });
  const boneAt=gateBones(owner?.document ?? viewer.originalGltfJson,owner?.model ?? scene.model),eye=new Vector3(),rotation=new Quaternion(),inverse=new Matrix4();
  const hazeBox=data.meshes.some(m=>m.haze)?resources.own(new BoxGeometry(1,1,1)):null;
  const colorAtlases=diffuseAtlases(data.meshes.map(mesh=>mesh.material));
  const prepared=await concurrentMap(data.meshes,async record=>{
    const traffic=record.traffic?await createHangarTraffic(record,resources):null;
    const pass=traffic?.pass||await gateMaterial(record.material,resources,{viewer,scene,colorAtlases,
      advanceStaticAtlases:Boolean(data.advanceStaticAtlases)});
    // The volume shader clips the ray interval against opaque scene depth.
    // Testing the exit face against that wall would discard the visible front of the volume.
    if(record.material.shader==='volumesphere.fx')pass.material.depthTest=false;
    const object=traffic?.object||new Mesh(record.haze?hazeBox:resources.geometry(record.geometry),pass.material);
    object.name=record.name;object.matrixAutoUpdate=false;
    // Ordinary effect vertices stay inside their geometry bounds; traffic
    // moves in its shader and must retain its uncullable path.
    object.frustumCulled=Boolean(data.animation.hangar&&!traffic);
    return {record,pass,object};
  });
  for(const entry of prepared){root.add(entry.object);meshes.push(entry);}
  for (const [record, ...siblings] of groupParticleSystems(data.particles)) {
    const useDDS = record.atlasDDS && viewer[$renderer].threeRenderer.extensions.has('WEBGL_compressed_texture_s3tc');
    const draw = useDDS ? {...record, atlas:record.atlasDDS} : record;
    particles.push({record, pool:await gateParticles(draw,resources,root,siblings,true,data.gpuMaxParticles)});
  }
  for(const record of data.lines||[])lines.push({record,pass:await sceneLines(record,resources,root)});
  for(const record of data.flares) {
    const node=record.transforms.at(-1);
    const resolved={...animation.node(node)};
    const object=new Object3D();
    object.material={uniforms:{
      localTransform:{value:authoredLocal(resolved)},parentScale:{value:1},
      lightColor:{value:new Vector3()}}};
    const fields=animation.animatedFields.get(node.fxID);
    const animatedLocal=['translation','rotation','scaling','staticTransform','useSRT','localTransform'].some(field=>fields?.has(field));
    const cacheBounds=data.animation.hangar && !animatedLocal &&
      !['useStaticScale','useStaticRotation'].some(field=>fields?.has(field));
    flares.push({record,object,node:resolved,source:node,target:animation.targets[node.fxID],fields,animatedLocal,bounds:cacheBounds?{center:new Vector3(),revision:-1}:null,parents:record.transforms.slice(0,-1)});
  }
  const flareBatches=createAnimatedFlareBatches(root,flares,resources);
  let meshBatches=null;
  const softPasses=meshes.filter(m=>['motionvectorramp.fx','motionvector.fx','volumesphere.fx','hazespherical.fx','twocolorflare.fx'].includes(m.record.material.shader)).map(m=>m.pass);
  for(const particle of particles)softPasses.push(...particle.pool.softPasses);
  softPasses.push(...flareBatches.passes);
  const depth=softPasses.length?createEffectDepth(scene,softPasses):null;
  const cloudVolumes=(data.fogVolumes||[]).map(record=>{
    const object=new Object3D();object.name=record.transforms.at(-1)?.name||"Particle fog";
    object.matrixAutoUpdate=false;root.add(object);
    return {record,object,density:record.density};
  });
  const center=new Vector3(),visibility=flares.length?createFlareVisibility():null;
  const transforms=data.animation.hangar?createGateTransformCache([
    ...lights.map(e=>e.record.transforms),...cloudVolumes.map(v=>v.record.transforms),...meshes.map(e=>e.record.transforms),...flares.map(e=>e.parents),...hangarBodies.map(o=>o.userData.eveDockParent),
    ...particles.map(e=>e.record.transforms),...lines.map(e=>e.record.transforms),
  ],animation,root,eye,rotation,boneAt):null;
  const worldAt=chain=>transforms?transforms.world(chain):gateWorld(chain,animation,root,eye,rotation,boneAt);
  const updateBodies=dockBodyDraws(hangarBodies);
  const needsUpdate=data.animation.hangar?createEffectFrameGuard():null;
  let lastDiagnostics='',rangeChanged=false;
  const viewport = new Vector4();
  const previousRoot=new Matrix4();
  let rootRevision=0,removeGpu;
  onCommit(() => {
    if(cloudVolumes.length)(scene.userData.eveParticleFogVolumes??=[]).push(...cloudVolumes);
    removeGpu = installGpuParticleBatches(scene, particles.map(p => p.pool.gpuDraw).filter(Boolean), data.gpuMaxParticles);
  });
  const unsubscribe=beforeSceneRender(scene,(camera,renderer)=>{
    if (!root.parent||(!root.visible&&!hangarBodies.length&&!particles.length&&!animation.selectedLoops.size&&!rangeChanged)) return;
    const time=getTime();
    inverse.copy(root.matrixWorld).invert();
    const viewportWidth = visibility?.begin(camera,renderer,root.matrixWorld,inverse);
    if(needsUpdate&&!rangeChanged&&!needsUpdate(scene,camera,root,time,viewportWidth)){
      if(root.visible)depth?.render(viewer[$renderer].threeRenderer,camera);return;
    }
    rangeChanged=false;
    const hullName=(viewer.animationName||'').split('.').pop();
    animation.hullTime=viewer.currentTime;
    if (data.animation.generic && !data.animation.hangar && animation.hullName!==hullName) particles.forEach(p=>p.pool.reset());
    animation.evaluate(time,data.animation.generic && !data.animation.hangar ? {
      name:hullName, time:viewer.currentTime,
      names:viewer.availableAnimations.map(name=>name.split('.').pop()),
    } : null);
    camera.getWorldPosition(eye);camera.getWorldQuaternion(rotation);
    transforms?.begin();
    for(const {record,object,light} of lights){
      const source=animation.node(record),{world,visible}=worldAt(record.transforms);
      object.visible=visible&&source.display!==false&&((source.flags??1)&1)!==0;
      object.matrix.copy(world).premultiply(inverse);object.updateMatrixWorld(true);
      light.color.setRGB(...(source.color??[1,1,1]).slice(0,3));
      light.intensity=hangarLightIntensity({brightness:1,...source},time);
      setSourceLightRadii(light,source.radius??0,source.innerRadius,object.matrixWorld.getMaxScaleOnAxis());
    }
    for(const volume of cloudVolumes){
      const {world,visible}=worldAt(volume.record.transforms);
      volume.object.visible=visible;volume.object.matrix.copy(world).premultiply(inverse);
    }
    updateBodies(worldAt,inverse,camera,renderer,eye);
    const particleWidth=particles.length ? camera.viewport?.z ?? renderer.getCurrentViewport(viewport).z : 0;
    for(const {record,pool} of particles) {
      const {world,visible}=worldAt(record.transforms);
      pool.update(animation,world,root.visible&&visible,time,camera,particleWidth);
    }
    if(!root.visible)return;
    if(!previousRoot.equals(root.matrixWorld)){previousRoot.copy(root.matrixWorld);rootRevision++;}
    for(const entry of meshes) {
      const {record,pass,object}=entry;
      const materialTarget=animation.targets[record.material.fxID];
      const display=materialTarget&&Object.hasOwn(materialTarget,'display')?materialTarget.display:record.material.display;
      object.visible=record.meshDisplay!==false&&display!==false;
      // A hidden leader still owns uniforms used by its visible instances.
      if(entry.batched&&entry.batchLeader)pass.update(animation.parameters(record.material),time);
      if(!object.visible)continue;
      const {world,visible,revision}=worldAt(record.transforms);
      object.visible=visible;
      if(!visible)continue;
      if(!transforms || entry.revision!==revision || entry.rootRevision!==rootRevision){
        object.matrix.copy(world).premultiply(inverse);
        if(!entry.batched)object.updateMatrixWorld(true);
        entry.revision=revision;entry.rootRevision=rootRevision;
      }
      if(!entry.batched){
        pass.uniforms.directionalScale?.value.setFromMatrixScale(object.matrix);
        pass.update(animation.parameters(record.material),time);
      }
    }
    // Partition only after authored placements are available (initial matrices
    // are identity). Animated bounds continue to update after partitioning.
    if(data.animation.hangar&&!meshBatches)meshBatches=createGateMeshBatches(root,meshes,animation);
    meshBatches?.update();
    for(const {record,object,parents,animatedLocal,bounds,node,source,target,fields} of flares) {
      // Sampling mutates only track-bound fields. Retain one merged view per flare.
      if(fields)for(const field of fields)node[field]=Object.hasOwn(target,field)?target[field]:source[field];
      if(node.display===false){object.visible=false;continue;}
      const {world,visible,revision}=worldAt(parents);
      object.visible=visible;
      if(!object.visible)continue;
      const u=object.material.uniforms;
      if(animatedLocal)authoredLocal(node,u.localTransform.value);
      const minimum=node.minScreenSize ?? record.minScreenSize ?? 0;
      if(!bounds || bounds.revision!==revision || bounds.rootRevision!==rootRevision){
        const radius=visibility.measure(node,u.localTransform.value,world);
        visibility.billboardCenter(center);
        if(bounds){
          bounds.center.copy(center);bounds.radius=radius;
          bounds.revision=revision;bounds.rootRevision=rootRevision;
        }
        object.visible=visibility.inView(center,radius,minimum);
        // Keep the instance transform current even if this camera culled it.
        if(bounds||object.visible){
          object.matrix.makeTranslation(center.x,center.y,center.z).premultiply(inverse);
          u.parentScale.value=visibility.billboardScale(u.localTransform.value);
        }
      }else object.visible=visibility.inView(bounds.center,bounds.radius,minimum);
      if(!object.visible)continue;
      u.lightColor.value.fromArray(node.color||record.color).multiplyScalar(node.brightness??record.brightness);
    }
    flareBatches.update();
    const lineWidth=lines.length?viewer.clientWidth||1:1,lineHeight=lines.length?viewer.clientHeight||1:1;
    for(const {record,pass} of lines){
      const {world,visible}=worldAt(record.transforms);
      pass.update(animation,world,visible,time,lineWidth,lineHeight);
    }
    depth?.render(viewer[$renderer].threeRenderer,camera);
    const diagnostics=JSON.stringify({state:data.animation.hangar?'ambient':data.animation.generic?hullName:animation.state,meshes:meshes.length,
      emitters:data.particles.length,particles:particles.reduce((n,p)=>n+p.pool.count,0),unsupported:data.unsupported.length});
    if(diagnostics!==lastDiagnostics){viewer.dataset[diagnosticKey||(data.animation.generic?'sceneEffects':'gateEffects')]=diagnostics;lastDiagnostics=diagnostics;}
  });
  return {hullAnimations:animation.hullAnimations(viewer.availableAnimations),
    get dockRangeActive(){return animation.selectedLoops.size>0;},
    setDockRange(name){
      if(!hangarBodies.length)return false;
      const targets=new Set(hangarBodies.map(body=>body.userData.eveDockParent.at(-1).fxID));
      if(!animation.selectLoop(targets,name,getTime()))return false;
      rangeChanged=true;scene.queueRender();return true;
    },
    get state(){return animation.state;},
    setState(state){if(!animation.setState(state,getTime()))return;particles.forEach(p=>p.pool.reset());scene.queueRender();},
    trigger(kind){animation.trigger(kind,getTime());scene.queueRender();},
    dispose(){
      for(const {object}of lights)object.removeFromParent();
      for(const volume of cloudVolumes){
        volume.object.removeFromParent();
        const installed=scene.userData.eveParticleFogVolumes,index=installed?.indexOf(volume)??-1;
        if(index>=0)installed.splice(index,1);
      }
      unsubscribe();removeGpu?.();depth?.dispose();meshBatches?.dispose();flareBatches.dispose();particles.forEach(p=>p.pool.dispose());lines.forEach(p=>p.pass.dispose());for(const p of meshes)p.object.removeFromParent();}};
}
