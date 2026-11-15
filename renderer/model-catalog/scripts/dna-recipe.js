const own=(object,key)=>Object.hasOwn(object,key);
function option(options,key,label){
  if(!own(options,key))throw Error(label+' · '+key);
  return options[key];
}

export async function assembleDNA(dna,index,load,resolveURL){
  const [hull,faction,race,...tokens]=dna.split(':');
  const base=option(index.dnaRecipes||{},hull,'未发布舰体');
  const [palette,options,packet]=await Promise.all([load(base.recipe.palette),load(base.recipe.options),load(base.effects)]);
  const factionData=option(palette.factions,faction,'未发布阵营');
  const selection=option(options.bindings,faction,'舰体缺少该阵营的绑定');
  const style=option(palette.races,race,'缺少种族配置');
  const commands=new Map();
  for(const token of tokens){
    const [key,...rest]=token.split('?');
    const limit={material:4,pattern:3,respathinsert:1}[key];
    const values=(rest[0]||'').split(';');
    if(!['material','pattern','respathinsert'].includes(key)||commands.has(key)||rest.length!==1||
       values.length>limit||values.some(v=>!v))throw Error('DNA 参数无效 · '+token);
    commands.set(key,values);
  }
  const materials=commands.get('material')||[], pattern=commands.get('pattern')||[];
  const layers=pattern.length?option(options.patterns,pattern[0],'图案没有此舰体的投影'):null;
  const insert=commands.get('respathinsert')?.[0];
  const variants=insert && insert!=='none'?option(options.inserts,insert,'缺少贴图变体'):
    insert==='none'?{}:options.inserts[factionData.insert]||{};
  for(const name of [...materials,...pattern.slice(1)])if(name!=='none')option(palette.materials,name,'未知材质');
  const layout=options.layouts[selection.layout];
  const appearance=structuredClone({...layout,materials:layout.materials.map(i=>options.materialPool[i]),extras:base.appearance.extras});
  const directory=base.model.split('/').slice(0,-1);
  const relative=url=>'../'.repeat(directory.length-1)+url.slice(4);
  const modelURL=new URL('/'+base.model,location.href);
  const variant=uri=>uri?variants[decodeURI(new URL(uri,modelURL).pathname.slice(1))]?.url:undefined;
  for(const image of appearance.images)if(variant(image.uri))image.uri=relative(variant(image.uri));
  const visited=new Map();
  for(const area of base.recipe.areas){
    for(let slot=area.slot;slot<area.slot+area.count;slot++){
      const material=appearance.materials[appearance.slotMaterials[slot]];
      if(!material)continue;
      const root=material.extras.ccpdecNative;
      const offset=visited.get(slot)||0;
      visited.set(slot,offset+1);
      const native=offset?root.overlays?.[offset-1]:root;
      if(!native)continue;
      for(const [role,uri] of Object.entries(native.textures))if(variant(uri))native.textures[role]=relative(variant(uri));
      for(const key of area.parameters){
        for(const [prefixes,names,blocked] of [[palette.materialPrefixes,materials,area.blocked],
              [palette.patternPrefixes,pattern.slice(1),0]]){
          const i=prefixes.findIndex(prefix=>key.toLowerCase().startsWith(prefix.toLowerCase()));
          if(i<0 || blocked & (1<<i))continue;
          const value=palette.materials[names[i]]?.[key.slice(prefixes[i].length)];
          if(value)native.parameters[key]=value;
        }
        if(key==='GeneralHeatGlowColor' && ['Primary','Reactor'].includes(area.area))
          native.parameters[key]=factionData.colors[style.heat[area.area==='Primary'?0:1]];
      }
      if(layers){
        native.patterns=[];
        for(const role of ['PatternMask1Map','PatternMask2Map']){
          const fallback=area.patternDefaults?.[role];
          if(fallback)native.textures[role]=relative(fallback.url);
          else delete native.textures[role];
        }
        for(const layer of layers){
          if(layer.excluded.includes(area.area))continue;
          native.textures[layer.role]=relative(layer.map.url);
          if(area.patternRoles.includes(layer.role))native.patterns.push(layer.mask);
        }
      }
    }
  }
  function selected(field){
    return selection[field].flatMap(i=>options.parts[field][i]);
  }
  const children=selected('children');
  const smart=selected('smart');
  const effects={...packet,booster:packet.booster.placements.length?{...packet.booster,...style.style}:packet.booster,
    sprites:selected('sprites'),attachmentSpotlights:selected('spotlights'),
    planeGlow:{...packet.planeGlow,sets:selected('planes')},
    lighting:{...packet.lighting,mode:smart.length?'smart':'none',sets:smart},
    supplements:{meshes:children.flatMap(c=>c.meshes),flares:children.flatMap(c=>c.flares),
      unsupported:children.flatMap(c=>c.unsupported||[]),decals:selected('decals').map(decal=>({...decal,
        textures:Object.fromEntries(Object.entries(decal.textures).map(([k,map])=>[k,variants[map.url]||map]))}))}};
  function restoreGeometry(node){
    if(!node || typeof node!=='object')return node;
    if(Object.hasOwn(node,'geometryIndex'))return options.geometry[node.geometryIndex];
    if(Array.isArray(node))return node.map(restoreGeometry);
    return Object.fromEntries(Object.entries(node).map(([key,value])=>[key,restoreGeometry(value)]));
  }
  const url=new URL(resolveURL(base.effects),location.href);
  url.searchParams.set('faction',faction);
  url.searchParams.set('race',race);
  url.searchParams.set('insert',insert??factionData.insert);
  url.searchParams.set('palette',base.recipe.palette);
  url.searchParams.set('options',base.recipe.options);
  return {...base,dna,available:true,name:{zh:(base.name?.zh||hull)+' · 自定义',en:(base.name?.en||hull)+' · Custom'},model:resolveURL(base.model),preview:style.preview.url,
    appearance,appearanceRevision:base.appearanceRevision+'-'+base.recipe.options+'-'+base.recipe.palette+'-'+dna,
    effects:url.href,recipeEffects:restoreGeometry(effects)};
}
