import {Matrix4,Quaternion,Vector3} from 'three';

// Resolve authored placement rules in the browser. The publisher stores only
// hull components, locators and layout definitions.
export async function assembleLayoutDNA(root, names, definitions, compose) {
  const parts=[],components=new Map();
  let seed=0;
  for(const character of root.dna) seed=(Math.imul(seed,31)+character.charCodeAt(0))>>>0;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  async function place(item, layouts, world, ancestors) {
    if(item.model) parts.push({...item,layoutPart:true,slot:parts.length,matrix:world.toArray(),offset:new Vector3().setFromMatrixPosition(world).toArray()});
    const [hull,faction,race]=item.dna.split(':');
    for(const name of layouts) {
      const key=hull+':'+name;
      if(ancestors.has(key)) continue;
      const rows=definitions[name];
      if(!rows) throw Error('Unpublished layout: '+name);
      for(const row of rows) {
        const fields={hull,faction,race};
        if((row.distributionConditions||[]).some(condition=>
          ![3,4,5].includes(condition.displayFilter??5)||Object.entries(condition.parentDescriptor||{})
            .some(([key,value])=>key!=='_type'&&fields[key]!==value))) continue;
        const locators=(item.locatorSets||[]).filter(set=>set.name.toLowerCase()===row.locatorSetName.toLowerCase()).flatMap(set=>set.locators);
        const descriptor=row.descriptor;
        let dna=[descriptor.hull,descriptor.faction||faction,descriptor.race||race].join(':').toLowerCase();
        const materials=[1,2,3,4].map(index=>descriptor['material'+index]||'none');
        if(materials.some(value=>value!=='none')) dna+=':material?'+materials.join(';');
        const distribution=row.distribution||{};
        const cap=distribution.cap??-1;
        for(const locator of cap<0?locators:locators.slice(0,cap)) {
          if(random()>(distribution.completeness??1)) continue;
          const local=new Matrix4().compose(new Vector3(...(locator.position||[0,0,0])),
            new Quaternion(...(locator.rotation||[0,0,0,1])),new Vector3(...(locator.scaling||[1,1,1])));
          if(!components.has(dna))components.set(dna,Promise.resolve(compose(dna)));
          const child=await components.get(dna);
          await place(child,(descriptor.layout||'').toLowerCase().split(';').filter(Boolean),
            world.clone().multiply(local),new Set([...ancestors,key]));
        }
      }
    }
  }
  await place(root,names,new Matrix4(),new Set());
  const model=new URL(root.model);
  model.pathname=model.pathname.replace(/\.glb$/,'.layout.gltf');
  model.searchParams.set('dna',root.dna);
  return {...root,model:model.href,appearance:undefined,recipeEffects:undefined,
    layoutAssembly:true,subsystemParts:parts};
}
