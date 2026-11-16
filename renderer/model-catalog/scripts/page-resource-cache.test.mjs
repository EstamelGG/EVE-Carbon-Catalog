import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageResourceCache} from './page-resource-cache.js';

test('path keywords match new files without relying on filenames, hosts or queries',()=>{
 const cache=createPageResourceCache(['res/dx9/model/booster','  ','RES/TEXTURE/GLOBAL']);
 assert.equal(cache.hot('https://example.org/root/res/dx9/model/booster/new/sub/file.ktx2?v=2'),true);
 assert.equal(cache.hot('https://example.org/res/texture/global/new.ktx2'),true);
 assert.equal(cache.hot('https://example.org/private.ktx2?path=res/dx9/model/booster'),false);
 assert.equal(cache.hot('https://example.org/private.ktx2'),false);
 assert.equal(cache.hot('https://example.org/res/dx9/model/ship/a.ktx2'),false);
});

test('pins hot loads across consumers, separates origins and retries failures',async()=>{
 const cache=createPageResourceCache(['res/common.ktx2']);let calls=0;
 const load=()=>{calls++;return {value:calls};};
 const url='https://one.test/a/res/common.ktx2?v=1';
 assert.equal(await cache.load('bytes',url,load),await cache.load('bytes',url,load));assert.equal(calls,1);
 await cache.load('bytes','https://two.test/a/res/common.ktx2?v=1',load);
 await cache.load('bytes','https://one.test/a/res/common.ktx2?v=2',load);assert.equal(calls,3);
 await cache.load('bytes','https://one.test/res/private.ktx2',load);await cache.load('bytes','https://one.test/res/private.ktx2',load);assert.equal(calls,5);
 await assert.rejects(cache.load('json',url,()=>Promise.reject(Error('retry'))));
 assert.equal(await cache.load('json',url,()=>42),42);
});
test('page teardown releases page-owned textures and geometry exactly once',()=>{
 const cache=createPageResourceCache(['res/common.glb']);let textureDisposals=0,geometryDisposals=0;
 cache.resources(()=>({dispose(){textureDisposals++;}}));
 const create=()=>({dispose(){geometryDisposals++;}});
 assert.equal(cache.geometry('https://one.test/res/common.glb#mesh0',create),cache.geometry('https://one.test/res/common.glb#mesh0',create));
 cache.dispose();cache.dispose();assert.equal(textureDisposals,1);assert.equal(geometryDisposals,1);
});
