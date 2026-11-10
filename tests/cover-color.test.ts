import { describe, expect, it } from 'vitest';
import { contrastRatio, rgbOf } from '../client/color-contrast.ts';
import { coverFaceColors, leadingColor, lchOfHex } from '../client/cover-color.ts';

// 2026-11-10: the selected cover's color keeps the page's ink readable in both themes, whatever the deck or its picture.
const ink = { dark: rgbOf('#edeef2'), light: rgbOf('#2f2440') };
const samples = ['#607d98', '#027d84', '#5e1f8b', '#cf4a21', '#204bbd', '#3a3f55', '#b3364c', '#e9d26a', '#c9c2d8', '#ffffff', '#000000', '#00ff00', '#ffff00', '#0000ff', '#878787'];

describe('cover color', () => {
  it.each(samples)('keeps the title at 4.5:1 or more on %s in both themes', color => {
    const faces = coverFaceColors(lchOfHex(color));
    expect(contrastRatio(ink.dark, rgbOf(faces.dark))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink.light, rgbOf(faces.light))).toBeGreaterThanOrEqual(4.5);
  });

  it('moves yellows toward amber instead of olive or khaki', () => {
    const [, , hueDark] = lchOfHex(coverFaceColors(lchOfHex('#e9d26a')).dark);
    const [, , hueLight] = lchOfHex(coverFaceColors(lchOfHex('#e9d26a')).light);
    expect(hueDark).toBeLessThan(80);
    expect(hueLight).toBeLessThan(80);
  });

  it('takes the leading hue of a picture and ignores its grays', () => {
    const pixels: number[] = [];
    for (let index = 0; index < 60; index++) pixels.push(30, 140, 150, 255); // teal, the picture's color
    for (let index = 0; index < 20; index++) pixels.push(230, 120, 170, 255); // a pink accent
    for (let index = 0; index < 200; index++) pixels.push(128, 128, 128, 255); // gray background, no vote
    const [, , hue] = leadingColor(new Uint8ClampedArray(pixels))!;
    const [, , teal] = lchOfHex('#1e8c96');
    expect(Math.abs(hue - teal)).toBeLessThan(15);
    expect(leadingColor(new Uint8ClampedArray([128, 128, 128, 255, 10, 10, 10, 255]))).toBeNull();
  });
});
