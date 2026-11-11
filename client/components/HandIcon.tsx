import type { SVGProps } from 'react';
import '../card-indicators.css';

// 2026-11-11: a fan of three cards turning about one pivot far below the glyph, so the gaps between them stay open down
// to the bottom edge. A card behind is drawn only where it shows and every such stroke ends on the outline of the card
// in front of it: no stroke stops in mid-air and the glyph needs no mask. The middle card stands upright on whole
// units, which are whole device pixels at 16 px on a 1.5× screen; the front card alone carries the fill.
const backCards = [
  'M10.56 17L7.26 17.95A1.5 1.5 0 0 1 5.4 16.92L2.92 8.27A1.5 1.5 0 0 1 3.95 6.41L7.32 5.45A1.5 1.5 0 0 1 9.04 6.16',
  'M13.94 17L10.5 17A1.5 1.5 0 0 1 9 15.5L9 6.5A1.5 1.5 0 0 1 10.5 5L14 5A1.5 1.5 0 0 1 15.46 6.16',
];
const frontCard = 'M17.18 5.45L20.55 6.41A1.5 1.5 0 0 1 21.58 8.27L19.1 16.92A1.5 1.5 0 0 1 17.24 17.95L13.88 16.98A1.5 1.5 0 0 1 12.85 15.13L15.33 6.48A1.5 1.5 0 0 1 17.18 5.45Z';

export function HandIcon({ size = 24, mine = false, className = '', ...props }: SVGProps<SVGSVGElement> & { size?: number | string; mine?: boolean }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} className={`hand-icon${mine ? ' is-mine' : ''}${className ? ' ' + className : ''}`}>
    {backCards.map(path => <path key={path} d={path} />)}
    <path d={frontCard} fill={mine ? 'currentColor' : 'none'} />
  </svg>;
}
