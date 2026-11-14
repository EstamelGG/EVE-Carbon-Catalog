import {Matrix4,PerspectiveCamera,Uniform,Vector2,Vector3} from 'three';
import {DepthOfFieldEffect} from 'postprocessing';
import {MVEffectBase} from '@google/model-viewer-effects/lib/effects/mixins/effect-base.js';
import {$scene} from '@google/model-viewer/lib/model-viewer-base.js';

// postprocessing 6.39 supplies depth unpacking and the bokeh passes. Our CoC
// uses optical-axis depth and gives the entire subject a zero-blur interval.
function protectSubject(effect){
 const material=effect.cocMaterial;
 const focusBand=new Uniform(new Vector2(-1,-1));
 material.uniforms.eveFocusBand=focusBand;
 const original=material.fragmentShader;
 material.fragmentShader=original.slice(0,original.indexOf('void main(){'))+`
 uniform vec2 eveFocusBand;
 void main(){
  float depth=readDepth(vUv);
  float viewZ=getViewZ(depth);
  float offset;
  float protection=0.0;
  if(eveFocusBand.x>=0.0){
   float z=-viewZ;
   offset=z-clamp(z,eveFocusBand.x,eveFocusBand.y);
   protection=1.0-smoothstep(0.0,focusRange*0.125,abs(offset));
  }else{
   offset=length(getViewPosition(vUv,depth,viewZ))-focusDistance;
  }
  float blur=smoothstep(0.0,focusRange,abs(offset));
  gl_FragColor=vec4(blur*step(offset,0.0),blur*step(0.0,offset),protection,1.0);
 }`;
 // The near bokeh spreads across silhouettes. Use the unblurred, full-size
 // CoC at the destination pixel to preserve its original color in the band.
 effect.uniforms.set('eveSubjectCoC',new Uniform(effect.cocTexture));
 effect.setFragmentShader('uniform sampler2D eveSubjectCoC;\n'+
  effect.getFragmentShader().replace('outputColor=result;',
   'outputColor=mix(result,inputColor,texture2D(eveSubjectCoC,uv).b);'));
 return focusBand.value;
}

class EveDepthOfField extends MVEffectBase {
 constructor(){
  super();
  const effect=new DepthOfFieldEffect(new PerspectiveCamera(),{resolutionScale:.5});
  effect.requireSeparatePass=true;
  const band=protectSubject(effect);
  const toView=new Matrix4(),center=new Vector3(),halfSize=new Vector3();
  const update=effect.update.bind(effect);
  effect.target=new Vector3();
  effect.update=(renderer,input,delta)=>{
   const viewer=this.effectComposer.modelViewerElement,scene=viewer[$scene],camera=scene.getCamera();
   effect.mainCamera=camera;
   const docked=viewer.hangar?.focusShip;
   const box=docked?.hullBox??scene.boundingBox;
   const frame=docked?.root??scene.target;
   if((docked||scene.model.visible)&&!box.isEmpty()){
    // Project the oriented hull box onto the optical axis. ModelScene measures
    // its main model in target space; a docked secondary ship is in root space.
    toView.multiplyMatrices(camera.matrixWorldInverse,frame.matrixWorld);
    box.getCenter(center).applyMatrix4(toView);
    box.getSize(halfSize).multiplyScalar(.5);
    const m=toView.elements;
    const extent=Math.abs(m[2])*halfSize.x+Math.abs(m[6])*halfSize.y+Math.abs(m[10])*halfSize.z;
    const pad=Math.max(camera.near*.02,extent*.02);
    band.set(Math.max(0,-center.z-extent-pad),Math.max(0,-center.z+extent+pad));
    effect.cocMaterial.focusRange=Math.max(extent,camera.near*2);
    effect.target=null;
   }else{
    band.set(-1,-1);
    effect.target=scene.scenePivot.getWorldPosition(center);
    effect.cocMaterial.focusRange=Math.max((viewer.hangarFocusRadius??scene.boundingSphere.radius)*.8,camera.near*2);
   }
   update(renderer,input,delta);
  };
  this.effects=[effect];
 }
}
customElements.define('eve-depth-of-field',EveDepthOfField);
