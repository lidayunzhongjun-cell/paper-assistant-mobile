import { readFileSync } from 'node:fs';
import { verifyResourceTable } from './apk-format.mjs';
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node scripts/check-apk.mjs package.apk');
console.log('PASS Android resource-table installation gate:', JSON.stringify(verifyResourceTable(readFileSync(filename))));
