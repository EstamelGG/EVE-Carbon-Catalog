import {fittingParameterNames} from '../scripts/fitting-materials.js';
export const fittingRuleBucket=name=>String(new TextEncoder().encode(name.toLowerCase()).reduce((sum,value)=>sum+value,0)%16);

// Same lookup order as SurfaceParameters.parameter and GetFactionTurretParameters.
export async function resolveFittingRules(url, dna, load) {
  if (!url || dna.startsWith('graphic:')) return undefined;
  const parts=dna.toLowerCase().split(':'), rules=await load(url);
  if(rules.version!==2 || rules.mode!=='sof-turret-rules')throw Error('Unsupported fitting rules; rebuild resources');
  const buckets=new Map();
  const record=async(kind,name)=>{
    const target=rules[kind][fittingRuleBucket(name)];
    if(!target)throw Error('Missing fitting rule bucket');
    if(!buckets.has(target))buckets.set(target,load(target));
    return (await buckets.get(target))[name];
  };
  const faction=await record('factions',parts[1]), commands=new Map();
  if(!faction)throw Error('Missing fitting faction: '+parts[1]);
  for(const token of parts.slice(3)){
    const [key,value]=token.split('?');commands.set(key,(value||'').split(';'));
  }
  const overrides=commands.get('material')||[], cache=new Map();
  const material=async name=>{
    if(!name || name.toLowerCase()==='none')return undefined;
    name=name.toLowerCase();
    if(!cache.has(name))cache.set(name,record('materials',name));
    return cache.get(name);
  };
  const prefixes=rules.materialPrefixes, parameters={};
  for(const parameter of fittingParameterNames){
    const original=prefixes.findIndex(p=>parameter.toLowerCase().startsWith(p.toLowerCase()));
    const lookup=original<0?parameter:prefixes[faction.materialUsage[original]]+parameter.slice(prefixes[original].length);
    const slot=prefixes.findIndex(p=>lookup.toLowerCase().startsWith(p.toLowerCase()));
    const suffix=slot<0?lookup:lookup.slice(prefixes[slot].length);
    let value=slot<0?undefined:(await material(overrides[slot]))?.[suffix];
    if(value===undefined)for(const section of faction.sections){
      if(lookup==='GeneralGlowColor'){value=section.glowColor;break;}
      if(slot>=0 && section.materials[slot]){
        value=(await material(section.materials[slot]))?.[suffix];break;
      }
    }
    if(value!==undefined){
      if(!Array.isArray(value)||value.length!==4||!value.every(Number.isFinite))throw Error('Invalid fitting rule result: '+parameter);
      parameters[parameter]=[...value];
    }
  }
  const key=url+'|'+dna;
  return {version:1,mode:'authored-overrides',byDNA:{[dna]:key},profiles:{[key]:parameters}};
}
