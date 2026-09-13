import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
const root = path.resolve(import.meta.dirname,'..'); const entries={};
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
function file(base,name,key){entries[key]=readFileSync(path.join(base,name));}
function directory(base,name,key){
  for(const part of readdirSync(path.join(base,name))) {
    if(['node_modules','.signing','.toolchain','.git','dist','build','test-results','assets'].includes(part)) continue;
    const relative=path.join(name,part), next=key+'/'+part;
    if(statSync(path.join(base,relative)).isDirectory())directory(base,relative,next);else file(base,relative,next);
  }
}
for(const name of ['web','android','scripts','tests','third_party'])directory(root,name,'paper-assistant-mobile/'+name);
for(const name of ['package.json','package-lock.json','README.md','.gitignore','LICENSE'])file(root,name,'paper-assistant-mobile/'+name);
const shared=path.resolve(root,'../paper-assistant-next');
for(const name of ['src','tests','scripts','addon'])directory(shared,name,'paper-assistant-next/'+name);
for(const name of ['package.json','package-lock.json','README.md','LICENSE','update.json'])file(shared,name,'paper-assistant-next/'+name);
writeFileSync(path.join(root,`dist/paper-assistant-${version}-source.zip`),zipSync(entries,{level:9}));
console.log('Source archive written; toolchain, keys, PDFs and caches excluded.');
