# Deckmate — notes for agents and contributors

Deckmate is a local project board over Markdown. The files in the user's project are the source of truth; the SQLite index under the cache folder is disposable and can be rebuilt. People and AI agents read and edit the same files.

## Layout

| Path | What lives there |
|---|---|
| `client/` | React 19 app built with Vite: decks, cards, Hand, Timeline, Vision. |
| `server/` | Fastify server: catalog, file writes, file watcher, activity log, CLI entry. |
| `src/` | Contracts and helpers shared by client, server and tools, including `src/i18n.ts`. |
| `tools/` | Project CLI (`npm run project`), skills installer, agent runner, capture and README screenshot scripts. |
| `bin/deckmate.mjs` | Published command: `deckmate`, `deckmate init <folder>`, and `deckmate project`, `skills`, `agents` — the same functions as the npm scripts of those names. |
| `skills/deckmate/` | Agent skill in the open Agent Skills format: router, workflows, lenses, genres, engines. |
| `assets/` | Fonts, logo, deck art, starter project templates and Journey templates. |
| `desktop/` | Electron shell: start screen, window and menu, the bundled server as a child process; its own package.json, see [desktop/README.md](desktop/README.md). |
| `tests/` | Vitest suites. |
| `docs/` | Data contract ([catalog.md](docs/catalog.md)), local API ([api.md](docs/api.md)), skills and agent configuration. |

[DESIGN.md](DESIGN.md) describes tokens, card materials and layout; [PRODUCT.md](PRODUCT.md) describes who the product is for and its principles.

## Working on a project as an agent

1. `npm run project -- next <member>` (add `--data <project>` unless `.env.local` sets `DECKMATE_DATA`) picks the first allowed card; `brief <c-ref>` returns a compact package with the rules to read next.
2. Read the referenced ranges with `show <c-ref> --lines a-b` before editing; for Journey steps use `step <p-ref> <step-id>`.
3. Ask a blocking question with `ask`; hand in results with `report <c-ref> --file <report.md> --member <you> --state <review state>`. A reviewer returns or accepts with `state <c-ref> <state> --member <you> [--reason <text>]`. Never mark your own work accepted.
4. Assigning an owner never starts a model. The full route is [skills/deckmate/workflows/work.md](skills/deckmate/workflows/work.md).

## Rules for code

- **Byte preservation.** A write replaces only the changed block of a file; everything else stays byte for byte, including BOM and line endings.
- **No silent overwrites.** Writes carry the source hash they were based on; a stale write is rejected with a conflict.
- **One way to do a thing.** Reuse existing helpers; a second implementation of the same behavior is a defect. Remove dead code and temporary workarounds in the same change.
- **User-facing text** goes through `defineText(en, ru)` in the module that uses it; both languages keep the same keys. Data identifiers, file names and card text are never translated.
- **Legacy names** (`FREETION_*` variables, `freetion` keys, `tasks/freetion*.md`) are read for compatibility; new data is written with `deckmate` names.
- **Dependencies.** No new package without a maintainer's approval; OSI-approved licenses only. Never commit secrets or `.env.local`.
- **Comments** explain why, not what, and use absolute dates (2026-11-05), never "today" or "for now".
- Readable names, short functions, no nested ternaries.

## Checks

On Windows, run tests from a cwd with an uppercase drive letter (for example, `D:\GitHub\deckmate`): Vitest fixes its root before setup and registers mocks under the cwd spelling.

Run checks through `npm run quiet -- <command>`: on success it prints a short summary and the path to the full log; on failure it prints the errors.

```sh
npm run quiet -- npm run typecheck
npm run quiet -- npx vitest run <test files that cover your change>
npm run quiet -- npm run build
```

Run the full `npm test` before opening a pull request. The running app serves `dist/`: client changes need `npm run build` and a page reload; server changes need `npm run build` and a restart.

## Commits and pull requests

Small commits, one topic each, with a message that says what changed and why. Pull requests follow [CONTRIBUTING.md](CONTRIBUTING.md).
