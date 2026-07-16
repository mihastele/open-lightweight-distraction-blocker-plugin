const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const canvas = [];
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.35;
  const cornerRadius = size * 0.1875;

  for (let y = 0; y < size; y++) {
    canvas.push([]);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      const inRoundedRect = (() => {
        const margin = size * 0.05;
        const rx = margin + cornerRadius;
        const ry = margin + cornerRadius;
        const rw = size - 2 * margin;
        const rh = size - 2 * margin;

        if (x < margin || x >= size - margin || y < margin || y >= size - margin) {
          const corners = [
            [rx, ry],
            [rx + rw - 2 * cornerRadius, ry],
            [rx, ry + rh - 2 * cornerRadius],
            [rx + rw - 2 * cornerRadius, ry + rh - 2 * cornerRadius]
          ];
          for (const [ccx, ccy] of corners) {
            const dx = x - (ccx + cornerRadius);
            const dy = y - (ccy + cornerRadius);
            if (Math.abs(dx) <= cornerRadius && Math.abs(dy) <= cornerRadius) {
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist <= cornerRadius) return true;
            }
          }
          return false;
        }
        return true;
      })();

      if (inRoundedRect) {
        const t = (x + y) / (2 * size);
        r = Math.round(99 + t * (139 - 99));
        g = Math.round(102 + t * (92 - 102));
        b = Math.round(241 + t * (246 - 241));
        a = 255;

        const distFromCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const shieldOuter = radius * 1.2;
        const shieldInner = radius * 0.85;

        if (distFromCenter <= shieldOuter && distFromCenter >= shieldInner) {
          r = 255; g = 255; b = 255; a = 240;
        }

        if (distFromCenter <= radius * 0.25) {
          r = 255; g = 255; b = 255; a = 240;
        }

        const eyeY = cy - radius * 0.1;
        const eyeDist = Math.sqrt((x - cx) ** 2 + (y - eyeY) ** 2);
        if (eyeDist <= radius * 0.55 && eyeDist >= radius * 0.4) {
          r = 255; g = 255; b = 255; a = 240;
        }
      }

      canvas[y].push([r, g, b, a]);
    }
  }

  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) {
      raw.push(...canvas[y][x]);
    }
  }

  const rawBuf = Buffer.from(raw);
  const deflated = zlib.deflateSync(rawBuf);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function createChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcData = Buffer.concat([typeB, data]);
    const crc = crc32(crcData);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', deflated),
    createChunk('IEND', iend)
  ]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, 'icons');

sizes.forEach(size => {
  const png = createPNG(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`Generated icon-${size}.png`);
});

console.log('Done!');
