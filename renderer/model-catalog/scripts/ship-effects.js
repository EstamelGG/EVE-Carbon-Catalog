import {authoredLocal} from './ship-authored-spotlights.js';
import {installHullFixtures} from './hull-fixtures.js';
import { pageActivity, ambientAnimationLoop } from './page-activity.js';
import {effectsEnabled} from '../src/display-settings.mjs';
import { $scene } from '@google/model-viewer/lib/model-viewer-base.js';
import { resourceURL } from '../src/resource-location.mjs';
import { installLighting } from './ship-lighting.js';
import { installAttachmentLights } from './ship-attachment-lights.js';
import { installPlanes } from './ship-planes.js';
import { installSupplements } from './ship-supplements.js';
import { installHullOverlays } from './ship-hull-overlays.js';
import { installGateEffects } from './ship-gates.js';
import { createShipDamage } from './ship-damage.js';
import { createEffectResources } from './effect-resources.js';
import { resolveEffectGeometry } from './effect-geometry.mjs';
import {effectGeometry} from './effect-glb.js';
import { loadJSON } from '../src/resource-activity.mjs';
import { installLightBudget } from './effect-performance.js';
import { installNavigationLights } from './navigation-lights.js';
import { CubeTexture, DataTexture, Data3DTexture, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { installBoosterLights, previewBoosterGain } from './booster-lights.js';
import { createFlameBox, createBoosterFlame } from './booster-flame.js';

export async function installShipEffects(viewer, url, initialMode = 'cruise', {parent = null, deferred = false, sharedTextures = true, bindPlaneVideos, hangarBodies, attachmentOwner, typeID} = {}) {
  const controllerVariables=Object.create(null);
  const publications = [];
  const onCommit = callback => publications.push(callback);
  const scene = viewer[$scene],
    model = scene.model,
    group = new Group();
  if (!model || !viewer.isConnected) return { dispose() {}, setMode() {} };
  group.name = 'EVE authored effects';
  group.visible = false;
  const loadTexture = sharedTextures && viewer.loadSourceTexture;
  const resources = createEffectResources(loadTexture
      ? url => loadTexture(new URL(url, location.href).href) : undefined, viewer.assetSession?.resolveURL || resourceURL, viewer.assetSession?.binaryURL),
    effectTime = { value: 0 },
    flames = [];
  // Texture settings are part of the cache key; local materials and geometry
  // still belong to this effect instance and are disposed independently.
  if (viewer.assetSession && sharedTextures) resources.texture = viewer.assetSession.resources.texture;
  let disposed = false,
    loop,
    mode = initialMode,
    flightMode = initialMode === 'idle' ? 'idle' : 'cruise',
    lastTime = null,
    elapsed = 0,
    disposeSpotlights,
    disposeLightBudget,
    disposeAttachmentLights,
    disposePlanes,
    disposeSupplements,
    disposeHullOverlays,
    gate, sceneEffects, childEffects, damage;
  const activity = pageActivity(viewer.ownerDocument);
  const syncVideoPlayback = () => resources.setPlaying(!disposed && group.visible && activity.active && mode !== 'paused');
  const unsubscribeActivity = activity.subscribe(syncVideoPlayback);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeActivity();
    loop?.stop();
    disposeSpotlights?.();
    disposeLightBudget?.();
    disposeAttachmentLights?.();
    disposePlanes?.();
    disposeSupplements?.();
    disposeHullOverlays?.();
    gate?.dispose();
    sceneEffects?.dispose();
    childEffects?.dispose();
    damage?.dispose();
    group.removeFromParent();
    resources.dispose();
  };
  try {
    const packed = viewer.assetSession ? await viewer.assetSession.json(url) : await (async () => {
      const response = await fetch(resourceURL(url), {cache: 'no-cache'});
      if (!response.ok) throw new Error('Missing ship effects');
      return response.json();
    })();
    let data={...packed};
    const read=path=>viewer.assetSession?viewer.assetSession.json(path):loadJSON(resourceURL(path));
    // Resolve each independent effect list separately so a corrupt shared mesh or
    // animation only drops the entry that refers to it.
    async function resolveEntry(entry,role) {
      try { return await resolve(entry); }
      catch(error) {
        if(error?.name==='AbortError')throw error;
        console.error('[eve-model-viewer] Effect skipped',{typeID:data.typeID,role,url},error);
        return null;
      }
    }
    const resolve=doc=>resolveEffectGeometry(doc,read,6,ref=>effectGeometry(viewer.assetSession,ref));
    try {data=await resolve(packed);}
    catch(error){
      if(error?.name==='AbortError')throw error;
      for(const field of ['scene','gate','supplements','lighting','planeGlow']){
        if(!data[field])continue;
        const section={...data[field]};
        for(const [role,entries] of Object.entries(section)){
          if(Array.isArray(entries)){
            section[role]=(await Promise.all(entries.map(entry=>resolveEntry(entry,field+'.'+role)))).filter(entry=>entry!=null);
          }else if(entries && typeof entries==='object'){
            section[role]=await resolveEntry(entries,field+'.'+role);
            if(!section[role]){data[field]=null;break;}
          }
        }
        if(data[field])data[field]=section;
      }
    }
    const loadEffectTexture=resources.texture;
    resources.texture=async (record,options)=>{
      try {return await loadEffectTexture(record,options);}
      catch(error){
        if(error?.name==='AbortError')throw error;
        console.error('[eve-model-viewer] Effect texture skipped',{typeID:data.typeID,url:record?.url,effects:url},error);
        const pixel=new Uint8Array(4);
        let empty;
        if(record?.cube){
          const face=resources.own(new DataTexture(pixel,1,1));
          empty=new CubeTexture(Array(6).fill(face));
        }else{
          empty=record?.volume?new Data3DTexture(pixel,1,1,1):new DataTexture(pixel,1,1);
        }
        resources.own(empty);
        empty.needsUpdate=true;
        return empty;
      }
    };
    if (data.version !== 3) throw new Error(`Unsupported ship effects version: ${data.version}`);
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return { dispose: cleanup, setMode() {} };
    }
    const b = data.booster,
      p = b.parameters;
    const currentGain = () => previewBoosterGain(b, flightMode);
    const boosterGain = {value:currentGain()};
    const tex = Object.fromEntries(
      await Promise.all(
        Object.entries(b.textures).map(async ([role, record]) => [
          role,
          await resources.texture(record),
        ]),
      ),
    );
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return { dispose: cleanup, setMode() {} };
    }
    const box = resources.own(createFlameBox());
    for (const [index, placement] of b.placements.entries()) {
      const mesh = createBoosterFlame(box, placement, p, tex, effectTime, boosterGain, index / b.placements.length);
      resources.own(mesh.material);
      const base = new Matrix4().fromArray(placement.transform.flat());
      mesh.matrix.copy(base);
      mesh.frustumCulled = false;
      group.add(mesh);
      flames.push({ mesh, base });
    }
    const updateBoosterLights = installBoosterLights(group, b, model.scale.x, data.typeID);
    updateBoosterLights(0, boosterGain.value);
    installNavigationLights(group, attachmentOwner?.model ?? model, attachmentOwner?.document ?? viewer.originalGltfJson, data.sprites, resources, effectTime, model.scale.x);
    disposeAttachmentLights = await installAttachmentLights(group, data.attachmentSpotlights, resources, model.scale.x, {
      scene, model:attachmentOwner?.model ?? model, document:attachmentOwner?.document ?? viewer.originalGltfJson, boosterGain,
    });
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return { dispose: cleanup, setMode() {} };
    }
    const childSets=(data.supplements?.smartLights||[]).map(set=>{
      const base=set.transforms.reduce((m,t)=>m.multiply(authoredLocal(t)),new Matrix4());
      function palette(g){
        const color=v=>v?.colorSlot!=null?data.fixtureColors[v.colorSlot]:v;
        return {...g,activeColor:color(g.activeColor),activeBlendColor:color(g.activeBlendColor),
          attributeModifiers:g.attributeModifiers?.map(palette),lightGroups:g.lightGroups?.map(palette)};
      }
      return {groups:set.groups.map(palette),placements:set.placements.map(([p,q,s,bone])=>{
        const position=new Vector3(...p),rotation=new Quaternion(...q),scale=new Vector3(...s);
        new Matrix4().compose(position,rotation,scale).premultiply(base).decompose(position,rotation,scale);
        return [position.toArray(),rotation.toArray(),scale.toArray(),bone];
      })};
    });
    if(childSets.length)data.lighting={...data.lighting,mode:'smart',sets:[...data.lighting.sets,...childSets]};
    disposeSpotlights = await installLighting(
      viewer,
      scene,
      group,
      data.lighting,
      resources,
      () => ({ elapsed, controllerVariables, warping: flightMode === 'warp', cruising: flightMode !== 'idle', docked: viewer.hangar?.active && viewer.hangar.selection.mode === 'dock' }),
    );
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return { dispose: cleanup, setMode: () => {} };
    }
    disposePlanes = await installPlanes(
      viewer,
      scene,
      group,
      data.planeGlow,
      resources,
      () => elapsed,
      bindPlaneVideos, attachmentOwner,
    );
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return { dispose: cleanup, setMode() {} };
    }
    const fixtures=await installHullFixtures(data,resources,group,viewer.assetSession?.bannerImages);
    if(data.supplements)data.supplements={...data.supplements,lights:[...(data.supplements.lights||[]),...fixtures.lights],transparent:[...(data.supplements.transparent||[]),...fixtures.meshes]};
    disposeSupplements = await installSupplements(viewer, scene, group, data.supplements, resources, () => ({elapsed}), onCommit, attachmentOwner);
    const child=data.supplements;
    if(child?.particles?.length || child?.transparent?.length || child?.softFlares?.length || child?.lines?.length){
      const particles=(child.particles||[]).flatMap((g,i)=>g.draws.map(d=>({...d,particleNodeIndex:i})));
      childEffects=await installGateEffects(viewer,scene,group,{animation:{generic:true,targets:[],sets:[]},
        particles,meshes:child.transparent||[],lines:child.lines||[],flares:child.softFlares||[],unsupported:[]},resources,()=>elapsed,'childEffects',[],onCommit,attachmentOwner);
    }
    gate = await installGateEffects(viewer, scene, group, data.gate, resources, () => elapsed, null, [], onCommit);
    sceneEffects = await installGateEffects(viewer, scene, group, data.scene, resources, () => elapsed, null, hangarBodies, onCommit, attachmentOwner);
    damage = createShipDamage(viewer, scene, group, data.damage, () => elapsed);
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return {dispose: cleanup, setMode() {}};
    }
    disposeHullOverlays = await installHullOverlays(viewer, scene, group, resources, () => elapsed, parent || model, onCommit);
    if (!viewer.isConnected || scene.model !== model) {
      cleanup();
      return {dispose: cleanup, setMode() {}};
    }
    group.userData.eveEffects = true;
    const flameScale = new Vector3();
    let lastFlameGain;
    const tick = (now) => {
      if (disposed) return;
      resources.setPlaying(group.visible && activity.active && mode !== 'paused');
      // Opaque hangar traffic and dock bodies live in the room layout but
      // follow this clock. Keep their motion independent of the FX switch.
      if ((!group.visible && !hangarBodies?.length && !sceneEffects?.dockRangeActive) || !activity.active || mode === 'paused') {
        lastTime = now;
        return;
      }
      if (lastTime !== null && activity.active && mode !== 'paused')
        elapsed += Math.max(0, now - lastTime) / 1000;
      lastTime = now;
      const gain = currentGain();
      boosterGain.value = gain;
      if (flames.length && gain !== lastFlameGain) {
        lastFlameGain = gain;
        flameScale.set(p.BoosterScale[0],p.BoosterScale[1],p.BoosterScale[2]*(Math.min(gain,1)*.5+.5));
        for (const {mesh,base} of flames) {
          mesh.visible = gain > 0;
          mesh.matrix.copy(base).scale(flameScale);
        }
      }
      updateBoosterLights(elapsed, gain);
      effectTime.value = elapsed;
      if (activity.active && mode !== 'paused') scene.queueRender();
    };
    loop = ambientAnimationLoop(scene, tick, viewer.ownerDocument);
    let committed = false;
    const commit = () => {
      if (committed || disposed || !viewer.isConnected || scene.model !== model) return;
      committed = true;
      for (const publish of publications.splice(0)) publish();
      (parent || model).add(group);
      group.visible = effectsEnabled(viewer.displaySettings);
      damage?.setVisible(group.visible);
      disposeLightBudget = installLightBudget(scene, group);
      syncVideoPlayback();
      loop.start();
    };
    if (!deferred) commit();
    viewer.dataset.effects = JSON.stringify({
      sprites: data.sprites.length,
      boosters: flames.length,
      planes: data.planeGlow?.sets.reduce((n, set) => n + set.planes.length, 0) || 0,
    });
    return {
      dispose: cleanup,
      commit,
      gate,
      sceneEffects,
      hasDamage: !!damage,
      setDamage(value) { return damage?.setEnabled(value) || Promise.resolve(); },
      setVisible(value) {
        if (group.visible !== (value !== false)) lastTime = null;
        group.visible = value !== false;
        damage?.setVisible(group.visible);
        resources.setPlaying(group.visible && activity.active && mode !== 'paused');
        scene.queueRender();
      },
      setControllerVariable(name,value) {
        controllerVariables[name]=value;
        scene.queueRender();
      },
      setMode(value) {
        if (value === 'paused' || mode === 'paused') lastTime = null;
        mode = value;
        resources.setPlaying(group.visible && activity.active && mode !== 'paused');
        if (value !== 'paused') flightMode = value;
        scene.queueRender();
      },
    };
  } catch (error) {
    cleanup();
    if(error?.name==='AbortError')throw error;
    console.error('[eve-model-viewer] Optional effect document skipped',
      {typeID:typeID??viewer.originalGltfJson?.extras?.ccpdec?.typeID,url},error);
    return {dispose(){},commit(){},setMode(){},setVisible(){}};

  }
}
