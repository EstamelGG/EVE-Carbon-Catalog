// ZIP_STORED is the publisher contract: no compression, Base64, or dependency on
// a ZIP library. Original resource URLs remain the cache identity and base URL.
import {loadArrayBuffer} from '../src/resource-activity.mjs';

const memberPath = /^assets\/(?!hangar-bundles\/)[A-Za-z0-9_./-]+$/;
const archivePath = /^assets\/hangar-bundles\/[a-f0-9]{64}\.zip$/;
const decoder = new TextDecoder('utf-8', {fatal: true});
const crcTable = Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function validPath(path){return memberPath.test(path)&&!path.split('/').some(p=>p==='..'||p==='.'||!p);}

export function readStoredBundle(buffer, expected) {
  const bytes=new Uint8Array(buffer), view=new DataView(buffer), result=new Map();
  let cursor=0;
  while(cursor+4<=bytes.length && view.getUint32(cursor,true)===0x04034b50){
    if(cursor+30>bytes.length)throw Error('Truncated hangar bundle header');
    const flags=view.getUint16(cursor+6,true), method=view.getUint16(cursor+8,true);
    const crc=view.getUint32(cursor+14,true), size=view.getUint32(cursor+18,true), raw=view.getUint32(cursor+22,true);
    const nameLength=view.getUint16(cursor+26,true), extra=view.getUint16(cursor+28,true);
    const start=cursor+30+nameLength+extra, end=start+size;
    if((flags&~0x800)||method!==0||size!==raw||end>bytes.length)throw Error('Unsupported or truncated hangar bundle');
    const name=decoder.decode(bytes.subarray(cursor+30,cursor+30+nameLength));
    if(!validPath(name)||result.has(name)||!Object.hasOwn(expected,name)||expected[name]!==size)
      throw Error('Invalid hangar bundle member: '+name);
    const payload=bytes.subarray(start,end);
    if(crc32(payload)!==crc)throw Error('Corrupt hangar bundle member: '+name);
    result.set(name,payload);cursor=end;
  }
  if(result.size!==Object.keys(expected).length||cursor+4>bytes.length||view.getUint32(cursor,true)!==0x02014b50)
    throw Error('Incomplete hangar bundle');
  return result;
}

export function createHangarBundleCache(resolveURL, load=loadArrayBuffer) {
  const packages=new Map(), members=new Map(), blobs=new Map();
  let disposed=false;
  const absolute=value=>new URL(resolveURL(value),location.href).href;
  const key=value=>{const url=new URL(absolute(value));url.search='';url.hash='';return url.href;};
  const check=()=>{if(disposed)throw Error('Hangar bundle session disposed');};
  async function prepare(room) {
    check();
    const plan=room?.resourceBundles;
    if(!plan)return;
    if(plan.version!==1||!Array.isArray(plan.groups))throw Error('Unsupported hangar bundle manifest');
    let cursor=0;
    async function worker(){
      while(cursor<plan.groups.length){
        const descriptor=plan.groups[cursor++];
        if(!archivePath.test(descriptor.url)||!descriptor.members||typeof descriptor.members!=='object')
          throw Error('Invalid hangar bundle descriptor');
        const url=absolute(descriptor.url);
        if(!packages.has(url))packages.set(url,(async()=>{
          const buffer=await load(url,undefined,'resourceModel');check();
          if(buffer.byteLength!==descriptor.bytes)throw Error('Hangar bundle length mismatch');
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
          check();
          if(!descriptor.url.endsWith('/'+digest+'.zip'))throw Error('Hangar bundle checksum mismatch');
          return readStoredBundle(buffer,descriptor.members);
        })().catch(error=>{packages.delete(url);throw error;}));
        const entries=await packages.get(url);check();
        // Validate even on a cache hit; reject conflicting descriptors.
        if(entries.size!==Object.keys(descriptor.members).length)throw Error('Conflicting hangar bundle descriptor');
        for(const [path,bytes] of entries){
          if(descriptor.members[path]!==bytes.byteLength)throw Error('Conflicting hangar bundle member');
          const id=key(path), old=members.get(id);
          if(old?.url!==url && blobs.has(id)){URL.revokeObjectURL(blobs.get(id));blobs.delete(id);}
          members.set(id,{bytes,url});
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(4,plan.groups.length)},worker));
  }
  function objectURL(value){
    const id=key(value), member=members.get(id);
    if(!member)return resolveURL(value);
    check();
    if(!blobs.has(id)){
      const type=id.endsWith('.webp')?'image/webp':id.endsWith('.png')?'image/png':id.endsWith('.jpg')?'image/jpeg':'application/octet-stream';
      blobs.set(id,URL.createObjectURL(new Blob([member.bytes],{type})));
    }
    return blobs.get(id);
  }
  return {prepare,objectURL,
    has:value=>members.has(key(value)),
    json(value){check();const entry=members.get(key(value));return entry?JSON.parse(decoder.decode(entry.bytes)):undefined;},
    arrayBuffer(value){check();const entry=members.get(key(value));return entry?.bytes.slice().buffer;},
    transportURL(value){return members.get(key(value))?.url||absolute(value);},
    dispose(){disposed=true;for(const url of blobs.values())URL.revokeObjectURL(url);blobs.clear();members.clear();packages.clear();},
  };
}
