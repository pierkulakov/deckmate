import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { contrastRatio, rgbOf, type Rgb } from './color-contrast.ts';

// 2026-11-10: a deck cover takes its color from its own illustration so the card and picture read as one object.
// At rest the cover is clear glass; selected, the glass fills with this color. The title keeps the page's ink in
// every state, so the color is fitted to that ink in each theme — deep under the dark theme's light ink, pastel under the
// light theme's dark ink — and the glass, the color and every mix between them stay readable.

/** OKLCH: lightness 0–1, chroma, hue in degrees. */
type Lch = readonly [number, number, number];

/** The --ink token of each theme (client/styles.css); the title is set in it on every cover. */
const themeInk = { dark: rgbOf('#edeef2'), light: rgbOf('#2f2440') } as const;
/** WCAG AA for the 13.5u title, with a hair of margin for rounding in the color-mix of the reveal. */
const minimumContrast = 4.6;

const toLinear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
const toGamma = (channel: number) => channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055;

function rgbToLab([red, green, blue]: Rgb): Lch {
  const [r, g, b] = [red, green, blue].map(channel => toLinear(channel / 255));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}

function labToLinearRgb([lightness, a, b]: Lch): number[] {
  const l = (lightness + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (lightness - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}

function labToLch([lightness, a, b]: Lch): Lch {
  return [lightness, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

/** sRGB for an OKLCH color, giving up chroma until it fits the gamut, so the hue and lightness survive. */
function lchToRgb([lightness, chroma, hue]: Lch): Rgb {
  const radians = hue * Math.PI / 180;
  for (let c = chroma; c >= 0; c -= .004) {
    const linear = labToLinearRgb([lightness, c * Math.cos(radians), c * Math.sin(radians)]);
    if (linear.every(channel => channel >= -.0005 && channel <= 1.0005)) return linear.map(channel => Math.round(toGamma(Math.min(1, Math.max(0, channel))) * 255));
  }
  return labToLinearRgb([lightness, 0, 0]).map(channel => Math.round(toGamma(Math.min(1, Math.max(0, channel))) * 255));
}

const hexOf = (color: Rgb) => '#' + color.map(channel => channel.toString(16).padStart(2, '0')).join('');

export function lchOfHex(hex: string): Lch {
  return labToLch(rgbToLab(rgbOf(hex)));
}

/**
 * The illustration's leading color: colorful pixels grouped into 24 hue families (with their neighbors, so a hue split
 * across a border counts once), weighted by chroma and by how near they sit to mid lightness. Near-black, near-white and
 * gray pixels do not vote. Null when the picture has no colorful pixels.
 */
export function leadingColor(pixels: Uint8ClampedArray): Lch | null {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, lightness: 0, a: 0, b: 0 }));
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 200) continue;
    const lab = rgbToLab([pixels[index], pixels[index + 1], pixels[index + 2]]);
    const [lightness, chroma, hue] = labToLch(lab);
    if (lightness < .2 || lightness > .94 || chroma < .035) continue;
    const bin = bins[Math.floor(hue / 15) % 24];
    const weight = chroma * (1 - Math.abs(lightness - .6));
    bin.weight += weight; bin.lightness += lightness * weight; bin.a += lab[1] * weight; bin.b += lab[2] * weight;
  }
  let best: { weight: number; lightness: number; a: number; b: number } | null = null;
  bins.forEach((_, index) => {
    const near = [bins[(index + 23) % 24], bins[index], bins[(index + 1) % 24]];
    const family = near.reduce((sum, bin) => ({ weight: sum.weight + bin.weight, lightness: sum.lightness + bin.lightness, a: sum.a + bin.a, b: sum.b + bin.b }), { weight: 0, lightness: 0, a: 0, b: 0 });
    if (family.weight > 0 && (!best || family.weight > best.weight)) best = family;
  });
  if (!best) return null;
  const family = best as { weight: number; lightness: number; a: number; b: number };
  return labToLch([family.lightness / family.weight, family.a / family.weight, family.b / family.weight]);
}

/**
 * The selected cover's color in each theme, fitted to that theme's ink: under light ink a deep, rich version (lightness
 * .36–.52), under dark ink a pastel one (from .84 up), each moved away from the ink until the title reads at 4.6:1.
 * Yellows go olive when deepened and khaki when paled, so they are moved toward amber, which stays warm both ways.
 */
export function coverFaceColors([lightness, chroma, hue]: Lch): { dark: string; light: string } {
  const warm = hue > 80 && hue < 118 ? 74 : hue;
  const fit = (start: Lch, ink: Rgb, step: number) => {
    let [l, c, h] = start;
    let rgb = lchToRgb([l, c, h]);
    while (contrastRatio(ink, rgb) < minimumContrast && l > .03 && l < .99) { l += step; rgb = lchToRgb([l, c, h]); }
    return hexOf(rgb);
  };
  return {
    dark: fit([Math.min(.52, Math.max(.36, lightness)), Math.min(.14, Math.max(.05, chroma)), warm], themeInk.dark, -.01),
    light: fit([Math.max(.84, lightness), Math.min(.075, Math.max(.035, chroma * .6)), warm], themeInk.light, .01),
  };
}

/** Reads the picture once per URL; a picture that cannot be read (no canvas, an error, a tainted canvas) gives null. */
const artColors = new Map<string, Promise<Lch | null>>();
/** Colors already read, so a cover that mounts again (the gallery reopened, the shelf) paints its color in its first frame. */
const readColors = new Map<string, Lch | null>();
function readArtColor(url: string): Promise<Lch | null> {
  let color = artColors.get(url);
  if (!color) {
    color = new Promise<Lch | null>(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          // 60×42 keeps the 10:7 of the deck art and is plenty for a color; pixel art survives the downscale.
          const canvas = document.createElement('canvas');
          canvas.width = 60; canvas.height = 42;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(leadingColor(context.getImageData(0, 0, canvas.width, canvas.height).data));
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    artColors.set(url, color.then(read => { readColors.set(url, read); return read; }));
  }
  return artColors.get(url)!;
}

const unread: CSSProperties = {};

/**
 * The cover's color for both themes as custom properties: from the illustration when there is one and it has color,
 * otherwise from the deck's own color setting. CSS picks the theme's value (deck-cover.css). While a picture is still
 * being read there is no color at all, and the face shows its glass: the deck's setting first and the picture's color
 * a moment later would flash one color into another (2026-11-10, now that the face always carries its color).
 */
export function useCoverColors(image: string | null, deckColor: string): CSSProperties {
  const [, settle] = useState(0);
  const known = image ? readColors.get(image) : null;
  useEffect(() => {
    if (!image || readColors.has(image)) return;
    let current = true;
    void readArtColor(image).then(() => { if (current) settle(count => count + 1); });
    return () => { current = false; };
  }, [image]);
  return useMemo(() => {
    if (known === undefined) return unread;
    const faces = coverFaceColors(known ?? lchOfHex(deckColor));
    return { '--cover-c-dark': faces.dark, '--cover-c-light': faces.light } as CSSProperties;
  }, [known, deckColor]);
}
