import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleLayoutDNA} from './layout-recipe.js';
import {createComponentResources} from './component-resources.js';

test('layout instances inherit DNA and combine nested transforms at runtime',async()=>{
  const locators=position=>[{name:'dock',locators:[{position}]}];
  const root={dna:'root:faction:race:layout?outer',model:'https://assets.test/root.glb',locatorSets:locators([10,0,0])};
  const requested=[];
  const compose=async dna=>{
    requested.push(dna);
    return {dna,model:'https://assets.test/part.glb',locatorSets:locators([2,0,0])};
  };
  const definitions={outer:[{locatorSetName:'dock',descriptor:{hull:'child',material1:'gold',layout:'inner'}}],
    inner:[{locatorSetName:'dock',descriptor:{hull:'last'}}]};
  const result=await assembleLayoutDNA(root,['outer'],definitions,compose);
  assert.deepEqual(requested,['child:faction:race:material?gold;none;none;none','last:faction:race']);
  assert.equal(result.subsystemParts.length,3);
  assert.deepEqual(result.subsystemParts.map(part=>part.offset),[[0,0,0],[10,0,0],[12,0,0]]);
  assert.equal(result.layoutAssembly,true);
  assert.equal(result.appearance,undefined);
});

test('TypeID directory resolves shared graphic components with distinct identities',async()=>{
  globalThis.location={href:'https://site.test/'};
  const index='https://assets.test/res/model-index.json';
  const records=new Map([
    [index,{version:4,directory:'res/index/directory.json'}],
    ['https://assets.test/res/index/directory.json',{items:{
      8:{id:8,dna:'graphic:1',name:{en:'First',zh:'一'},categoryID:7,groupID:53,officialSkins:[{id:44}]},
      9:{id:9,dna:'graphic:1',name:{en:'Second',zh:'二'},categoryID:7,groupID:53}},
      assets:{'graphic:1':'res/index/models/graphic1.json'}}],
    ['https://assets.test/res/index/models/graphic1.json',{model:'res/model/graphic1.glb',effects:'res/model/graphic1.effects.json'}],
  ]);
  const resources=createComponentResources(index,async url=>{
    assert.ok(records.has(url),'Unexpected resource '+url);
    return structuredClone(records.get(url));
  });
  await resources.loadCatalog();
  const items=await Promise.all([resources.catalog.item(8),resources.catalog.item(9)]);
  assert.deepEqual(items.map(item=>item.name.en),['First','Second']);
  assert.equal(items[0].model,items[1].model);
  assert.deepEqual(items[0].officialSkins,{8:[{id:44}]});
  assert.equal(items[1].model,'https://assets.test/res/model/graphic1.glb');
});


test('Catalog availability comes from TypeID defaults', async()=>{
  const {joinDirectory}=await import('../../../public/build-directory.mjs');
  const data=joinDirectory([{id:6,groups:[{id:25,name:{en:'Ships'},items:[{id:8,name:{en:'Ship'}},{id:9}]}]}],
    {items:{8:{id:8,dna:'hull:faction:race',raceID:4}}},
    {races:[],factions:[]},()=>({}));
  assert.equal(data.loader.item(8).available,true);
  assert.equal(data.loader.item(8).dna,'hull:faction:race');
  assert.equal(data.loader.item(9).available,false);
});


test('material DNA is calculated from shared hull and material data',async()=>{
  globalThis.location={href:'https://site.test/'};
  const {assembleDNA}=await import('./dna-recipe.js');
  const original={profile:'quad-runtime-v1',textures:{},parameters:{Mtl1DiffuseColor:[0,0,0,1]}};
  const records={
    hull:{base:{model:'res/hull.glb',effects:'effects',appearance:{extras:{}},appearanceRevision:'1',
      recipe:{options:'options',palette:'palette',areas:[{slot:0,count:1,area:'Primary',parameters:['Mtl1DiffuseColor'],blocked:0}]}},paletteIndex:'palette'},
    options:{modern:true,patterns:{},inserts:{},layout:{images:[],slotMaterials:[0],
      materials:[{extras:{ccpdecNative:original}}]}},
    palette:{races:{race:{preview:{url:'res/preview.json'}}},factions:{faction:'faction'},
      materials:{red:{DiffuseColor:[1,0,0,1]},gold:{DiffuseColor:[1,0.8,0,1]}},
      materialPrefixes:['Mtl1'],patternPrefixes:[],patternNames:[]},
    faction:{definition:{areaTypes:{Primary:{material1:'red'}}},colors:[]},
    effects:{version:4,kind:'sof-hull-effects',hull:'hull',library:{url:'library'},
      rules:[],fixed:{booster:{placements:[]}}},
    library:{version:4,factions:{faction:{url:'faction'}},races:{}},
  };
  const requested=[];
  const load=async key=>{requested.push(key);assert.ok(records[key],key);return structuredClone(records[key]);};
  const resolve=key=>new URL(key,'https://assets.test/').href;
  const index={dnaRecipes:{hull:'hull'}};
  const gold=await assembleDNA('hull:faction:race:material?gold',index,load,resolve);
  const red=await assembleDNA('hull:faction:race',index,load,resolve);
  const color=item=>item.appearance.materials[0].extras.ccpdecNative.parameters.Mtl1DiffuseColor;
  assert.deepEqual(color(gold),[1,0.8,0,1]);
  assert.deepEqual(color(red),[1,0,0,1]);
  assert.deepEqual(original.parameters.Mtl1DiffuseColor,[0,0,0,1]);
  assert.ok(requested.every(key=>!key.includes(':')));
});
