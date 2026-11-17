import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFittingData} from './fitting-data.mjs';

test('version 4 uses only the hull compatibility shards and SDE slots', async()=>{
  const slots=[
    {slot:1,requirement:'launcher',family:'locator_turret_',nativeSlot:1},
    {slot:2,requirement:'launcher',family:'locator_turret_',nativeSlot:2},
  ];
  const records={
    ship:{version:4,hullCategory:6,hardpoints:{launcher:2,turret:0},slots,
      equipmentShards:['launchers'],materialRules:null},
    launchers:{version:1,equipment:[
      {id:501,requirement:'launcher'},
      {id:461,requirement:'turret'},
      {id:85084,requirement:'unsupported'},
    ]},
  };
  const calls=[],load=async key=>{calls.push(key);return records[key];};
  const ship=await loadFittingData({fitting:'ship'},load,[{name:'locator_turret_1a'}]);
  assert.deepEqual(calls,['ship','launchers']);
  assert.deepEqual(ship.equipment,[{id:501,requirement:'launcher'}]);
  assert.deepEqual(ship.slots,slots);
});

test('version 4 keeps structure equipment in its category', async()=>{
  const records={
    structure:{version:4,hullCategory:65,hardpoints:{launcher:0,turret:1},
      slots:[{slot:1,requirement:'turret',family:'locator_turretm_',nativeSlot:1}],
      equipmentShards:['structureWeapons'],materialRules:null},
    structureWeapons:{version:1,equipment:[{id:35939,requirement:'turret'}]},
  };
  const load=async key=>records[key];
  const structure=await loadFittingData({fitting:'structure'},load,[{name:'locator_turretm_1a'}]);
  assert.deepEqual(structure.equipment,[{id:35939,requirement:'turret'}]);
  assert.equal(structure.hullCategory,65);
  assert.equal(structure.appearance,undefined);
});

test('version 3 remains readable but does not invent launcher compatibility', async()=>{
  const records={
    ship:{version:3,hullCategory:6,equipmentShards:['turrets'],materialRules:null},
    turrets:{version:1,equipment:[{id:461}]},
    'res/fitting/lists/7-locator_turret_.json':{version:1,equipment:[{id:461}]},
  };
  const calls=[],load=async key=>{calls.push(key);return records[key];};
  const ship=await loadFittingData({fitting:'ship'},load,[{name:'locator_turret_1a'}]);
  assert.deepEqual(calls,['ship','turrets','res/fitting/lists/7-locator_turret_.json']);
  assert.deepEqual(ship.equipment,[{id:461}]);
  assert.equal(ship.slots,undefined);
});

test('missing hull data does not request a global fitting file', async()=>{
  assert.deepEqual((await loadFittingData({},()=>{throw Error('Unexpected request');})).equipment,[]);
  await assert.rejects(loadFittingData({fitting:'bad'},async()=>({version:2})),/version 3 or 4/);
});
