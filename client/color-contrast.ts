// WCAG 2 contrast for #rrggbb colors (2026-11-06). Deck cover bands and calendar Milestone tiles show user-chosen colors that
// no fixed token pair can serve, so both pick their text ink with these helpers.
export type Rgb = readonly number[];

export function rgbOf(hex: string): Rgb {
  return hex.slice(1).match(/../g)!.map(channel => Number.parseInt(channel, 16));
}

function luminance(color: Rgb): number {
  return color.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
