const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function writePng(filePath, width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  fs.writeFileSync(filePath, Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function gradient(t) {
  const stops = [
    { t: 0, c: [87, 75, 255] },
    { t: 0.55, c: [21, 94, 239] },
    { t: 1, c: [0, 168, 232] }
  ];
  const left = t < stops[1].t ? stops[0] : stops[1];
  const right = t < stops[1].t ? stops[1] : stops[2];
  const local = (t - left.t) / (right.t - left.t);
  return [
    mix(left.c[0], right.c[0], local),
    mix(left.c[1], right.c[1], local),
    mix(left.c[2], right.c[2], local)
  ];
}

function roundedRectAlpha(x, y, rect, radius) {
  const cx = Math.max(rect.x + radius, Math.min(x, rect.x + rect.w - radius));
  const cy = Math.max(rect.y + radius, Math.min(y, rect.y + rect.h - radius));
  const dist = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius + 0.7 - dist));
}

function blendPixel(pixels, width, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 4;
  const srcA = Math.max(0, Math.min(1, alpha * (color[3] ?? 1)));
  const dstA = pixels[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  for (let i = 0; i < 3; i += 1) {
    const src = color[i] / 255;
    const dst = pixels[index + i] / 255;
    pixels[index + i] = Math.round(((src * srcA) + (dst * dstA * (1 - srcA))) / outA * 255);
  }
  pixels[index + 3] = Math.round(outA * 255);
}

function drawRoundedRect(pixels, width, height, rect, radius, colorFn) {
  const minX = Math.max(0, Math.floor(rect.x - 1));
  const maxX = Math.min(width - 1, Math.ceil(rect.x + rect.w + 1));
  const minY = Math.max(0, Math.floor(rect.y - 1));
  const maxY = Math.min(height - 1, Math.ceil(rect.y + rect.h + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const alpha = roundedRectAlpha(x + 0.5, y + 0.5, rect, radius);
      if (alpha <= 0) continue;
      const color = typeof colorFn === 'function' ? colorFn(x, y) : colorFn;
      blendPixel(pixels, width, x, y, color, alpha);
    }
  }
}

function drawCircle(pixels, width, height, cx, cy, r, color) {
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(height - 1, Math.ceil(cy + r + 1)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(width - 1, Math.ceil(cx + r + 1)); x += 1) {
      const alpha = Math.max(0, Math.min(1, r + 0.7 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)));
      if (alpha > 0) blendPixel(pixels, width, x, y, color, alpha);
    }
  }
}

function drawLine(pixels, width, height, x1, y1, x2, y2, thickness, color) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - thickness));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - thickness));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y1, y2) + thickness));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / lenSq));
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const alpha = Math.max(0, Math.min(1, thickness / 2 + 0.7 - Math.hypot(x + 0.5 - px, y + 0.5 - py)));
      if (alpha > 0) blendPixel(pixels, width, x, y, color, alpha);
    }
  }
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 128;
  const scaleRect = (x, y, w, h) => ({ x: x * s, y: y * s, w: w * s, h: h * s });

  drawRoundedRect(pixels, size, size, scaleRect(6, 6, 116, 116), 28 * s, (x, y) => {
    const t = Math.min(1, Math.max(0, (x + y) / (size * 2)));
    return [...gradient(t), 1];
  });

  drawRoundedRect(pixels, size, size, scaleRect(27, 28, 74, 72), 18 * s, [255, 255, 255, 1]);
  drawRoundedRect(pixels, size, size, scaleRect(38, 44, 40, 9), 4.5 * s, [16, 27, 54, 1]);
  drawRoundedRect(pixels, size, size, scaleRect(38, 62, 52, 8), 4 * s, [50, 71, 110, 1]);
  drawRoundedRect(pixels, size, size, scaleRect(38, 78, 32, 8), 4 * s, [114, 134, 172, 1]);
  drawLine(pixels, size, size, 82 * s, 74 * s, 93 * s, 85 * s, 9 * s, [21, 94, 239, 1]);
  drawLine(pixels, size, size, 93 * s, 85 * s, 82 * s, 96 * s, 9 * s, [21, 94, 239, 1]);
  drawCircle(pixels, size, size, 97 * s, 30 * s, 7 * s, [255, 255, 255, 1]);

  return pixels;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  writePng(path.join(OUT_DIR, `icon${size}.png`), size, size, render(size));
}
