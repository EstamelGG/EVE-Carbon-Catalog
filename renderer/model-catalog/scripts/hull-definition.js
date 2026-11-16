const f=Math.fround;
function lightColor(rule,colors,definition){
  if(rule.planeColor!==undefined)
    return definition.planeSets?.find(s=>s.groupIndex===rule.planeColor)?.color??rule.fallback;
  let rgba=colors[rule.colorSlot];
  if(rule.spotColor){
    if(rule.modern){
      const peak=Math.max(...rgba.slice(0,3)), divisor=Math.max(1,peak);
      rgba=rgba.map((x,i)=>i===3?x:(peak-rule.saturation*(peak-x))*rule.brightness/divisor);
    }else rgba=definition.spotlightSets?.find(s=>s.groupIndex===rule.groupIndex)?.[rule.spotColor]??[0,0,0,0];
    return rgba.map(c=>f(c*rule.intensity));
  }
  if(rule.intensity===undefined)return rgba;
  const scaled=rgba.map(c=>f(c*rule.intensity));
  if(rule.saturation===1)return scaled;
  const [r,g,b]=scaled;
  const lum=f(f(f(r*f(.299))+f(g*f(.587)))+f(b*f(.114)));
  return scaled.map((v,i)=>i===3?v:f(lum+f(f(v-lum)*Math.max(0,rule.saturation))));
}

export function hullEffects(options,packet,faction,variants){
  const definition=faction.definition,visible=new Set(definition.visibilityGroupSet?.visibilityGroups);
  const parts={sprites:[],planes:[],smart:[],children:[],decals:[],spotlights:[]};
  function resolve(node,logo){
    if(node===null || typeof node!=='object')return node;
    if(node.logoRole)return logo?.get(node.logoRole);
    if(node.colorSlot!==undefined || node.planeColor!==undefined)return lightColor(node,faction.colors,definition);
    if(Array.isArray(node))return node.map(v=>resolve(v,logo));
    return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,resolve(v,logo)]).filter(([,v])=>v!==undefined));
  }
  for(const rule of options.rules){
    if(rule.visible!=null && !visible.has(rule.visible))continue;
    if(rule.legacy!=null && (definition.children||[]).some(c=>(c.groupIndex??-1)===rule.legacy && !c.isVisible))continue;
    const source=definition.logoSet?.[rule.logo]?.textures;
    if(rule.logo && !source?.length)continue;
    const logo=source && new Map(source.map(t=>[t.name,t.resFilePath??undefined]));
    for(const input of rule.draws){
      if(logo && Object.values(input.textures||{}).some(t=>t.logoRole && logo.has(t.logoRole) && !logo.get(t.logoRole)))continue;
      const value=resolve(input,logo);
      if(rule.field==='planes'){
        value.planes=value.planes.filter(p=>p.color.some(Boolean));if(!value.planes.length)continue;
      }
      if(rule.field==='spotlights'&&!options.modern){
        value.items=value.items.filter((_,i)=>definition.spotlightSets?.some(g=>g.groupIndex===input.items[i].coneColor.groupIndex));
        if(!value.items.length)continue;
      }
      if(rule.field==='decals')for(const [k,map] of Object.entries(value.textures))value.textures[k]=variants[map.url]||map;
      parts[rule.field].push(value);
    }
  }
  const combined=mergeChildren(parts.children);
  return {...packet,...(combined.gate?{gate:combined.gate}:{}),fixtureColors:faction.colors,fixtureVisibility:[...visible],sprites:parts.sprites,attachmentSpotlights:parts.spotlights,
    planeGlow:{...packet.planeGlow,sets:parts.planes},lighting:{...packet.lighting,mode:parts.smart.length?'smart':'none',sets:parts.smart},
    supplements:{...combined.supplements,decals:parts.decals}};
}


// Animation target and motion indices are local to each shared resource instance.
export function mergeChildren(children){
  const supplements={meshes:[],flares:[],lights:[],lines:[],particles:[],softFlares:[],smartLights:[],transparent:[],unsupported:[],motionTracks:[]};
  const gate={version:1,animation:{targets:[],sets:[],completeStates:true},meshes:[],particles:[],flares:[],lines:[],lights:[],unsupported:[]};
  let particleBase=0;
  for(const input of children){
    const child=structuredClone(input),motionBase=supplements.motionTracks.length,targetBase=gate.animation.targets.length;
    function rebase(node){
      if(!node || typeof node!=='object')return;
      if(Number.isInteger(node.motionTrack))node.motionTrack+=motionBase;
      if(Number.isInteger(node.fxID))node.fxID+=targetBase;
      if(node.fxParameters)for(const key of Object.keys(node.fxParameters))node.fxParameters[key]+=targetBase;
      if(Number.isInteger(node.particleNodeIndex))node.particleNodeIndex+=particleBase;
      for(const value of Object.values(node))if(value && typeof value==='object')rebase(value);
    }
    rebase(child);
    for(const key of Object.keys(supplements))supplements[key].push(...child[key]||[]);
    if(child.gate){
      const animation=child.gate.animation;
      for(const set of animation.sets)for(const track of set.tracks)track.target+=targetBase;
      gate.animation.targets.push(...animation.targets);gate.animation.sets.push(...animation.sets);
      gate.animation.completeStates&&=animation.completeStates!==false;
      for(const key of ['meshes','particles','flares','lines','lights','unsupported'])gate[key].push(...child.gate[key]||[]);
      particleBase=1+Math.max(-1,...gate.particles.map(p=>p.particleNodeIndex??-1));
    }
  }
  return {supplements,...(gate.animation.sets.length?{gate}:{})};
}

export function factionParameter(key,area,options,faction,palette){
  const {definition,colors}=faction;
  const section=definition.areaTypes||{}, prefix=palette.materialPrefixes.find(p=>key.toLowerCase().startsWith(p.toLowerCase()));
  const slot=palette.materialPrefixes.indexOf(prefix)+1;
  const p=palette.patternPrefixes.find(p=>key.toLowerCase().startsWith(p.toLowerCase()));
  if(p){
    const i=palette.patternPrefixes.indexOf(p)+1;
    if(i===1||options.modern){
      const mat=definition['defaultPatternLayer'+i+'MaterialName'];
      const value=palette.materials[mat?.toLowerCase()]?.[key.slice(p.length)];
      if(value)return value;
    }
  }
  const sections=[...(area==='Wreck'?[options.wreck]:[]),section[area],section.Primary];
  for(const entry of sections){
    if(!entry)continue;
    if(key==='GeneralGlowColor')return colors[entry.colorType??12];
    if(prefix && entry['material'+slot])return palette.materials[entry['material'+slot].toLowerCase()]?.[key.slice(prefix.length)];
  }
}

export function legacyLayers(layer,projection){
  if(!projection||!layer?.textureResFilePath?.url || !layer.textureName)return [];
  const address=v=>({1:3,2:4})[v]??1;
  const u=address(layer.projectionTypeU),v=address(layer.projectionTypeV);
  return [{role:layer.textureName,map:layer.textureResFilePath,excluded:[],
    mask:{role:layer.textureName,position:projection.position??[0,0,0],rotation:projection.rotation??[0,0,0,1],scaling:projection.scaling??[1,1,1],
      isMirrored:!!projection.isMirrored,clampU:u===3,clampV:v===3,addressU:u,addressV:v,materialIndex:layer.materialSource??0,
      targetMaterials:[1,2,3,4].map(i=>Number(layer['isTargetMtl'+i]??1))}}];
}
