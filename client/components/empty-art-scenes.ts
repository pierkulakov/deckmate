// 2026-11-10: the pixel scenes of empty states, drawn like the Deckmate mark (two cards, a diamond pip;
// tools/render-logo.mjs) with a one-pixel contour and light from the upper left. Every tone is a strength of the page
// ink, so a scene sits in the page like an unobtrusive watermark in either theme. The grid is 32×24 and
// scales by whole numbers. EmptyArt.tsx renders it.

const emptyArtScenes = ['sorted', 'first-card', 'no-results', 'track', 'hand', 'team', 'milestone', 'journey'] as const;
export type EmptyArtScene = typeof emptyArtScenes[number];

export const emptyArtWidth = 32;
export const emptyArtHeight = 24;
const width = emptyArtWidth;
const height = emptyArtHeight;
/** Strengths of the page ink, in percent: one gray scale for every scene. */
const tone = { line: 20, back: 7, front: 11, pip: 18, badge: 12, mark: 28, metal: 14, handle: 16, spark: 16, slot: 18, shadow: 6, lens: 3, glint: 24 };

type Cells = Set<number>;
const at = (x: number, y: number) => y * width + x;
const inGrid = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;

function cellsOf(test: (x: number, y: number) => boolean): Cells {
  const cells: Cells = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (test(x, y)) cells.add(at(x, y));
  return cells;
}
/** A card of the mark: a rectangle with its corners cut by one cell. */
function cardCells(x: number, y: number, w: number, h: number) {
  return cellsOf((cx, cy) => cx >= x && cx < x + w && cy >= y && cy < y + h
    && !((cx === x || cx === x + w - 1) && (cy === y || cy === y + h - 1)));
}
function diamondCells(cx: number, cy: number, radius: number) {
  return cellsOf((x, y) => Math.abs(x - cx) + Math.abs(y - cy) <= radius);
}
function discCells(cx: number, cy: number, radius: number, hole = -1) {
  return cellsOf((x, y) => {
    const distance = Math.hypot(x + .5 - cx, y + .5 - cy);
    return distance <= radius && distance > hole;
  });
}
/** The cells of a drawing marked with one character. */
function drawnCells(x: number, y: number, rows: string[], mark: string) {
  const cells: Cells = new Set();
  rows.forEach((row, dy) => [...row].forEach((char, dx) => { if (char === mark) cells.add(at(x + dx, y + dy)); }));
  return cells;
}

/** A grid where a later stroke covers an earlier one, as layers of paint do. */
class PixelGrid {
  readonly cells: (number | undefined)[] = new Array(width * height);
  paint(cells: Cells, strength: number) { for (const cell of cells) this.cells[cell] = strength; }
  set(x: number, y: number, strength: number) { if (inGrid(x, y)) this.cells[at(x, y)] = strength; }
  /** A solid object: a contour around it, its tone, its top edge lit and its foot and right edge in shade. */
  object(cells: Cells, strength: number, { contour = true, shade = true } = {}) {
    const has = (x: number, y: number) => inGrid(x, y) && cells.has(at(x, y));
    if (contour) for (const cell of cells) {
      const x = cell % width; const y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inGrid(x + dx, y + dy) && !has(x + dx, y + dy)) this.set(x + dx, y + dy, tone.line);
    }
    for (const cell of cells) {
      const x = cell % width; const y = Math.floor(cell / width);
      let value = strength;
      if (shade && (!has(x, y + 1) || !has(x + 1, y))) value = Math.max(2, strength - 3);
      else if (shade && !has(x, y - 1)) value = strength + 5;
      this.cells[cell] = value;
    }
  }
  /** An empty place for a card: a dashed outline with cut corners. */
  slot(x: number, y: number, w: number, h: number) {
    this.paint(cellsOf((cx, cy) => {
      const side = (cx === x || cx === x + w - 1) && cy > y && cy < y + h - 1;
      const edge = (cy === y || cy === y + h - 1) && cx > x && cx < x + w - 1;
      return (side || edge) && (cx + cy) % 3 !== 0;
    }), tone.slot);
  }
  /** A four-pointed glint, the sparkle of the deck art. */
  sparkle(x: number, y: number) {
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) this.set(x + dx, y + dy, tone.spark);
  }
  /** The soft shadow an object lays on the surface under it. */
  shadow(x: number, y: number, w: number) {
    this.paint(cellsOf((cx, cy) => (cy === y && cx >= x + 1 && cx < x + w - 1) || (cy === y + 1 && cx >= x + 3 && cx < x + w - 3)), tone.shadow);
  }
  /** One path per tone: horizontal runs of equal cells joined into rectangles. */
  layers(): [number, string][] {
    const paths = new Map<number, string>();
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        const strength = this.cells[at(x, y)];
        let end = x + 1;
        while (end < width && this.cells[at(end, y)] === strength) end += 1;
        if (strength !== undefined) paths.set(strength, (paths.get(strength) ?? '') + `M${x} ${y}h${end - x}v1h${x - end}z`);
        x = end;
      }
    }
    return [...paths];
  }
}

const checkBadge = [
  '...xxxxx...',
  '.xxxxxxxxx.',
  '.xxxxxxxxx.',
  'xxxxxxxxIIx',
  'xxxxxxxIIxx',
  'xxIIxxIIxxx',
  'xxxIIIIxxxx',
  'xxxxIIxxxxx',
  '.xxxxxxxxx.',
  '.xxxxxxxxx.',
  '...xxxxx...',
];
const plus = [
  '...xxx...',
  '...xxx...',
  '...xxx...',
  'xxxxxxxxx',
  'xxxxxxxxx',
  'xxxxxxxxx',
  '...xxx...',
  '...xxx...',
  '...xxx...',
];
const handle = [
  'xx....',
  'xxx...',
  '.xxx..',
  '..xxx.',
  '...xxx',
  '....xx',
];
const downArrow = [
  '..xx..',
  '..xx..',
  '..xx..',
  '..xx..',
  'xxxxxx',
  '.xxxx.',
  '..xx..',
];
const person = [
  '...xxxx...',
  '..xxxxxx..',
  '..xxxxxx..',
  '..xxxxxx..',
  '...xxxx...',
  '..........',
  '..xxxxxx..',
  '.xxxxxxxx.',
  'xxxxxxxxxx',
  'xxxxxxxxxx',
  'xxxxxxxxxx',
];
const flag = [
  'xxxxxx',
  'xxxxx.',
  'xxxxxx',
];

const scenes: Record<EmptyArtScene, (grid: PixelGrid) => void> = {
  // Every card already sits in a deck: the mark's two cards and a check.
  sorted(grid) {
    grid.shadow(5, 21, 22);
    grid.object(cardCells(6, 7, 12, 14), tone.back);
    grid.object(cardCells(12, 3, 13, 16), tone.front);
    grid.object(diamondCells(18, 10, 3), tone.pip, { contour: false });
    grid.object(new Set([...drawnCells(20, 12, checkBadge, 'x'), ...drawnCells(20, 12, checkBadge, 'I')]), tone.badge);
    grid.paint(drawnCells(20, 12, checkBadge, 'I'), tone.mark);
    grid.sparkle(4, 4);
    grid.sparkle(28, 5);
  },
  // Nothing yet: an outlined place for a card and a plus where the first one will go.
  'first-card'(grid) {
    grid.shadow(8, 21, 16);
    grid.slot(10, 3, 13, 18);
    grid.object(drawnCells(12, 7, plus, 'x'), tone.pip);
    grid.sparkle(6, 6);
    grid.sparkle(26, 16);
  },
  // Search found nothing: the deck behind a magnifier whose lens shows only empty glass.
  'no-results'(grid) {
    grid.shadow(3, 21, 26);
    grid.object(cardCells(4, 8, 11, 13), tone.back);
    grid.object(cardCells(9, 4, 11, 15), tone.front);
    grid.object(diamondCells(14, 11, 2), tone.pip, { contour: false });
    grid.paint(discCells(19.5, 11.5, 5), tone.lens);
    grid.object(discCells(19.5, 11.5, 6.5, 5), tone.metal);
    for (const [x, y] of [[17, 8], [16, 9], [16, 10]]) grid.set(x, y, tone.glint);
    grid.object(drawnCells(24, 16, handle, 'x'), tone.handle);
    grid.sparkle(28, 4);
  },
  // A track: cards of three decks strung on one dotted line.
  track(grid) {
    grid.shadow(1, 21, 30);
    grid.object(cardCells(2, 8, 8, 11), tone.back);
    grid.object(cardCells(12, 4, 8, 11), tone.front);
    grid.object(cardCells(22, 9, 8, 11), tone.back);
    for (let x = 1; x <= 30; x += 2) grid.set(x, 13, tone.mark);
    grid.sparkle(6, 4);
    grid.sparkle(26, 4);
  },
  // An empty Hand: three places for cards and an arrow where the next one lands.
  hand(grid) {
    grid.shadow(2, 21, 28);
    grid.slot(3, 9, 8, 11);
    grid.slot(12, 9, 8, 11);
    grid.slot(21, 9, 8, 11);
    grid.object(drawnCells(13, 0, downArrow, 'x'), tone.pip);
    grid.sparkle(5, 4);
    grid.sparkle(27, 5);
  },
  // No team yet: two people of the roster, one behind the other.
  team(grid) {
    grid.shadow(5, 21, 22);
    grid.object(drawnCells(15, 6, person, 'x'), tone.back);
    grid.object(drawnCells(7, 9, person, 'x'), tone.front);
    grid.sparkle(26, 5);
    grid.sparkle(5, 4);
  },
  // An empty plan: the axis of days and one Milestone diamond on its stem.
  milestone(grid) {
    for (let x = 2; x <= 29; x += 1) grid.set(x, 18, tone.slot);
    for (let x = 3; x <= 28; x += 5) grid.set(x, 19, tone.slot);
    grid.paint(cellsOf((x, y) => x === 16 && y >= 12 && y <= 17), tone.line);
    grid.object(diamondCells(16, 8, 4), tone.pip);
    grid.sparkle(7, 6);
    grid.sparkle(25, 4);
  },
  // No Journey yet: three steps climbing a dotted path to a flag.
  journey(grid) {
    grid.shadow(1, 21, 30);
    for (const [x, y] of [[9, 16], [11, 15], [19, 11], [21, 10]]) grid.set(x, y, tone.mark);
    grid.object(cardCells(2, 14, 6, 7), tone.back);
    grid.object(cardCells(12, 10, 6, 7), tone.front);
    grid.object(cardCells(23, 6, 6, 7), tone.back);
    grid.paint(cellsOf((x, y) => x === 25 && y >= 1 && y <= 5), tone.line);
    grid.object(drawnCells(26, 1, flag, 'x'), tone.pip);
    grid.sparkle(6, 5);
  },
};

/** The scene's layers: one path per ink strength, in percent. */
export function emptyArtLayers(scene: EmptyArtScene) {
  const grid = new PixelGrid();
  scenes[scene](grid);
  return grid.layers();
}
