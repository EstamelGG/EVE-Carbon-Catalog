import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFittingData} from './fitting-data.mjs';

test('only requests the current hull and its equipment shards', async()=>{
  const records={ship:{version:3,hullCategory:6,equipmentShards:['turrets'],materialRules:null},
    structure:{version:3,hullCategory:65,equipmentShards:['structureWeapons'],materialRules:null},
    turrets:{version:1,equipment:[{id:461},{id:462,supported:false}]},
    structureWeapons:{version:1,equipment:[{id:900}]}};
  const calls=[], load=async key=>{calls.push(key);return records[key];};
  const ship=await loadFittingData({fitting:'ship'},load);
  assert.deepEqual(calls,['ship','turrets']);assert.deepEqual(ship.equipment,[{id:461}]);
  calls.length=0;
  const structure=await loadFittingData({fitting:'structure'},load);
  assert.deepEqual(calls,['structure','structureWeapons']);
  assert.equal(structure.hullCategory,65);assert.equal(structure.appearance,undefined);
});

test('missing hull data does not request a global fitting file', async()=>{
  assert.deepEqual((await loadFittingData({},()=>{throw Error('Unexpected request');})).equipment,[]);
  await assert.rejects(loadFittingData({fitting:'bad'},async()=>({version:2})),/version 3/);
});
