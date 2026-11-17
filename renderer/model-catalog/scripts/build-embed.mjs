import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Normalize the app's cache-busting query suffixes to one module identity.
// The page and old vendor bundle needed globals to communicate; one embed
// bundle can keep resource activity and camera state private to its closure.
const embeddedModules = {
  name: 'embedded-modules',
  setup(build) {
    build.onResolve({ filter: /\.m?js\?v=/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.split('?')[0]),
    }));
    build.onLoad({ filter: /[\\/](resource-activity|view-reset)\.mjs$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8');
      contents = contents
        .replace('globalThis[key] ||= createResourceActivity()', 'createResourceActivity()')
        .replace('globalThis[cameraState] ||= {', '{');
      return { contents, loader: 'js' };
    });
  },
};
const result = await build({
  entryPoints: ['scripts/eve-model-viewer.js'],
  outfile: 'dist/eve-model-viewer.js',
  bundle: true,
  write: false,
  minify: true,
  format: 'esm',
  loader: { '.html': 'text', '.css': 'text', '.otf': 'binary' },
  legalComments: 'inline',
  metafile: true,
  plugins: [embeddedModules],
});
const output = Object.values(result.metafile.outputs);
if (Object.keys(result.metafile.inputs).some((file) => /\.m?js\?v=/.test(file)))
  throw Error('Embed modules must have one identity without cache-version suffixes');
if (output.length !== 1 || output[0].imports.length)
  throw Error('Embed must be a single self-contained JavaScript file');
await mkdir('dist/vendor/basis', { recursive: true });
for (const file of result.outputFiles) await writeFile(file.path, file.contents);
await copyFile('src/third-party-notices.txt', 'dist/third-party-notices.txt');
await copyFile('src/vendor/basis/README.md', 'dist/vendor/basis/README.md');
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  await copyFile(`node_modules/three/examples/jsm/libs/basis/${name}`, `dist/vendor/basis/${name}`);
}
await writeFile(
  'dist/eve-model-viewer.meta.json',
  JSON.stringify({ bytes: output[0].bytes, externalImports: output[0].imports }, null, 2) + '\n',
);
console.log(
  `Standalone component: ${(output[0].bytes / 1024 / 1024).toFixed(2)} MiB, no external JS/CSS imports`,
);
