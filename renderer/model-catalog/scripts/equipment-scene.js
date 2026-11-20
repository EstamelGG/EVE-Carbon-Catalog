export {equipmentStarfield} from './equipment-starfield.js';
// Carrier display-space compositing is a preview convention checked in remediation 70.
// Background tint comes from the preview scene.
// See docs/source-audit-summary-2026-11-11.md. Standard framebuffer APIs do not clear the shader semantics.
import {BackSide, BoxGeometry, Mesh, ShaderMaterial, Vector3, Vector2, FramebufferTexture, NoBlending, NoColorSpace, SRGBColorSpace, UnsignedByteType} from 'three';
import {gateMaterial} from './gate-materials.js';
import {gateLayerFragment} from './layered-mesh-material.js';
import {distantSkyProjection} from './skybox-orientation.js';

// previewTurrets.red / background.fx Tint, retained for older published assets
// which stored only NebulaMap. StarParameters.w is zero in this scene.
export const equipmentBackgroundTint = [0.1894810050725937, 0.27613988518714905, 0.4085966944694519];

export function equipmentBackground(texture, parameters = {}, intensity = 1) {
  const material = new ShaderMaterial({
    side:BackSide, depthTest:false, depthWrite:false,
    uniforms:{skyMap:{value:texture}, tint:{value:new Vector3(...(parameters.Tint || equipmentBackgroundTint).slice(0,3))}, intensity:{value:intensity}},
    vertexShader:`varying vec3 direction;
      ${distantSkyProjection}
      void main(){direction=position;gl_Position=projectDistantSky(mat3(viewMatrix)*position);}`,
    fragmentShader:`uniform samplerCube skyMap;uniform vec3 tint;uniform float intensity;varying vec3 direction;
      void main(){gl_FragColor=vec4(textureCube(skyMap,vec3(-direction.x,direction.yz)).rgb*tint*intensity,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky = new Mesh(new BoxGeometry(2,2,2), material);
  sky.name='Equipment authored background';sky.frustumCulled=false;sky.renderOrder=-Infinity;
  return sky;
}

export async function equipmentFloorMaterial(record, resources) {
  const result=await gateMaterial(record, resources), material=result.material;
  // The carrier composites its layers over the captured display color.
  Object.assign(material.uniforms,{carrierFrame:{value:null},carrierSize:{value:new Vector2(1,1)},carrierLinear:{value:true}});
  material.fragmentShader = gateLayerFragment(record, true);
  material.blending=NoBlending;material.forceSinglePass=true;
  material.userData.eveBloomEmission=false;
  // The transparent base attenuates the backdrop before the additive pass emits.
  result.renderOrder=record.blend === 'transparentAreas' ? 10 : 11;
  return result;
}

// Capture the opaque scene immediately before each carrier layer for display-space
// compositing. The authored carrier plane has a diffuse alpha of 0.5.
export function installSceneColorCapture(mesh) {
  const original=mesh.onBeforeRender,material=mesh.material,size=new Vector2();
  let frame=null,framebuffer=null,context=null;
  mesh.onBeforeRender=function(renderer,scene,camera,geometry,current,...rest){
    original?.call(this,renderer,scene,camera,geometry,current,...rest);
    if(current!==material)return; // bloom/normal/depth passes must not copy
    const target=renderer.getRenderTarget();
    if(target)size.set(target.width,target.height);else renderer.getDrawingBufferSize(size);
    const type=target?.texture.type ?? UnsignedByteType;
    // Multisample blits require matching attachment formats. An sRGB texture
    // decodes back to linear on sampling and encodes again on framebuffer write.
    const colorSpace=target?.texture.colorSpace ?? NoColorSpace;
    if(!frame||frame.colorSpace!==colorSpace||frame.image.width!==size.x||frame.image.height!==size.y||frame.type!==type){
      frame?.dispose();frame=new FramebufferTexture(size.x,size.y);frame.type=type;frame.colorSpace=colorSpace;
      material.uniforms.carrierFrame.value=frame;
    }
    // Resolve the currently bound DRAW buffer, including MSAA. copyTexSubImage
    // reads READ_FRAMEBUFFER, which may still refer to a previous composer pass.
    const gl=renderer.getContext();context=gl;
    framebuffer ||= gl.createFramebuffer();
    renderer.initTexture(frame);
    const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    try{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,draw);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,renderer.properties.get(frame).__webglTexture,0);
      gl.blitFramebuffer(0,0,size.x,size.y,0,0,size.x,size.y,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    }finally{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);
    }
    material.uniforms.carrierSize.value.copy(size);
    if(material.uniforms.carrierLinear)
      material.uniforms.carrierLinear.value=Boolean(target) || renderer.outputColorSpace!==SRGBColorSpace;
  };
  return ()=>{mesh.onBeforeRender=original;frame?.dispose();frame=null;if(framebuffer)context.deleteFramebuffer(framebuffer);framebuffer=null;};
}
export {installSceneColorCapture as installEquipmentFloorBlend};
