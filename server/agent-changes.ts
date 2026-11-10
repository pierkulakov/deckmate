import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { ActivityStateTransition, DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { readWholeActivity } from './activity.ts';
import { readProjectMarkdown } from './native-cards.ts';

const executeFile = promisify(execFile);
const hashPattern = /^[0-9a-f]{64}$/iu;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u;

export interface AgentCommit {
  hash: string;
  at: string;
  subject: string;
}

export interface AgentGitHistory {
  available: boolean;
  status: 'ok' | 'not-repository' | 'unavailable' | 'error';
  commits: AgentCommit[];
  warning?: string;
}

export interface AgentHistory {
  sourceHash: string;
  events: DeckActivityEvent[];
  totalEvents: number;
  git: AgentGitHistory;
  warnings: string[];
  latestReturn?: { event: DeckActivityEvent; transition: ActivityStateTransition & { reason: string } };
}

export interface AgentChanges {
  cardId: string;
  since: string;
  sourceHash: string;
  previousSourceHash: string | null;
  changed: boolean | null;
  eventScope: 'after-timestamp' | 'all-card-events';
  events: DeckActivityEvent[];
  git: AgentGitHistory;
  warnings: string[];
}

function parseTimestamp(value: string): number {
  const match = timestampPattern.exec(value);
  if (!match) throw new RangeError('--since must be an ISO timestamp with a time zone or a full sourceHash (64 hex digits).');
  const [, year, month, day, hour, minute, second, zone] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  const validDay = date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
  const validTime = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const validZone = zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
  const timestamp = Date.parse(value);
  if (!validDay || !validTime || !validZone || !Number.isFinite(timestamp)) {
    throw new RangeError('--since is not a valid ISO timestamp.');
  }
  return timestamp;
}

async function readGitHistory(root: string, relativePath: string): Promise<AgentGitHistory> {
  try {
    const result = await executeFile('git', ['--no-optional-locks', '-C', root, '--no-pager', 'log', '-3',
      '--format=%H%x00%cI%x00%s', '--', relativePath], { windowsHide: true, timeout: 2000, maxBuffer: 128 * 1024 });
    const commits = result.stdout.trimEnd().split(/\r?\n/u).filter(Boolean).map(line => {
      const [hash, at, ...subject] = line.split('\0');
      return { hash, at, subject: subject.join('\0') };
    });
    return { available: true, status: 'ok', commits };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') {
      return { available: false, status: 'unavailable', commits: [], warning: 'Git is unavailable; only the Deckmate activity journal is shown.' };
    }
    if (/not a git repository/iu.test(failure.stderr ?? '')) {
      return { available: false, status: 'not-repository', commits: [], warning: 'The data folder is not a Git repository; the file history is unavailable.' };
    }
    const detail = (failure.stderr?.trim() || failure.message).slice(0, 500);
    return { available: false, status: 'error', commits: [], warning: `Cannot read git log: ${detail}` };
  }
}

async function readHistory(root: string, card: CatalogCard): Promise<AgentHistory> {
  // 2026-11-05: the file hash must describe fresh guarded bytes, not a potentially stale catalog snapshot.
  const bytes = await readProjectMarkdown(root, card.path);
  const [journal, git] = await Promise.all([readWholeActivity(root), readGitHistory(root, card.path)]);
  const events = journal.events.filter(event => event.cards.some(reference => reference.id === card.id))
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at) || second.id.localeCompare(first.id));
  const warnings: string[] = [];
  if (journal.unreadable) warnings.push(`Unreadable journal records: ${journal.unreadable}; the history may be incomplete.`);
  if (git.warning) warnings.push(git.warning);
  return { sourceHash: createHash('sha256').update(bytes).digest('hex'), events, totalEvents: events.length, git, warnings };
}

/** 2026-11-10: retain the latest recorded return before limiting the event summary; later edits must not hide feedback. */
export async function readAgentHistory(root: string, card: CatalogCard): Promise<AgentHistory> {
  const history = await readHistory(root, card);
  let latestReturn: AgentHistory['latestReturn'];
  for (const event of history.events) {
    const transition = event.transitions?.find(candidate => candidate.cardId === card.id
      && candidate.from === 'review' && candidate.to !== 'review' && candidate.to !== 'done' && candidate.reason?.trim());
    if (transition?.reason) {
      latestReturn = { event, transition: { ...transition, reason: transition.reason } };
      break;
    }
  }
  return { ...history, events: history.events.slice(0, 3), ...(latestReturn ? { latestReturn } : {}) };
}

/** 2026-11-05: a file digest has no time information and does not cover separately stored card options. */
export async function readAgentChanges(root: string, card: CatalogCard, since: string): Promise<AgentChanges> {
  const previousSourceHash = hashPattern.test(since) ? since.toLowerCase() : null;
  const timestamp = previousSourceHash === null ? parseTimestamp(since) : null;
  const history = await readHistory(root, card);
  const warnings = [...history.warnings];
  if (previousSourceHash !== null) {
    warnings.push('A sourceHash carries no time: all card events are returned, not only the events after that hash. '
      + 'changed compares only the card file; properties kept in separate registries are not covered.');
  }
  return {
    cardId: card.id, since, sourceHash: history.sourceHash, previousSourceHash,
    changed: previousSourceHash === null ? null : previousSourceHash !== history.sourceHash,
    eventScope: timestamp === null ? 'all-card-events' : 'after-timestamp',
    events: timestamp === null ? history.events : history.events.filter(event => Date.parse(event.at) > timestamp),
    git: history.git, warnings,
  };
}
