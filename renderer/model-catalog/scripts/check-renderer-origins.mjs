import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Run from model-catalog. Compare the two real build entry points to the reviewed index.
const manifest=JSON.parse(await readFile('../docs/line-audit/renderer-origins.json','utf8'));
const {metafile}=await build({entryPoints:['scripts/eve-model-viewer.js','scripts/viewer-entry.js'],
  bundle:true,format:'esm',write:false,outdir:'out',metafile:true,loader:{'.html':'text','.css':'text','.otf':'binary'}});
const files=new Set(Object.keys(metafile.inputs).map(p=>p.split('?')[0])
  .filter(p=>/^(scripts|src)\/.*\.m?js$/.test(p)));
assert.deepEqual([...files].sort(),Object.keys(manifest).sort(),'Review new or removed modules');
for(const [file,record] of Object.entries(manifest)){
  const text=(await readFile(file,'utf8')).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),record.sha256,'Recheck provenance of '+file);
}
console.log('Verified',files.size,'runtime source modules');
