import assert from 'node:assert/strict';
import test from 'node:test';
import {parseSharedHull} from './shared-hull.js';

test('attachment slots retain the mesh palette and Carbon color stays outside the glTF base color', async ()=>{
  const doc={meshes:[{primitives:[{extras:{materialIndex:0},attributes:{POSITION:0,COLOR_0:1}}]}],
    extras:{ccpdec:{bonePalette:['wing','root']}},nodes:[{name:'root'},{name:'wing'}],
    skins:[{joints:[0,1]}],extensionsUsed:[],extensionsRequired:[]};
  const json=Buffer.from(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4;
  const bytes=Buffer.alloc(28+length,32);
  bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
  bytes.writeUInt32LE(0,20+length);bytes.writeUInt32LE(0x004e4942,24+length);
  const appearance={materials:[{}],slotMaterials:[0],textures:[],images:[],samplers:[],extras:{ccpdec:{}}};
  const result=await parseSharedHull({register(){},unregister(){},parseAsync:JSON.parse},
    {buffer:(_,load)=>load(),arrayBuffer:()=>Uint8Array.from(bytes).buffer},'https://example.test/hull.glb',appearance);
  assert.deepEqual(result.extras.ccpdec.bonePalette,['wing','root']);
  assert.deepEqual(result.meshes[0].primitives[0].attributes,{POSITION:0,_CCP_DIFFUSE_COLOR_0:1});
  assert.deepEqual(appearance.extras,{ccpdec:{}});
});
