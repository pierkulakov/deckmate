import type { CSSProperties, ReactNode } from 'react';
import { tileColor, tileInitials } from './project-tile.ts';
import './project-list.css';

export function ProjectTile({ name, children }: { name: string; children?: ReactNode }) {
  return <span className="mission-control-recent-tile" aria-hidden="true" data-initials={tileInitials(name)} style={{ '--tile': tileColor(name) } as CSSProperties}>{children}</span>;
}
