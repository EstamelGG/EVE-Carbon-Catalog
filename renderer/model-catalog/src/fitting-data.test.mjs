import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFittingData} from './fitting-data.mjs';

test('requests the current hull and only equipment shards for exact mount families', async()=>{
  const records={ship:{version:3,hullCategory:6,equipmentShards:['turrets'],materialRules:null},
    structure:{version:3,hullCategory:65,equipmentShards:['structureWeapons'],materialRules:null},
    turrets:{version:1,equipment:[{id:461},{id:462,supported:false}]},
    'res/fitting/lists/7-locator_turret_.json':{version:1,equipment:[{id:461}]},
    'res/fitting/lists/7-locator_launcher_.json':{version:1,equipment:[{id:501}]},
    structureWeapons:{version:1,equipment:[{id:900}]}};
  const calls=[], load=async key=>{calls.push(key);return records[key];};
  const ship=await loadFittingData({fitting:'ship'},load,[{name:'locator_turret_1a'}]);
  assert.deepEqual(calls,[
    'ship','turrets',
    'res/fitting/lists/7-locator_turret_.json',
  ]);
  assert.deepEqual(ship.equipment,[{id:461}]);
  calls.length=0;
  records['res/fitting/lists/66-locator_turretm_.json']={version:1,equipment:[{id:35939}]};
  const structure=await loadFittingData({fitting:'structure'},load,[{name:'locator_turretm_1a'}]);
  assert.deepEqual(calls,['structure','structureWeapons','res/fitting/lists/66-locator_turretm_.json']);
  assert.deepEqual(structure.equipment,[{id:900},{id:35939}]);
  assert.equal(structure.hullCategory,65);assert.equal(structure.appearance,undefined);
});

test('legacy chain assets are not synthesized without exact chain locators', async()=>{
  const records={
    ship:{version:3,hullCategory:6,equipmentShards:['turrets'],materialRules:null},
    turrets:{version:1,equipment:[{id:461}]},
    'res/fitting/lists/7-locator_launcher_.json':{version:1,equipment:[{id:501}]},
    'res/index/models/graphic~3a~24572.json':{
      renderKind:'equipment',model:'chain_s.glb',groupID:4060,categoryID:7,
      fittingEquipment:{locatorName:'locator_chain_'},itemIds:[54739,54740],
      name:{en:'Small Vorton Projector I',zh:'小型电弧弦投射器 I'},
      itemNames:{54740:{en:'Small Compact Vorton Projector',zh:'小型紧凑型电弧弦投射器'}},
    },
  };
  const load=async key=>{
    if(records[key])return records[key];
    throw Error('Not found');
  };
  const ship=await loadFittingData({fitting:'ship'},load,[{name:'locator_turret_1a'}]);
  assert.deepEqual(ship.equipment.map(({id})=>id),[461]);
});

test('missing hull data does not request a global fitting file', async()=>{
  assert.deepEqual((await loadFittingData({},()=>{throw Error('Unexpected request');})).equipment,[]);
  await assert.rejects(loadFittingData({fitting:'bad'},async()=>({version:2})),/version 3/);
});
