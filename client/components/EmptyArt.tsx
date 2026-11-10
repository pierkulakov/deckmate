// 2026-11-10: the gray pixel scene of a large empty state; the drawings live in empty-art-scenes.ts.
import { emptyArtHeight, emptyArtLayers, emptyArtWidth, type EmptyArtScene } from './empty-art-scenes.ts';
import './empty-art.css';

export type { EmptyArtScene } from './empty-art-scenes.ts';

const ink = (strength: number) => `color-mix(in srgb, var(--ink) ${strength}%, transparent)`;

export function EmptyArt({ scene, className = '' }: { scene: EmptyArtScene; className?: string }) {
  return <span className={'empty-art ' + className} aria-hidden="true">
    <svg viewBox={`0 0 ${emptyArtWidth} ${emptyArtHeight}`} shapeRendering="crispEdges" focusable="false">
      {emptyArtLayers(scene).map(([strength, d]) => <path key={strength} d={d} style={{ fill: ink(strength) }} />)}
    </svg>
  </span>;
}
