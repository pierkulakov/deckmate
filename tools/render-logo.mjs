// Deckmate mark: writes every SVG and PNG of the pixel deck from one geometry and one palette.
// Run: node tools/render-logo.mjs. No dependencies; PNGs use an integer grid without filtering,
// so every pixel is exactly one of the palette colors or transparent.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (file, data) => { writeFileSync(path.join(root, file), data); console.log('wrote', file); };

// C1 preserves detail at 16–32 px; C4 scales from 64 px. Back card, front card, diamond pip.
const geometry = {
  c1: { grid: 16, back: 'M3 4H4V13H11V14H10V15H3V14H2V5H3Z', front: 'M6 1H13V2H14V11H13V12H6V11H5V2H6Z',
    pip: 'M9 4H10V5H11V6H12V7H11V8H10V9H9V8H8V7H7V6H8V5H9Z' },
  c4: { grid: 32, back: 'M6 7H7V27H23V28H21V30H6V28H4V9H6Z', front: 'M11 2H26V4H28V23H26V25H11V23H9V4H11Z',
    pip: 'M18 10H19V11H20V12H21V13H22V14H21V15H20V16H19V17H18V16H17V15H16V14H15V13H16V12H17V11H18Z' },
};
// Contrast of the front card: dark ≥4.2:1 on #1e2333/#2a3042/#0d1117, light ≥5.9:1 on #e9e0f2/#ffffff.
export const palette = {
  dark: { back: '#7A52D6', front: '#B08AF3', pip: '#F5C24C' },
  light: { back: '#A184E0', front: '#6538A3', pip: '#E8AD2E' },
};
const tile = '#2A3042';
const layers = ['back', 'front', 'pip'];

function svg(shape, colors, { size = shape.grid * (shape.grid === 16 ? 1 : 2), label = 'Deckmate', background } = {}) {
  const scale = size / shape.grid;
  const body = layers.map(layer => `    <path fill="${colors[layer]}" d="${shape[layer]}"/>`).join('\n');
  const bg = background ? `  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${background}"/>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label}">\n${bg}  <g transform="scale(${scale})">\n${body}\n  </g>\n</svg>\n`;
}

// Browser tabs follow the OS theme, so the favicon switches palettes itself.
function favicon() {
  const { c1 } = geometry;
  const rules = layers.map(layer => `.${layer} { fill: ${palette.dark[layer]}; }`).join(' ');
  const light = layers.map(layer => `.${layer} { fill: ${palette.light[layer]}; }`).join(' ');
  const body = layers.map(layer => `  <path class="${layer}" d="${c1[layer]}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges" role="img" aria-label="Deckmate">\n  <style>${rules} @media (prefers-color-scheme: light) { ${light} }</style>\n${body}\n</svg>\n`;
}

function polygon(d) {
  const points = []; let x = 0; let y = 0;
  for (const [, op, value] of d.matchAll(/([MHVZ])\s*(-?\d*\.?\d*)/g)) {
    if (op === 'M') { const [mx, my] = d.slice(d.indexOf('M') + 1).split(/[HVZ]/)[0].split(/[ ,]/).map(Number); x = mx; y = my; points.push([x, y]); }
    else if (op === 'H') { x = Number(value); points.push([x, y]); }
    else if (op === 'V') { y = Number(value); points.push([x, y]); }
  }
  return points;
}

function inside(points, px, py) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const rgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));

function png(shape, colors, size, background) {
  const scale = size / shape.grid;
  const shapes = layers.map(layer => ({ points: polygon(shape[layer]), color: rgb(colors[layer]) }));
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / scale) + .5; const cy = Math.floor(y / scale) + .5;
      let color = background ? [...rgb(background), 255] : [0, 0, 0, 0];
      for (const item of shapes) if (inside(item.points, cx, cy)) color = [...item.color, 255];
      raw.set(color, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const { c1, c4 } = geometry;
out('assets/logo/deckmate.svg', svg(c4, palette.dark, { size: 64, label: 'Deckmate' }));
out('assets/logo/deckmate-light.svg', svg(c4, palette.light, { size: 64, label: 'Deckmate' }));
out('assets/logo/deckmate-16.svg', svg(c1, palette.dark, { size: 16, label: 'Deckmate' }));
out('assets/logo/deckmate-16-light.svg', svg(c1, palette.light, { size: 16, label: 'Deckmate' }));
out('assets/logo/deckmate-tile.svg', svg(c4, palette.dark, { size: 64, label: 'Deckmate', background: tile }));
out('client/public/favicon.svg', favicon());
for (const size of [16, 32]) out(`assets/logo/deckmate-${size}.png`, png(c1, palette.dark, size));
for (const size of [64, 256, 512]) out(`assets/logo/deckmate-${size}.png`, png(c4, palette.dark, size));
out('assets/logo/deckmate-256-light.png', png(c4, palette.light, 256));
out('client/public/apple-touch-icon.png', png(c4, palette.dark, 256, tile));
