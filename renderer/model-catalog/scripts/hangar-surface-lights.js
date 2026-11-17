import {Group,PointLight,SpotLight,Vector3,Quaternion,Matrix4} from 'three';
import {fixtureCurveValue,hangarLightIntensity} from './hangar-lighting.js';
import {GateAnimation} from './gate-animation.js';
import {createGateTransformCache} from './gate-transform-cache.js';
import {beforeSceneRender} from './effect-resources.js';
import {installLightBudget} from './effect-performance.js';
import {ambientAnimationLoop} from './page-activity.js';
import {setSourceLightRadii} from './source-light-contract.js';

const scale=new Vector3(),position=new Vector3(),direction=new Vector3(),quaternion=new Quaternion();
const timeVarying = source => source.noiseAmplitude || source.brightnessBinding || source.positionBinding;

export function surfaceLightKind(source){
  if(!((source.flags??1)&1))return null; // Tr2LightFlags.AFFECTS_SURFACES
  if(source.type==='trinity.Tr2SpotLight')return 'spot';
  if(source.type==='trinity.Tr2FactionLight')return source.isSpotlight?'spot':'point';
  if(source.type==='trinity.Tr2PointLight')return 'point';
  if(source.type==='trinity.Tr2TexturedPointLight'&&source.texturePath==='dynamic:/hangarvideos')return 'point';
  return null;
}

export function updateSurfaceLight(light,source,world,inverse,visible,seconds=0){
  const color=source.selectedColor||source.color||[0,0,0];
  if(!light.userData.hangarVideo)light.color.fromArray(color);
  light.intensity=Math.max(0,hangarLightIntensity(source,seconds)||0);
  const outer=source.outerAngle??90;
  // A zero-width authored cone illuminates no surface area and needs no budget slot.
  light.visible=visible&&source.display!==false&&light.intensity>0&&(!light.isSpotLight||outer>0);
  if(!light.visible)return;
  scale.setFromMatrixScale(world);
  const factor=Math.max(scale.x,scale.y,scale.z);
  setSourceLightRadii(light,source.radius,source.innerRadius,factor);
  position.fromArray(source.position||[0,0,0]);
  const motion=source.positionBinding;
  if(motion)position[motion.axis]=fixtureCurveValue(motion,seconds);
  position.applyMatrix4(world);
  light.position.copy(position).applyMatrix4(inverse);
  if(light.isSpotLight){
    light.angle=outer*Math.PI/180;light.penumbra=1-(source.innerAngle||0)/outer;
    direction.set(0,0,1).applyQuaternion(quaternion.fromArray(source.rotation||[0,0,0,1])).transformDirection(world);
    light.target.position.copy(position).add(direction).applyMatrix4(inverse);
    if(!light.target.matrixAutoUpdate)light.target.updateMatrix();
    light.target.updateMatrixWorld(true);
  }
  if(!light.matrixAutoUpdate)light.updateMatrix();
  light.updateMatrixWorld(true);
}

export function unpackSurfaceLighting(data){
  if(data.version===1)return data;
  if(data.version!==2)throw Error('Unsupported hangar surface lighting');
  return {...data,lights:data.lights.map(r=>({...r,transforms:r.transforms.map(i=>data.transforms[i])})),
    animation:{...data.animation,sets:data.animation.sets.map(s=>({...s,tracks:s.tracks.map(t=>({...t,values:data.samples[t.values.sample]}))}))}};
}

export function installHangarSurfaceLights(scene,root,packed,doc=globalThis.document,roomLights,boneAt=()=>null){
  const data=packed&&unpackSurfaceLighting(packed);
  if(!data)return ()=>{};
  const group=new Group();group.name='Authored hangar surface lights';root.add(group);
  const animation=new GateAnimation(data.animation),entries=[];
  for(const record of data.lights){
    const kind=surfaceLightKind(record.source);if(!kind)continue;
    const light=kind==='spot'?new SpotLight():new PointLight();
    if(record.source.type==='trinity.Tr2TexturedPointLight'){
      light.userData.hangarVideo=record.source.texturePath;
      light.color.setRGB(0,0,0);
    }
    // The animation evaluator owns these local transforms. Refresh them once
    // when it writes a new pose; parent world transforms still propagate.
    if(!light.userData.hangarVideo){
      light.matrixAutoUpdate=false;
      if(light.isSpotLight)light.target.matrixAutoUpdate=false;
    }
    light.name=record.source.name||record.transforms.at(-1)?.name||'Hangar light';
    light.intensity=0;
    // Screen lamps share the room's architecture budget with root video lamps.
    const parent=light.userData.hangarVideo&&roomLights?roomLights:group;
    parent.add(light);if(light.isSpotLight)parent.add(light.target);
    entries.push({record,light});
  }
  const eye=new Vector3(),rotation=new Quaternion(),inverse=new Matrix4();
  const cache=createGateTransformCache(entries.map(e=>e.record.transforms),animation,root,eye,rotation,boneAt);
  const loop=doc&&ambientAnimationLoop(scene, ()=>{if(root.parent&&group.visible)scene.queueRender();},doc);
  const now=loop?loop.now:()=>performance.now(),start=now();
  if(animation.data.sets.length||entries.some(e=>timeVarying(e.record.source)))loop?.start();
  // Only the root pose can change the world transform of an unanimated path
  // without camera-facing or bone modifiers. Initialise every light on first use.
  const dynamicEntries=entries.filter(({record,light})=>{
    if(light.userData.hangarVideo || timeVarying(animation.node(record.source)) || animation.animatedFields.has(record.source.fxID))return true;
    return record.transforms.some(node=>animation.animatedFields.has(node.fxID) ||
      node.transformModifiers?.some(modifier=>!modifier.type.endsWith('ModifierSRT')||animation.animatedFields.has(modifier.fxID)));
  });
  let initialized=false;
  const previousRoot=new Matrix4();
  const stop=beforeSceneRender(scene,camera=>{
    const current=now(),elapsed=(current-start)/1000;
    const seconds=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
    animation.evaluate(seconds);
    camera.getWorldPosition(eye);camera.getWorldQuaternion(rotation);inverse.copy(root.matrixWorld).invert();cache.begin();
    const rootChanged=!initialized || !previousRoot.equals(root.matrixWorld);
    initialized=true;
    previousRoot.copy(root.matrixWorld);
    for(const entry of rootChanged?entries:dynamicEntries){
      const {record,light}=entry,pose=cache.world(record.transforms);
      const source=animation.node(record.source);
      if(!rootChanged && entry.revision===pose.revision && entry.visible===pose.visible &&
         source===entry.source && !timeVarying(source) && !light.userData.hangarVideo)continue;
      updateSurfaceLight(light,source,pose.world,inverse,pose.visible,seconds);
      entry.revision=pose.revision;entry.visible=pose.visible;entry.source=source;
    }
  });
  const releaseBudget=installLightBudget(scene,group,{points:16,spots:8});
  return ()=>{loop?.stop();releaseBudget();stop();
    for(const {light} of entries)if(light.parent===roomLights)light.removeFromParent();
    group.removeFromParent();};
}
