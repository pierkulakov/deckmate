import { Bot, Feather, Gem, Moon, Network, Sparkles, UserRound } from 'lucide-react';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import type { ChecklistProgress } from '../catalog-lookups.ts';
import { currentLang, defineText, formatNumber, useLang, type Lang } from '../i18n.ts';
import '../card-quick-settings.css';

// 2026-11-10: checklist progress stays in the owner's name and tooltip;
// the medallion has no progress ring.
const text = defineText({
  owner: (name: string) => `Owner: ${name}`,
  unassigned: 'Unassigned',
  checklist: (done: string, total: string) => `checklist ${done} of ${total}`,
}, {
  owner: (name: string) => `Исполнитель: ${name}`,
  unassigned: 'Без исполнителя',
  checklist: (done: string, total: string) => `чек-лист ${done} из ${total}`,
});

export function ownerProgressLabel(owner: string | null, progress?: ChecklistProgress, lang: Lang = currentLang()): string {
  const t = text[lang];
  const label = t.owner(owner ?? t.unassigned);
  if (!progress || progress.total <= 0) return label;
  return label + ' · ' + t.checklist(formatNumber(progress.done, 0, lang), formatNumber(progress.total, 0, lang));
}

const agentSymbols = { kimi: Moon, fable: Feather, opus: Gem, glm: Network, astra: Sparkles };
type AgentSymbol = keyof typeof agentSymbols;

function agentSymbolFor(names: (string | null | undefined)[]): AgentSymbol | undefined {
  return names.map(name => name?.trim().toLowerCase()).find((name): name is AgentSymbol => Boolean(name && Object.hasOwn(agentSymbols, name)));
}

export function memberForOwner(owner: string | null, members: CatalogMember[]) {
  const key = owner?.trim().toLocaleLowerCase('ru');
  return key ? members.find(member => [member.label, member.id, ...member.aliases].some(alias => alias.trim().toLocaleLowerCase('ru') === key)) : undefined;
}

export function OwnerAvatar({ owner, kind, agentSymbol, progress }: { owner: string | null; kind?: 'agent' | 'human'; agentSymbol?: AgentSymbol; progress?: ChecklistProgress }) {
  const lang = useLang();
  const label = progress ? ownerProgressLabel(owner, progress, lang) : undefined;
  const initials = owner?.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('ru');
  const symbol = kind === 'human' ? undefined : agentSymbol ?? agentSymbolFor([owner]);
  const isAgent = kind === 'agent' || Boolean(symbol);
  let Icon = null;
  if (symbol) Icon = agentSymbols[symbol];
  else if (isAgent) Icon = Bot;
  else if (kind === 'human' || !initials) Icon = UserRound;
  return <span className={'card-owner-avatar' + (isAgent ? ' is-agent' : '')} data-agent={symbol} aria-hidden={progress ? undefined : true} role={progress ? 'img' : undefined} title={label} aria-label={label}>
    {Icon ? <Icon size={16} strokeWidth={1.9} className="card-owner-symbol" /> : initials}
  </span>;
}

export function CardOwnerAvatar({ owner, members, progress }: { owner: string | null; members: CatalogMember[]; progress?: ChecklistProgress }) {
  const member = memberForOwner(owner, members);
  const agentSymbol = agentSymbolFor([member?.id, member?.label, ...(member?.aliases ?? []), owner]);
  return <OwnerAvatar owner={member?.label ?? owner} kind={member?.kind} agentSymbol={agentSymbol} progress={progress} />;
}
