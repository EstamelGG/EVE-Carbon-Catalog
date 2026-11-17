import {createOpaqueVisibility} from './opaque-visibility.js';
import {beforeSceneRender} from './effect-resources.js';
import {Vector2} from 'three';
import {createSceneBuffers,registerSceneBuffers,sceneBuffers} from './scene-buffers.js';

export function installHangarFramePipeline(viewer,scene,normalPass,ao,composer,scenePass){
  const buffers=createSceneBuffers(scene,{active:()=>viewer.hangarActive&&!viewer.disableSharedSceneBuffers});
  const visibility=createOpaqueVisibility(scene,buffers),drawScene=scenePass.render;
  const releaseVisibility=beforeSceneRender(scene,(camera,renderer)=>visibility.hideOccluded(renderer,camera),{afterUpdates:true});
  scenePass.render=function(renderer,input,...rest){
    const draw=()=>drawScene.call(this,renderer,input,...rest);
    return viewer.hangarActive&&!viewer.disableSharedSceneBuffers ?
      visibility.render(renderer,scene.getCamera(),input,draw) : draw();
  };
  viewer.sceneBufferStats=buffers.stats;
  const unregister=registerSceneBuffers(scene,buffers),render=normalPass.render,size=new Vector2();
  // The scene needs multisampling for geometry coverage. Each fullscreen
  // triangle covers every pixel, including pixels on the viewport boundary.
  // Keep both HDR postprocessing targets single-sampled, including the
  // second write, which would otherwise ping-pong back into the scene target.
  const renderFrame=composer.render,postTargets=[];
  function postTarget(index,source){
    let target=postTargets[index];
    if(!target || target.texture.type!==source.texture.type){
      target?.dispose();
      target=source.clone();
      target.samples=0;
      target.depthTexture=null;
      target.depthBuffer=false;
      postTargets[index]=target;
    }
    target.setSize(source.width,source.height);
    return target;
  }
  composer.render=function(deltaTime){
    const passes=this.passes.filter(pass=>pass.enabled);
    if(!viewer.hangarActive || !this.inputBuffer.samples || this.inputBuffer.stencilBuffer ||
      passes[0]!==scenePass || scenePass.needsSwap ||
      passes.some((pass,index)=>index>0 && (pass===normalPass ?
        pass.needsSwap || pass.needsDepthBlit : !pass.effects || (!pass.needsSwap && !pass.skipRendering) || pass.needsDepthBlit)))
      return renderFrame.call(this,deltaTime);
    if(deltaTime===undefined){this.timer.update();deltaTime=this.timer.getDelta();}
    if(!Number.isFinite(deltaTime))deltaTime=0;
    this.preRender();
    try{
      let input=this.inputBuffer,index=0;
      for(const pass of passes){
        const output=pass.effects && !pass.renderToScreen ? postTarget(index,this.outputBuffer) : this.outputBuffer;
        pass.render(this.renderer,input,output,deltaTime,false);
        if(pass.needsDepthBlit && this.depthRenderTarget)this.blitDepthBuffer(input);
        if(pass.needsSwap){input=output;index=1-index;}
      }
    }finally{this.postRender();}
  };
  const originalNormal=normalPass.texture;
  const modeChanged=()=>{if(!viewer.hangarActive){ao.normalBuffer=originalNormal;visibility.clear();buffers.reset();}};
  viewer.addEventListener('hangar-mode-change',modeChanged);
  normalPass.render=function(renderer,input,...rest){
    if(input)size.set(input.width,input.height);else renderer.getDrawingBufferSize(size);
    const shared=sceneBuffers(scene,renderer,scene.getCamera(),size.x,size.y);
    ao.normalBuffer=shared?.normal||originalNormal;
    if(shared)return;
    return render.call(this,renderer,input,...rest);
  };
  return ()=>{releaseVisibility();scenePass.render=drawScene;visibility.clear();composer.render=renderFrame;for(const target of postTargets)target.dispose();viewer.removeEventListener('hangar-mode-change',modeChanged);normalPass.render=render;ao.normalBuffer=originalNormal;unregister();buffers.dispose();delete viewer.sceneBufferStats;};
}
