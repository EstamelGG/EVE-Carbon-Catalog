import {Color,DirectionalLight,Group,PointLight,Quaternion,SpotLight,Vector3} from 'three';
import {setSourceLightRadii} from './source-light-contract.js';
import {perlinNoise1D} from './trinity-noise.js';
import {ambientAnimationLoop} from './page-activity.js';

import {compileLightExpression} from './smart-light-expression.js';
import {scalarInput} from './cloud-brightness.js';

// Trinity Tr2CurveScalarExpression::GetRandomConstant supports a fixed preview
// value of 0.21. Each parent passes its local time to the authored input graph.
const bindingEvaluators = new WeakMap();
function compileFixtureCurve(curve) {
 if (curve.keys) return time=>scalarInput(curve.keys,time);
 const program=compileLightExpression(curve.expression);
 if (!program) throw Error('Unsupported fixture expression: '+curve.expression);
 const expressionInputs=curve.inputs.map(input=>({GetValueAt:compileFixtureCurve(input)}));
 const context={modifier:{expressionInputs},randomConstant:Math.fround(0.21),input1:curve.input1,time:0};
 return time=>{context.time=time;return program(context);};
}
export function fixtureCurveValue(binding,seconds) {
 const time=Number.isFinite(seconds)?seconds:0;
 let evaluate=bindingEvaluators.get(binding);
 if (!evaluate) {
  evaluate=compileFixtureCurve(binding.curve);
  bindingEvaluators.set(binding,evaluate);
 }
 const value=binding.scale*evaluate(time*binding.clockScale)+binding.offset;
 return Number.isFinite(value)?value:Number.isFinite(binding.offset)?binding.offset:0;
}

// LightData::AsPerPointLightData applies authored noise before the manager receives the light.
export function hangarLightIntensity(record,seconds){
 const time=Number.isFinite(seconds)?seconds:0;
 const brightness=record.brightnessBinding ? fixtureCurveValue(record.brightnessBinding,time) : record.brightness;
 if(!record.noiseAmplitude)return Number.isFinite(brightness)?brightness:0;
 const noise=perlinNoise1D(time*(record.noiseFrequency??1),2,2,record.noiseOctaves??1);
 const value=brightness*record.noiseAmplitude*(noise+1)/2;
 return Number.isFinite(value)?value:Math.max(0,Number.isFinite(brightness)?brightness:0);
}

export function createHangarLights(room,scale){
 const lights=new Group();
 // The regular sun is a fallback for the non-dynamic lighting path. A black
 // dynamic sun is intentional indoors; it must not fall back to the sun.
 const sunColor=room.environment.useSunDiffuseColorWithDynamicLights
  ?room.environment.sunDiffuseColorWithDynamicLights:room.environment.sunColor;
 if(sunColor?.slice(0,3).some(v=>v>0)){
  const sun=new DirectionalLight(new Color(...sunColor.slice(0,3)),1);
  sun.position.fromArray(room.environment.sunDirection).multiplyScalar(-1000);
  lights.add(sun,sun.target);
 }
 for(const record of [...room.lights,...(room.environment.smartLights||[])]){
  const video=record.type==='trinity.Tr2TexturedPointLight'&&record.texturePath==='dynamic:/hangarvideos';
  if(!video&&!['trinity.Tr2PointLight','trinity.Tr2SpotLight'].includes(record.type))continue;
  if(!((record.flags??1)&1)||record.radius<=0)continue;
  const isSpot=record.type==='trinity.Tr2SpotLight',outer=record.outerAngle??0;
  if(isSpot&&outer<=0)continue;
  // LightData::AsPerSpotLightData stores cos(2*pi*angle/360). Three takes the same half
  // angle in radians. Radii use our explicit source-light transport contract.
  const color=new Color(...record.color.slice(0,3));
  const brightness=hangarLightIntensity(record,0);
  const light=isSpot?new SpotLight(color,brightness,0,outer*Math.PI/180,1-(record.innerAngle??0)/outer):new PointLight(color,brightness);
  if(video)light.userData.hangarVideo=record.texturePath;
  if(record.noiseAmplitude)light.userData.hangarNoise=record;
  setSourceLightRadii(light,record.radius,record.innerRadius,scale);
  if(light.isSpotLight){
   const direction=record.direction?new Vector3(...record.direction):new Vector3(0,0,1).applyQuaternion(new Quaternion(...(record.rotation||[0,0,0,1])));
   light.target.position.fromArray(record.position).add(direction.normalize());lights.add(light.target);
  }
  light.position.fromArray(record.position);lights.add(light);
 }
 return lights;
}

export function animateHangarLights(group,scene,doc){
 const lights=group.children.filter(light=>light.userData.hangarNoise);
 if(!lights.length)return;
 const loop=ambientAnimationLoop(scene, now=>{
  for(const light of lights)light.intensity=hangarLightIntensity(light.userData.hangarNoise,(now-start)/1000);
  scene.queueRender();
 },doc);
 loop.start();
 const start=loop.now();
 return loop.stop;
}

// The native ME attaches this rig to the displayed hull. Keep its lights out
// of the camera-ranked architecture budget so distant wall lamps cannot evict
// the lights that define the ship. Source positions/radii are in hull radii.
export function createDockLights(environment,radius,worldScale){
 const source=environment.dockLighting;
 const root=createHangarLights({environment:{},lights:source?.lights||[]},radius*worldScale);
 root.name='Hangar ship lights';
 root.scale.setScalar(radius);
 return root;
}
