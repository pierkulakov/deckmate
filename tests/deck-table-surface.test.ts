import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-10: the Table shares the card grid's rhythm rather than using glass lanes and an inset gutter:
// one left edge with the result line, the lane chips and the first card column, the cards view's
// lane heading, quiet card-face rows on a 35 px pitch with the state strip inside the lane's corners, checkboxes inside.
// These source assertions guard that contract; tests/card-scope.test.ts measures the edges in a browser.
const css = readFileSync(new URL('../client/deck-table.css', import.meta.url), 'utf8');

describe('deck table surface (2026-11-10)', () => {
  it('starts at the results edge: no outer gutter, both checkboxes inside', () => {
    const scroll = /\.deck-table-scroll \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(scroll).toContain('padding: 0 0 var(--space-3);');
    // 2026-11-10: the row checkbox has its own place, 4 px clear of the strip, and the Priority cell steps aside for it.
    expect(css).toMatch(/\.deck-table-row > \.deck-table-select \{[^}]*left: 4px;/);
    expect(css).toMatch(/\.deck-table-row > \.deck-table-priority \{ padding-left: 18px; \}/);
    expect(css).toMatch(/\.deck-table \.catalog-card-group-heading \.catalog-group-select \{[^}]*left: -5px;/);
    expect(css).toContain('transform: translateX(24px);');
  });

  it('draws each lane as one quiet 4 px block of card-face rows, not a glass panel', () => {
    const lane = /\.deck-table > tbody::before \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(lane).toContain('border-radius: 4px;');
    expect(lane).toContain('background: var(--card-edge);');
    expect(lane).not.toContain('--glass');
    expect(css).toContain('.deck-table > tbody + tbody { margin-top: var(--space-6); }');
  });

  it('uses the cards view lane heading: a 24 px line of muted 12 px text with its dashed rule', () => {
    const heading = /\.deck-table \.catalog-card-group-heading \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(heading).toContain('height: 24px;');
    expect(heading).toContain('font-size: 12px;');
    expect(heading).toContain('color: var(--muted);');
    expect(css).not.toContain('.catalog-group-rule { display: none; }');
    expect(css).not.toContain('font-size: 17px');
  });

  it('keeps rows on a 35 px pitch with the state strip inside the lane corners', () => {
    const row = /\.deck-table-row \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(row).toContain('height: 34px;');
    expect(row).toContain('margin-bottom: 1px;');
    expect(row).toContain('border-left: 4px solid var(--row-strip);');
    expect(row).toContain('background: var(--card-face);');
    expect(css).toContain('border-top-left-radius: 4px; border-top-right-radius: 4px;');
    expect(css).toContain('border-bottom-left-radius: 4px; border-bottom-right-radius: 4px;');
  });

  it('sets counters in Geist Mono and project tags on a flat face', () => {
    expect(css).toMatch(/\.deck-table-effort \{[^}]*font-family: 'Geist Mono', monospace;[^}]*font-variant-numeric: tabular-nums;/);
    expect(css).toMatch(/\.deck-table-checklist \{[^}]*font-family: 'Geist Mono', monospace;/);
    expect(css).toMatch(/\.catalog-group-effort \{[^}]*font-family: 'Geist Mono', monospace;/);
    // 2026-11-10: the Table keeps the shared tag plaque corner (a 6px radius made capsules, the Foil Rule).
    expect(css).not.toContain('--tag-radius');
    expect(css).toMatch(/\.tag-badge\.is-project \{ background: var\(--hover\);[^}]*\}/);
  });
});
