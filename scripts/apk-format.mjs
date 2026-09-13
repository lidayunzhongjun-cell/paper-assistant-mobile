import { zipSync } from 'fflate';

export function apkZip(entries) {
  if (!entries['resources.arsc']) throw new Error('APK resource table is missing');
  // Android 11+ rejects DEFLATE resource tables even when zipalign and signing pass.
  // Store this entry verbatim; the subsequent zipalign step aligns its data offset.
  return zipSync({ ...entries, 'resources.arsc': [entries['resources.arsc'], { level: 0 }] }, { level: 6 });
}

export function inspectResourceTable(bytes) {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('APK ZIP directory is missing or truncated');
  const count = b.readUInt16LE(eocd + 10), size = b.readUInt32LE(eocd + 12);
  let cursor = b.readUInt32LE(eocd + 16);
  if (cursor + size !== eocd) throw new Error('APK ZIP directory bounds are invalid');
  let resource = null;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || b.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid APK ZIP directory entry');
    const nameLength = b.readUInt16LE(cursor + 28), extraLength = b.readUInt16LE(cursor + 30), commentLength = b.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw new Error('Truncated APK ZIP entry');
    const name = b.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name === 'resources.arsc') {
      if (resource) throw new Error('Duplicate APK resource table');
      const method = b.readUInt16LE(cursor + 10), offset = b.readUInt32LE(cursor + 42);
      if (offset + 30 > b.length || b.readUInt32LE(offset) !== 0x04034b50) throw new Error('Resource local header missing');
      if (b.readUInt16LE(offset + 8) !== method) throw new Error('Resource compression metadata mismatch');
      const dataOffset = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
      if (dataOffset + b.readUInt32LE(cursor + 20) > b.length) throw new Error('Resource data truncated');
      resource = { name, compressionMethod: method, dataOffset, aligned4: dataOffset % 4 === 0, size: b.readUInt32LE(cursor + 24) };
    }
    cursor = next;
  }
  if (!resource) throw new Error('APK resource table missing');
  return resource;
}
export function verifyResourceTable(bytes) {
  const result = inspectResourceTable(bytes);
  if (result.compressionMethod !== 0) throw new Error('Android -124: resources.arsc must be stored uncompressed');
  if (!result.aligned4) throw new Error('Android -124: resources.arsc must be aligned to 4 bytes');
  return result;
}
