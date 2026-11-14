import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run = promisify(execFile);
export async function encodeTexture({dds,uri,scratch,ktx,threads=6,decodeDdsLevel,save}) {
  if (dds.cube) throw Error('Expected a 2D hull texture: '+uri);
  const levels = dds.faces[0], files = [];
  for (let i=0;i<levels.length;i++) {
    const file = path.join(scratch,i+'.rgba');
    const pixels = decodeDdsLevel(dds,0,i);
    if (dds.format === 'BC5') {
      // The material consumes a glTF XYZ tangent normal. BC5 stores only XY.
      for (let j=0;j<pixels.length;j+=4) {
        const x=pixels[j]/127.5-1, y=pixels[j+1]/127.5-1;
        pixels[j+2]=Math.round(127.5*(1+Math.sqrt(Math.max(0,1-x*x-y*y))));
      }
    }
    await fs.writeFile(file,pixels);
    files.push(file);
  }
  const {width,height} = levels[0];
  const temp = path.join(scratch,'texture.ktx2');
  const {stdout:encoded}=await run(ktx,['create','--raw','--format',dds.srgb?'R8G8B8A8_SRGB':'R8G8B8A8_UNORM',
    '--width',String(width),'--height',String(height),'--levels',String(levels.length),'--encode','uastc',
    '--uastc-quality','1','--threads',String(threads),'--zstd','5',...files,'-'],{windowsHide:true,encoding:'buffer',maxBuffer:128*1024*1024});
  await fs.writeFile(temp,encoded);
  await run(ktx,['validate',temp],{windowsHide:true});
  return {file:await save(encoded),width,height,mips:levels.length};
}
