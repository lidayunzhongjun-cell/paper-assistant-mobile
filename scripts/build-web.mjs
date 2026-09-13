import { build } from 'esbuild';
import { mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'android/assets'); mkdirSync(assets, { recursive: true });
await build({ entryPoints: [path.join(root, 'web/app.mjs'), path.join(root, 'web/graph-worker.mjs')], outdir: assets, bundle: true, format: 'esm', target: ['chrome110'], loader: { '.svg': 'dataurl', '.png': 'dataurl', '.gif': 'dataurl' }, legalComments: 'eof', logLevel: 'info' });
copyFileSync(path.join(root, 'web/index.html'), path.join(assets, 'index.html'));
copyFileSync(path.join(root, 'web/graph-worker.html'), path.join(assets, 'graph-worker.html'));
copyFileSync(path.join(root, 'web/compat.js'), path.join(assets, 'compat.js'));
const pdf = path.join(root, 'node_modules/pdfjs-dist');
const compatibility = readFileSync(path.join(root, 'web/compat.js'), 'utf8');
const worker = readFileSync(path.join(pdf, 'legacy/build/pdf.worker.mjs'), 'utf8');
writeFileSync(path.join(assets, 'pdf.worker.mjs'), compatibility + '\n' + worker);
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(path.join(pdf,name), path.join(assets,name), { recursive: true });
for (const name of ['mammoth','cfb','adler-32','crc-32']) copyFileSync(path.join(root,'node_modules',name,'LICENSE'),path.join(assets,name.toUpperCase()+'-LICENSE.txt'));
copyFileSync(path.join(pdf,'LICENSE'), path.join(assets,'PDFJS-LICENSE.txt'));
copyFileSync(path.join(root,'../paper-assistant-next/LICENSE'), path.join(assets,'AGPL-LICENSE.txt'));
copyFileSync(path.join(root,'third_party/LARA-LICENSE.txt'), path.join(assets,'LARA-LICENSE.txt'));
copyFileSync(path.join(root,'third_party/GSON-NOTICE.txt'), path.join(assets,'GSON-NOTICE.txt'));
const meta = JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
writeFileSync(path.join(assets,'NOTICE.txt'), `论文精读 ${meta.version}\nCore: Paper Assistant Next 2.1.1 (AGPL-3.0-or-later)\nLara Java SDK 1.12.0: Translated (MIT)\nGson 2.11.0: Google (Apache-2.0)\nPDF.js: Mozilla Foundation (Apache-2.0)\nMammoth: Michael Williamson (BSD-2-Clause)\nCFB: SheetJS (Apache-2.0)\nDependency licenses: THIRD-PARTY-NOTICES.txt, LARA-LICENSE.txt, GSON-NOTICE.txt\n`);
const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));let notices='Production dependency license texts\n';
for(const [name,info] of Object.entries(lock.packages)){if(!name||info.dev)continue;const directory=path.join(root,name);if(!existsSync(directory))continue;
  notices+='\n\n=== '+name+' '+info.version+' ('+info.license+') ===\n';
  for(const file of readdirSync(directory).filter(n=>/^(licen[sc]e|copying|notice)([.-]|$)/i.test(n)))try{notices+=readFileSync(path.join(directory,file),'utf8')+'\n';}catch{}
}
writeFileSync(path.join(assets,'THIRD-PARTY-NOTICES.txt'),notices);
console.log(`Mobile web assets ready: ${meta.version}`);

cpSync(path.join(root,'node_modules/katex/dist'),path.join(assets,'katex'),{recursive:true});
copyFileSync(path.join(root,'node_modules/katex/LICENSE'),path.join(assets,'KATEX-LICENSE.txt'));
