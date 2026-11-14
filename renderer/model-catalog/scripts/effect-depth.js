import {renderPreparedScene} from './prepared-scene.js';
import {DepthTexture,WebGLRenderTarget,Vector2,Vector4,Color} from 'three';
import {sceneBuffers} from './scene-buffers.js';

// Opaque depth for soft intersections. Kept separate from SSAO so disabling AO
// does not change the appearance of authored translucent effects.
const sceneDepths=new WeakMap();

export function createEffectDepth(scene, passes) {
  let shared=sceneDepths.get(scene);
  if(!shared){shared=createSceneDepth(scene);sceneDepths.set(scene,shared);}
  shared.owners++;
  let disposed=false;
  return {
    render(renderer,camera){if(!disposed)shared.render(renderer,camera,passes);},
    dispose(){
      if(disposed)return;disposed=true;
      for(const pass of passes){pass.uniforms.effectHasDepth.value=false;pass.uniforms.effectSceneDepth.value=null;}
      if(--shared.owners===0){shared.dispose();sceneDepths.delete(scene);}
    },
  };
}

// Ship, fittings and hangar all intersect the same opaque scene. Keep one
// depth buffer per scene instead of rendering the entire room for each owner.
function createSceneDepth(scene) {
  const target=new WebGLRenderTarget(1,1);
  target.depthTexture=new DepthTexture(1,1);
  const viewport=new Vector4(),scissor=new Vector4(),size=new Vector2(),clearColor=new Color();
  let frame=-1,lastCamera=null;
  return {
    owners:0,
    render(renderer,camera,passes){
      const previous=renderer.getRenderTarget();
      if(previous)size.set(previous.width,previous.height);else renderer.getDrawingBufferSize(size);
      const buffers=sceneBuffers(scene,renderer,camera,size.x,size.y);
      if(buffers){
        for(const pass of passes){const u=pass.uniforms;
          u.effectSceneDepth.value=buffers.depth;u.effectDepthSize.value.copy(size);
          u.effectCameraRange.value.set(camera.near,camera.far);u.effectHasDepth.value=true;
        }
        return;
      }
      const resized=target.width!==size.x||target.height!==size.y;
      if(resized)target.setSize(size.x,size.y);
      if(frame!==scene.renderCount||lastCamera!==camera||resized){
      const hidden=[],writes=new Map(),background=scene.background,before=scene.onBeforeRender;
      const autoClear=renderer.autoClear,scissorTest=renderer.getScissorTest(),alpha=renderer.getClearAlpha();
      renderer.getViewport(viewport);renderer.getScissor(scissor);renderer.getClearColor(clearColor);
      try{
        scene.traverseVisible(o=>{if(o.material){const materials=Array.isArray(o.material)?o.material:[o.material];
          if(materials.every(m=>!m.depthWrite||!m.depthTest)){hidden.push(o);o.visible=false;}
          else for(const m of materials){if(!writes.has(m))writes.set(m,m.colorWrite);m.colorWrite=false;}
        }});
        // Retain the real material's skinning and alpha/cutout tests. A generic
        // depth override would turn holes in the hull into solid occluders.
        scene.background=null;scene.onBeforeRender=()=>{};
        renderer.autoClear=true;renderer.setRenderTarget(target);renderer.setScissorTest(false);
        renderPreparedScene(renderer,scene,camera);
      }finally{
        for(const o of hidden)o.visible=true;
        for(const [m,value] of writes)m.colorWrite=value;
        scene.background=background;scene.onBeforeRender=before;
        renderer.autoClear=autoClear;renderer.setClearColor(clearColor,alpha);
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
        // Restore the framebuffer last so its viewport wins over canvas state.
        renderer.setRenderTarget(previous);
      }
      frame=scene.renderCount;lastCamera=camera;
      }
      for(const pass of passes){const u=pass.uniforms;
        u.effectSceneDepth.value=target.depthTexture;u.effectDepthSize.value.copy(size);
        u.effectCameraRange.value.set(camera.near,camera.far);u.effectHasDepth.value=true;
      }
    },
    dispose(){target.dispose();},
  };
}
