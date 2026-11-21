// Bundle against one Three.js instance. The prebuilt effects 1.5.0 bundle
// embeds an older postprocessing version incompatible with Three r183.
import '@google/model-viewer/lib/model-viewer.js';
import '@google/model-viewer-effects/lib/model-viewer-effects.js';
import './depth-of-field.js';
import './scene-sharpening.js';
import { installEmissionBloom } from './emission-bloom.js';
import {installHangarFramePipeline} from './hangar-frame-pipeline.js';
import {installAutoExposure} from './auto-exposure.js';
import {Renderer} from '@google/model-viewer/lib/three-components/Renderer.js';
import {createRenderPower} from './render-power.js';
export const renderPower=createRenderPower({
  initial:self.ModelViewerElement?.powerPreference||'high-performance',
  replace(value){
    self.ModelViewerElement??={};self.ModelViewerElement.powerPreference=value;
    if(Renderer._singleton){
      const previous=Renderer._singleton.threeRenderer;
      Renderer.resetSingleton();previous?.forceContextLoss();
    }
  },
});
import { $scene, $renderer, $tick, $onResize } from '@google/model-viewer/lib/model-viewer-base.js';
import {installDeferredResize} from './deferred-resize.js';
import {installRenderActivity} from './render-activity.js';
export function installViewerActivity(viewer) {
  return installRenderActivity(viewer, viewer[$renderer]);
}
export function installViewerResize(viewer) {
  const style = viewer.ownerDocument.createElement('style');
  // Stretch the previous-resolution image with CSS while layout follows the
  // pointer. Canvas backing buffers and the camera update only on commit.
  style.textContent = ':host([data-resize-pending]) canvas {width:100%!important;height:100%!important}';
  viewer.shadowRoot.append(style);
  const dispose = installDeferredResize(viewer, $onResize);
  return () => { dispose(); style.remove(); };
}
import {$controls} from '@google/model-viewer/lib/features/controls.js';
import {installAnnotationFocus as annotationFocus, skipEmptyHangarAnnotations} from './annotation-focus.js';
export function installAnnotationFocus(viewer) {
  const releaseFocus = annotationFocus(viewer, viewer[$controls], viewer[$scene]);
  const releaseAnnotations = skipEmptyHangarAnnotations(viewer, viewer[$scene]);
  return () => { releaseAnnotations(); releaseFocus(); };
}
import {installSubsystemLabels as subsystemLabels} from './subsystem-labels.js';
export function installSubsystemLabels(viewer, describe) {
  return subsystemLabels(viewer, viewer[$scene], describe, viewer.querySelector('effect-composer'));
}
import { smoothAutoRotate } from './smooth-auto-rotate.js';
import {installViewerZoom} from './viewer-camera.js';
export function installSmoothAutoRotate(viewer) {
  const releaseZoom = installViewerZoom(viewer, viewer[$controls]);
  const releaseRotation = smoothAutoRotate(viewer, $tick);
  return () => { releaseRotation(); releaseZoom(); };
}
import { hidePendingNativeSurfaces } from './pending-native-surfaces.js';
import { installDimensionFrame } from './dimension-frame.js';
export function watchDimensionFrame(viewer, canvas) {
  return installDimensionFrame(viewer[$scene], canvas, viewer.sourceDimensions);
}
export function prepareNativeSurfaces(viewer) {
  return hidePendingNativeSurfaces(viewer[$scene].model, viewer.originalGltfJson.materials);
}
export function installViewerBloom(viewer, bloom) {
  const composer=viewer.querySelector('effect-composer');
  const releasePipeline=installHangarFramePipeline(viewer,viewer[$scene],composer[$normalPass],composer.querySelector('ssao-effect').effects[0],composer[$effectComposer],composer[$renderPass]);
  const releaseBloom=installEmissionBloom(viewer[$scene],bloom);
  const releaseExposure=installAutoExposure(viewer,viewer[$scene]);
  return ()=>{releaseExposure();releaseBloom();releasePipeline();};
}
export {installNativePreview} from './native-viewer.js';
export {installFitting} from './fitting-viewer.js';
export {createHangarViewer} from './hangar-viewer.js';
export {prepareAppearanceUpdate} from './appearance-update.js';
export {loadEquipmentPreview, installEquipmentPreview} from './equipment-preview.js';
export {installShipEffects} from './ship-effects.js';
export {installSubsystemParts} from './subsystem-parts.js';
export {gltfDimensions} from './model-bounds.js';
export {prefetchViewerAssets} from './viewer-assets.js';
export {planViewerResources, selectedBackground} from './resource-plan.js';
export {preloadModel} from './model-preload.js';
export {createSkybox} from './skybox.js';
export {createViewerSession} from './viewer-session.js';
export {canReuseHull} from './appearance-signature.js';
export {exportModel} from './model-export.js';
import {$normalPass,$effectComposer,$renderPass} from '@google/model-viewer-effects/lib/effect-composer.js';
import {limitNormalsToDepthWriters} from './occlusion.js';
export function installHullOcclusion(composer) {
  return limitNormalsToDepthWriters(composer[$normalPass].renderPass);
}

export {exportSkybox} from './skybox-export.js';


export {captureFrame, waitForFrame, captureView, restoreView} from './viewer-camera.js';
export {watchViewerFPS, viewerGPU, watchViewerPerformance} from './viewer-metrics.js';
