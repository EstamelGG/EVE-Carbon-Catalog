import {hullEffects,factionParameter,legacyLayers} from './hull-definition.js';
const own=(object,key)=>Object.hasOwn(object,key);
function option(options,key,label){
  if(!own(options,key))throw Error(label+' · '+key);
  return options[key];
}

export async function assembleDNA(dna,index,load,resolveURL,{officialSkin=false}={}){
  const [hull,faction,race,...tokens]=dna.split(':');
  const entry=option(index.dnaRecipes||{},hull,'未发布舰体');
  const {base,paletteIndex}=await load(entry);
  const [[palette,factionData],options,packet]=await Promise.all([
    load(paletteIndex).then(async palette=>{
      const entry=option(palette.factions,faction,'未发布阵营');
      return [palette,await load(entry)];
    }),
    load(base.recipe.options),load(base.effects),
  ]);
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
  const layers=pattern.length?(pattern[0]==='none' || (officialSkin && !own(options.patterns,pattern[0]))?[]:
    option(options.patterns,pattern[0],'图案没有此舰体的投影')):options.modern?
    options.patterns[factionData.definition.defaultPatternName]??[]:legacyLayers(factionData.definition.defaultPattern,options.projection);
  const insert=commands.get('respathinsert')?.[0];
  // A SOF insert overrides individual textures only when that resource exists.
  const insertName=insert??factionData.insert;
  const variants=insertName && insertName!=='none' && own(options.inserts,insertName)?options.inserts[insertName]:{};
  for(const name of [...materials,...pattern.slice(1)])if(name!=='none')option(palette.materials,name,'未知材质');
  const appearance=structuredClone({...options.layout,extras:base.appearance.extras});
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
      const native=root.profile==='fx-surface-v1'?root.overlays?.[offset]:offset?root.overlays?.[offset-1]:root;
      if(!native)continue;
      for(const [role,uri] of Object.entries(native.textures))if(variant(uri))native.textures[role]=relative(variant(uri));
      for(const key of area.parameters){
        const value=factionParameter(key,area.area,options,factionData,palette);
        if(value)native.parameters[key]=value;
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
      if(layers.length && native.profile==='quad-runtime-v1'){
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
  const effects=hullEffects(options,packet,factionData,variants);
  if(effects.booster.placements.length)effects.booster={...effects.booster,...style.style};
  const url=new URL(resolveURL(base.effects),location.href);
  url.searchParams.set('faction',faction);
  url.searchParams.set('race',race);
  url.searchParams.set('insert',insert??factionData.insert);
  url.searchParams.set('palette',base.recipe.palette);
  url.searchParams.set('options',base.recipe.options);
  return {...base,dna,available:true,name:{zh:(base.name?.zh||hull)+' · 自定义',en:(base.name?.en||hull)+' · Custom'},model:resolveURL(base.model),preview:style.preview.url,
    appearance,appearanceRevision:base.appearanceRevision+'-'+base.recipe.options+'-'+base.recipe.palette+'-'+dna,
    effects:url.href,recipeEffects:effects};
}
