// Use the compact mark at 16–32 px and the detailed mark from 64 px: a violet card with a gold pip.
// Theme tokens --mark-back/front/pip match tools/render-logo.mjs, which draws the files in assets/logo.
export function DeckmateMark({ size = 32 }: { size?: 16 | 32 | 40 }) {
  return <svg className="deckmate-mark" width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <path className="deckmate-mark-back" d="M3 4H4V13H11V14H10V15H3V14H2V5H3Z" />
    <path className="deckmate-mark-front" d="M6 1H13V2H14V11H13V12H6V11H5V2H6Z" />
    <path className="deckmate-mark-pip" d="M9 4H10V5H11V6H12V7H11V8H10V9H9V8H8V7H7V6H8V5H9Z" />
  </svg>;
}
