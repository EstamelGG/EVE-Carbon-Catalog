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

test('TypeID shards resolve shared graphic components with distinct identities',async()=>{
  globalThis.location={href:'https://site.test/'};
  const index='https://assets.test/res/model-index.json';
  const records=new Map([
    [index,{version:4,items:'res/index/items',skins:'res/index/skins',
      ships:'res/index/ships.json',subsystems:'res/index/subsystems.json',dnaRecipes:{}}],
    ['https://assets.test/res/index/items/8.json',{dna:'graphic:1',name:{en:'First',zh:'一'},categoryID:7,groupID:53,skins:[44,45]}],
    ['https://assets.test/res/index/items/9.json',{dna:'graphic:1',name:{en:'Second',zh:'二'},categoryID:7,groupID:53}],
    ['https://assets.test/res/index/skins/44.json',{en:'Skin',zh:'涂装',b:'1:faction'}],
    ['https://assets.test/res/index/skins/45.json',{en:'Other',zh:'另一个',b:'1:race:material?gold'}],
    ['https://assets.test/res/index/models/graphic~3a~1.json',{model:'res/model/graphic1.glb',effects:'res/model/graphic1.effects.json'}],
  ]);
  const fetched=[];
  const resources=createComponentResources(index,async url=>{
    fetched.push(url);
    if(!records.has(url)) throw Error('Resource unavailable (404): '+url);
    return structuredClone(records.get(url));
  });
  const items=await Promise.all([resources.item(8),resources.item(9)]);
  assert.deepEqual(items.map(item=>item.name.en),['First','Second']);
  assert.equal(items[0].model,items[1].model);
  assert.equal(items[1].model,'https://assets.test/res/model/graphic1.glb');
  assert.deepEqual(items[0].skins,[44,45]);
  assert.equal(items[1].skins,undefined);
  // Opening a model never reads a skin file; the picker loads them on demand.
  assert.equal(fetched.filter(url=>url.includes('/skins/')).length,0);
  assert.deepEqual(await resources.skins(8),
    [{id:44,name:{en:'Skin',zh:'涂装'},b:'1:faction'},{id:45,name:{en:'Other',zh:'另一个'},b:'1:race:material?gold'}]);
  assert.deepEqual(await resources.skins(9),[]);
  assert.equal(fetched.filter(url=>url.endsWith('/items/8.json')).length,1);
  assert.equal(fetched.filter(url=>url.endsWith('graphic~3a~1.json')).length,1);
  await assert.rejects(()=>resources.item(700),/absent from the component index/);
});

test('a skin published with one body per race selects the item race',async()=>{
  globalThis.location={href:'https://site.test/'};
  const index='https://assets.test/res/model-index.json';
  const records=new Map([
    [index,{version:4,items:'res/index/items',skins:'res/index/skins',
      ships:'res/index/ships.json',subsystems:'res/index/subsystems.json',
      dnaRecipes:{cap1_t1:'res/index/hulls/cap1_t1.json'},layouts:'res/index/layouts.json'}],
    ['https://assets.test/res/index/items/670.json',
      {dna:'cap1_t1:upwell:jove',name:{en:'Hull',zh:'舰'},categoryID:6,groupID:1,skins:[2968]}],
    ['https://assets.test/res/index/skins/2968.json',{en:'Upwell',zh:'昇威',v:[
      {r:'amarr',b:'upwell:amarr:material?none'},
      {r:'jove',b:'upwell:jove:material?none'}]}],
    ['https://assets.test/res/index/hulls/cap1_t1.json',{base:{model:'res/cap1.glb',
      recipe:{options:'res/options.json',palette:'res/palette.json',areas:[]},
      appearance:{extras:{}},effects:'res/effects.json',name:{en:'Hull'}},paletteIndex:'res/palette.json'}],
    ['https://assets.test/res/palette.json',{races:{jove:{preview:{url:'res/preview.json'}}},
      factions:{upwell:'res/faction.json'},materials:{},materialPrefixes:[],patternPrefixes:[],patternNames:[]}],
    ['https://assets.test/res/faction.json',{definition:{},colors:[]}],
    ['https://assets.test/res/effects.json',{version:4,kind:'sof-hull-effects',hull:'cap1_t1',
      library:{url:'res/library.json'},rules:[],fixed:{booster:{placements:[]}}}],
    ['https://assets.test/res/library.json',{version:4,
      factions:{upwell:{url:'res/effect-faction.json'}},races:{jove:{url:'res/effect-race.json'}}}],
    ['https://assets.test/res/effect-faction.json',{definition:{},colors:[]}],
    ['https://assets.test/res/effect-race.json',{parameters:{},textures:{},lights:{}}],
    ['https://assets.test/res/options.json',{modern:true,patterns:{},inserts:{},layout:{images:[],slotMaterials:[],materials:[]}}],
  ]);
  const resources=createComponentResources(index,async url=>{
    if(!records.has(url)) throw Error('Resource unavailable (404): '+url);
    return structuredClone(records.get(url));
  });
  const item=await resources.item(670);
  const [skin]=await resources.skins(670);
  const styled=await resources.officialSkin(item,skin);
  assert.equal(styled.dna,'cap1_t1:upwell:jove:material?none');
});


test('Catalog availability comes from TypeID defaults', async()=>{
  const {joinDirectory}=await import('../../../public/build-directory.mjs');
  const data=joinDirectory({categories:[{id:6,name:{en:'Ship',zh:'舰船'},groups:[{id:25,name:{en:'Ships',zh:'舰船'},
      items:[[8,'Ship','舰船',52,500003],[9,'Other','另一']]}]}],
    items:{8:{id:8,dna:'hull:faction:race',raceID:4}},renderFallbacks:{8:8}},
    {races:[],factions:[{id:500003,name:{en:'Amarr'}}]},()=>({}));
  assert.equal(data.loader.item(8).available,true);
  assert.equal(data.loader.item(8).dna,'hull:faction:race');
  assert.equal(data.loader.item(8).metaGroupID,52);
  assert.equal(data.loader.item(8).factionID,500003);
  assert.deepEqual(data.loader.item(9).name,{en:'Other',zh:'另一'});
  assert.equal(data.loader.item(9).available,false);
  assert.equal(data.loader.item(9).factionID,undefined);
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
