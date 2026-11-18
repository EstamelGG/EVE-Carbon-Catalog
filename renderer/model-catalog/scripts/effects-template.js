import {hullEffects} from './hull-definition.js';

export function effectInstanceURL(url,dna) {
  const result=new URL(url,location.href);
  result.searchParams.set('dna',dna);
  return result.href;
}

function placeChild(source,placement) {
  const child=structuredClone(source);
  function visit(node) {
    if(!node || typeof node!=='object')return;
    if(node.effectRoot){
      node.translation=placement.translation??[0,0,0];
      node.rotation=placement.rotation??[0,0,0,1];
      node.scaling=placement.scaling??[1,1,1];
      delete node.effectRoot;
    }
    for(const [key,value] of Object.entries(node)){
      if((key==='transforms'||key==='parents') && Array.isArray(value)){
        const root=value.findIndex(node=>node.effectRoot);
        if(root>=0){
          delete value[root].effectRoot;
          value.splice(root,0,{type:'trinity.EveChildContainer',translation:placement.translation??[0,0,0],
            rotation:placement.rotation??[0,0,0,1],scaling:placement.scaling??[1,1,1]});
        }
        if(placement.parentTransform)value.unshift({type:'trinity.EveChildContainer',useSRT:false,localTransform:placement.parentTransform});
      }
      if(value && typeof value==='object')visit(value);
    }
  }
  visit(child);
  return child;
}

export async function assembleEffects(template,dna,load) {
  if(template.version!==4 || template.kind!=='sof-hull-effects')throw Error('Unsupported hull effects; rebuild resources');
  const [hull,factionName,raceName,...tokens]=dna.toLowerCase().split(':');
  if(hull!==template.hull)throw Error('Effects hull does not match DNA');
  const commands=new Map(tokens.map(token=>token.split('?')));
  const library=await load(template.library.url);
  if(library.version!==4)throw Error('Unsupported effect library');
  const factionURL=library.factions[factionName]?.url,raceURL=library.races[raceName]?.url;
  if(!factionURL || (!raceURL && template.fixed.booster.placements.length))throw Error('Missing effect faction or race');
  const [faction,style]=await Promise.all([load(factionURL),raceURL?load(raceURL):{parameters:{},textures:{},lights:{}}]);
  const visible=new Set(faction.definition.visibilityGroupSet?.visibilityGroups);
  const rules=await Promise.all(template.rules.filter(rule=>
    (rule.visible==null || visible.has(rule.visible)) &&
    (rule.legacy==null || !(faction.definition.children||[]).some(c=>(c.groupIndex??-1)===rule.legacy && !c.isVisible))
  ).map(async rule=>({...rule,draws:await Promise.all(rule.draws.map(async draw=>
    draw.effectResource ? placeChild(await load(draw.effectResource.url),draw.placement) : draw))})));
  const insert=commands.get('respathinsert')?.split(';')[0]??faction.insert;
  const variants=insert && insert!=='none'?template.inserts?.[insert]||{}:{};
  const {instancedMeshes=[],...fixed}=structuredClone(template.fixed);
  const packet={version:3,...fixed,planeGlow:{version:1,unsupported:[]},lighting:{unsupported:[]}};
  const result=hullEffects({modern:template.modern,rules,instancedMeshes},packet,faction,variants);
  result.booster={...result.booster,...structuredClone(style)};
  return result;
}
