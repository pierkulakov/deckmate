import type { CSSProperties } from 'react';
import { DeckmateMark } from './components/DeckmateMark.tsx';
import { defineText, useText } from './i18n.ts';
import { tileColor, tileInitials } from './project-tile.ts';
import './loading-composition.css';

const text = defineText({ opening: 'Opening project…' }, { opening: 'Открываю проект…' });

export function OpeningScreen({ projectName = '' }: { projectName?: string }) {
  const t = useText(text);
  return <div className="opening-screen" role="status" aria-live="polite" aria-atomic="true" aria-label="Deckmate">
    <div className="opening-composition">
      <header className="opening-brand"><DeckmateMark size={40} /><h1>Deckmate</h1></header>
      <div className="opening-project">
        <span className="opening-tile" aria-hidden="true" data-initials={tileInitials(projectName)} style={{ '--tile': tileColor(projectName) } as CSSProperties} />
        <div className="opening-copy"><p className="opening-label">{t.opening}</p><p className="opening-name" dir="auto" title={projectName}>{projectName}</p></div>
        <span className="opening-activity" aria-hidden="true" />
      </div>
      {/* 2026-11-13: the splash's recovery action and the board reserve the same space below the composition. */}
      <span className="opening-recovery" aria-hidden="true" />
    </div>
  </div>;
}
