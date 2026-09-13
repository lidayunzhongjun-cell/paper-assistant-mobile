import { unzipSync } from 'fflate';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { apkZip } from './apk-format.mjs';
const root = path.resolve(import.meta.dirname, '..');
const apk = path.join(root, 'build/unsigned.apk');
const entries = unzipSync(readFileSync(apk));
for (const name of readdirSync(path.join(root,'build/dex'))) if (name.endsWith('.dex')) entries[name] = readFileSync(path.join(root,'build/dex',name));
function walk(dir, prefix) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir,name), key = prefix + '/' + name;
    if (statSync(full).isDirectory()) walk(full,key); else entries[key] = readFileSync(full);
  }
}
walk(path.join(root,'android/assets'), 'assets');
writeFileSync(apk, apkZip(entries));
console.log('APK assets and DEX added.');
