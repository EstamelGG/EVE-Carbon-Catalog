import path from 'node:path';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function encodeTexture({dds,uri,normalMap,scratch,ktx,decodeDdsLevel,save}) {
  if (dds.cube) throw Error('Expected a 2D hull texture: '+uri);
  const levels = dds.faces[0], files = [];
  for (let i=0;i<levels.length;i++) {
    const file = path.join(scratch,i+'.rgba');
    const pixels = decodeDdsLevel(dds,0,i);
    if (normalMap && dds.format === 'BC5') {
      // The material consumes a glTF XYZ tangent normal. BC5 stores only XY.
      for (let j=0;j<pixels.length;j+=4) {
        const x=pixels[j]/127.5-1, y=pixels[j+1]/127.5-1;
        pixels[j+2]=Math.round(127.5*(1+Math.sqrt(Math.max(0,1-x*x-y*y))));
      }
    }
    await fs.writeFile(file,pixels);
    files.push(file);
  }
  const tiers = {};
  for (const [tier,start] of [['low',Math.max(0,levels.findIndex(m=>Math.max(m.width,m.height)<=128))],['full',0]]) {
    const {width,height} = levels[start], count = levels.length-start;
    const temp = path.join(scratch, tier+'.ktx2');
    const encoded=execFileSync(ktx,['create','--raw','--format',dds.srgb?'R8G8B8A8_SRGB':'R8G8B8A8_UNORM',
      '--width',String(width),'--height',String(height),'--levels',String(count),'--encode','uastc',
      '--uastc-quality','1','--threads','6','--zstd','5',...files.slice(start),'-'],{windowsHide:true,maxBuffer:128*1024*1024});
    await fs.writeFile(temp,encoded);
    execFileSync(ktx,['validate',temp],{windowsHide:true});
    const file = await save(tier, encoded);
    tiers[tier]={file,width,height,mips:count};
  }
  return tiers;
}
