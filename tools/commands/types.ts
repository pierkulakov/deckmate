// Agent commands (2026-11-05): one module per command in tools/commands/<name>.ts, picked up by name from tools/project.ts,
// so packages that add commands never edit a shared list. Existing commands stay in project.ts as they were.
import type { ServerConfig } from '../../server/config.ts';
import type { CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { getCatalogHands, selectCatalogHand } from '../../src/catalog-hand.ts';
import { AgentToolError } from '../../src/agent-tools.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';

export interface CommandContext {
  config: ServerConfig;
  source: DataSource;
  /** Project folder of this source: the writable root for `sandbox`, the project itself for `live`. */
  root: string;
  /** Fresh read of the project files, without the SQLite index. */
  catalog: CatalogView;
}

/** Valueless switches (`--brief`, `--json`) arrive as "true". */
export type CommandOptions = ReadonlyMap<string, string>;

export interface CommandModule {
  run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void>;
}

/** Prints a tool failure as JSON and sets the exit code; any other error propagates unchanged. */
export function printToolFailure(error: unknown): void {
  if (!(error instanceof AgentToolError)) throw error;
  console.log(JSON.stringify(error.toFailure()));
  process.exitCode = 1;
}

/**
 * 2026-11-06: every command that names a member resolves it like Hand does (ID, name or alias), and a missing or
 * unknown member fails with the registry IDs, so an agent can retry without reading the manifest.
 */
export function commandMember(context: CommandContext, requested: string | undefined, command: string): CatalogMember {
  const ids = (context.catalog.members ?? []).map(member => member.id).join(', ');
  const choices = ids ? `Members: ${ids}.` : 'The project has no members yet; add people and agents in Members… first.';
  if (!requested?.trim()) throw new Error(`${command}: pass --member <ID>. ${choices}`);
  try { return selectCatalogHand(getCatalogHands(context.catalog), requested).member; }
  catch (error) { throw new Error(`${command}: ${(error as Error).message} ${choices}`); }
}
