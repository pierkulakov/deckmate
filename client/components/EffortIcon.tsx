import type { SVGProps } from 'react';

// 2026-11-11: effort reads as weight — a kettlebell. The solid body carries as much mass as the bold number beside it,
// where an outline mark was lost on the metal band; the flat base and the square handle keep it from reading as a
// padlock or a ball at 16 px. The handle's legs, the body's sides and the base sit on whole units of the 24 grid.
export function EffortIcon({ size = 16, className = '', ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} className={`effort-icon${className ? ' ' + className : ''}`}>
    <path d="M8 12V7.5A2.5 2.5 0 0 1 10.5 5h3A2.5 2.5 0 0 1 16 7.5V12" />
    <path d="M7.1 21A7 7 0 1 1 16.9 21Z" fill="currentColor" stroke="none" />
  </svg>;
}
