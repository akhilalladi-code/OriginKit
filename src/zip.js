const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZip(entries) {
  if (entries.length > 5000) throw new Error('A backup cannot contain more than 5,000 entries.');
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const viewBuffer = (length, writer) => {
    const buffer = new ArrayBuffer(length);
    writer(new DataView(buffer));
    return new Uint8Array(buffer);
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    if (!name.length || name.length > 65535 || data.byteLength > 0xffffffff) throw new Error('A backup entry exceeds the supported ZIP format limits.');
    const checksum = crc32(data);
    const localHeader = viewBuffer(30, (view) => {
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0x21, true);
      view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
    });
    localParts.push(localHeader, name, data);
    const centralHeader = viewBuffer(46, (view) => {
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint16(14, 0x21, true);
      view.setUint32(16, checksum, true); view.setUint32(20, data.length, true); view.setUint32(24, data.length, true);
      view.setUint16(28, name.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true);
      view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true); view.setUint32(42, offset, true);
    });
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = viewBuffer(22, (view) => {
    view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true);
    view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, offset, true); view.setUint16(20, 0, true);
  });
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

export function readStoredZip(buffer, { maxTotalBytes = 500 * 1024 * 1024, maxEntries = 5000 } = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65557);
  let endOffset = -1;
  for (let i = bytes.length - 22; i >= minimum; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { endOffset = i; break; }
  }
  if (endOffset < 0) throw new Error('This file is not a supported OriginKit ZIP backup.');
  const count = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (count > maxEntries || centralOffset + centralSize > bytes.length) throw new Error('The backup directory is invalid or too large.');
  const files = new Map();
  let cursor = centralOffset;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The backup directory is damaged.');
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('The backup contains an unsafe file path.');
    if (files.has(name)) throw new Error(`The backup contains a duplicate path: ${name}.`);
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error('Only uncompressed OriginKit backups are supported.');
    total += uncompressedSize;
    if (total > maxTotalBytes) throw new Error('The backup exceeds the 500 MB restore limit.');
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('A backup file entry is damaged.');
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (localMethod !== method || localName !== name) throw new Error(`Backup header mismatch for ${name}.`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + uncompressedSize);
    if (data.length !== uncompressedSize || crc32(data) !== checksum) throw new Error(`Backup integrity check failed for ${name}.`);
    files.set(name, data);
  }
  return files;
}
