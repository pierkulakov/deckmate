import { Bot, Feather, Gem, Moon, Network, Sparkles, UserRound } from 'lucide-react';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import '../card-quick-settings.css';

const agentSymbols = { kimi: Moon, fable: Feather, opus: Gem, glm: Network, astra: Sparkles };
type AgentSymbol = keyof typeof agentSymbols;

function agentSymbolFor(names: (string | null | undefined)[]): AgentSymbol | undefined {
  return names.map(name => name?.trim().toLowerCase()).find((name): name is AgentSymbol => Boolean(name && Object.hasOwn(agentSymbols, name)));
}

export function memberForOwner(owner: string | null, members: CatalogMember[]) {
  const key = owner?.trim().toLocaleLowerCase('ru');
  return key ? members.find(member => [member.label, member.id, ...member.aliases].some(alias => alias.trim().toLocaleLowerCase('ru') === key)) : undefined;
}

export function OwnerAvatar({ owner, kind, agentSymbol }: { owner: string | null; kind?: 'agent' | 'human'; agentSymbol?: AgentSymbol }) {
  const initials = owner?.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('ru');
  const symbol = kind === 'human' ? undefined : agentSymbol ?? agentSymbolFor([owner]);
  const isAgent = kind === 'agent' || Boolean(symbol);
  let Icon = null;
  if (symbol) Icon = agentSymbols[symbol];
  else if (isAgent) Icon = Bot;
  else if (kind === 'human' || !initials) Icon = UserRound;
  return <span className={'card-owner-avatar' + (isAgent ? ' is-agent' : '')} data-agent={symbol} aria-hidden="true">
    {Icon ? <Icon size={16} strokeWidth={1.9} className="card-owner-symbol" /> : initials}
  </span>;
}

export function CardOwnerAvatar({ owner, members }: { owner: string | null; members: CatalogMember[] }) {
  const member = memberForOwner(owner, members);
  const agentSymbol = agentSymbolFor([member?.id, member?.label, ...(member?.aliases ?? []), owner]);
  return <OwnerAvatar owner={member?.label ?? owner} kind={member?.kind} agentSymbol={agentSymbol} />;
}

