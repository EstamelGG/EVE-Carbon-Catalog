import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';
import {Group, PlaneGeometry, ShaderMaterial, GLSL3, Mesh, Vector3, Vector4, Quaternion} from 'three';
import {createDamageToggle} from './damage-toggle.mjs';
import {ambientAnimationLoop} from './page-activity.js';
import {motionVectorFragment} from './motion-vector-material.js';

const vertex = `
out vec2 gateUV; out vec3 effectEye,effectNormal; out float effectDepth,softDistance;
void main(){
  vec4 center=modelViewMatrix*vec4(0.,0.,0.,1.);
  center.xy+=position.xy*vec2(length(modelViewMatrix[0].xyz),length(modelViewMatrix[1].xyz));
  gateUV=uv;effectEye=effectNormal=vec3(0.,0.,1.);
  effectDepth=-center.z;softDistance=0.;gl_Position=projectionMatrix*center;
}`;

// Preview continuous VDS emission at a random subset of authored trail locators.
// Atlas timing, motion vectors, emission ramps and colors come from the BLACK effect.
export function locatorFire(viewer, locators, radius, effect) {
  const scene=viewer[$scene], resources=viewer.assetSession.resources;
  return createDamageToggle(async ()=>{
    const textures=await Promise.all(Object.entries(effect.maps).map(async ([name,rec])=>[name,{value:await resources.texture(rec)}]));
    const uniforms=Object.fromEntries(textures);
    for(const [name,value] of Object.entries(effect.parameters))uniforms[name]={value:new Vector4().fromArray(value)};
    uniforms.effectHasDepth={value:false};
    const fragmentShader=motionVectorFragment({shader:'motionvector.fx',options:effect.options});
    const geometry=new PlaneGeometry(),group=new Group(),particles=[];
    const candidates=locators.slice(),count=1+Math.floor(Math.random()*candidates.length);
    for(let i=0;i<count;i++){
      const j=i+Math.floor(Math.random()*(candidates.length-i));
      [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
      const point=candidates[i],origin=new Vector3().fromArray(point.position);
      const rotation=new Quaternion().fromArray(point.rotation||[0,0,0,1]).normalize();
      const length=radius*(.12+.14*Math.random());
      for(let k=0;k<5;k++){
        const age={value:new Vector4()};
        const material=new ShaderMaterial({vertexShader:vertex,fragmentShader,glslVersion:GLSL3,
          uniforms:{...uniforms,CurrentTime:age},transparent:true,depthWrite:false});
        const particle=new Mesh(geometry,material);
        particle.frustumCulled=false;particle.name='VDS hull fire';
        const direction=new Vector3(.2*(Math.random()-.5),1,.2*(Math.random()-.5)).applyQuaternion(rotation);
        particles.push({particle,origin,direction,length,phase:(k+Math.random())/5,age});
        group.add(particle);
      }
    }
    scene.model.add(group);
    const duration=Math.max(.1,effect.parameters.AtlasInfo[2]);
    const animate=time=>{
      for(const p of particles){
        const t=(time*.001/duration+p.phase)%1;
        p.age.value.x=t*duration;
        p.particle.position.copy(p.origin).addScaledVector(p.direction,t*p.length);
        p.particle.scale.setScalar(p.length*(.32+.58*Math.sin(Math.PI*t)));
      }
      scene.queueRender();
    };
    const loop=ambientAnimationLoop(scene,animate);
    animate(0);
    return {
      setVisible(value){group.visible=value;if(value)loop.start();else loop.stop();scene.queueRender();},
      dispose(){loop.stop();group.removeFromParent();geometry.dispose();for(const p of particles)p.particle.material.dispose();scene.queueRender();}
    };
  });
}
