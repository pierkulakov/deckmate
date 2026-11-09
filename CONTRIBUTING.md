# Contributing to Deckmate

Thank you for considering a contribution. Deckmate is an early-stage local tool, and the project data model is deliberately strict — the fastest way to get a PR merged is to keep it small, tested and byte-exact where files are written.

## Local development

Requirements: Node.js ≥ 26, npm, Git. CI runs on Ubuntu and Windows; Python 3 is optional: only projects with a `Tools/board.py` board script need it, for the parser cross-check and the server's board check and rebuild.

On Windows, run tests from a cwd with an uppercase drive letter (for example, `C:\src\deckmate`): Vitest fixes its root before setup and registers mocks under the cwd spelling.

```sh
git clone https://github.com/pierkulakov/deckmate.git
cd deckmate
npm ci
cp .env.example .env.local
```

Point `DECKMATE_DATA` at a **test copy** of a project folder, or create one with `node bin/deckmate.mjs init ../deckmate-demo` after `npm run build`. Edits go directly into that folder; git is optional, but commits provide a recoverable history. Use `--read-only` or `DECKMATE_READ_ONLY=1` to disable writes.

For an optional separate writable copy of an existing git project:

```sh
git -C ../your-project worktree add ../your-project-sandbox -b deckmate/sandbox
```

Set `DECKMATE_DATA` to `../your-project` and `DECKMATE_WRITE` to `../your-project-sandbox` in `.env.local`. The writable copy must be outside the original project and remain on the `deckmate/sandbox` branch. In this mode the original stays read-only, and the source switch selects the original or test copy. `DECKMATE_READ_ONLY=1` overrides the separate-copy setting.

Useful commands:

```sh
npm run typecheck    # tsc --noEmit
npm test             # vitest suites
npm run check        # optional parser cross-check; needs a project with Tools/board.py and Python
npm run build        # production build
npm start            # local server from dist/ (after npm run build) → http://127.0.0.1:4317/
npm run dev          # HMR at http://127.0.0.1:4318/, server on 4317; accepts deckmate arguments
npm run dev -- --data ../deckmate-demo
npm run quiet -- <command>   # short output; the full log goes to .deckmate/quiet/
```

The Windows desktop shell in `desktop/` is a Tauri app with its own requirements and loop; see [desktop/README.md](desktop/README.md).

Agent commands from source mirror the published `deckmate` subcommands and call the same functions (`tools/project.ts`, `tools/deckmate-skills.ts`, `tools/deckmate-run.ts`, compiled into `dist/tools/` for the package):

```sh
npm run project -- <command> [--data <project>] [--read-only]    # = npx deckmate project <command>
npm run skills -- install --project <project>                     # = npx deckmate skills install
npm run agents -- run <workflow> <area> --project <project> --dry # = npx deckmate agents run … --dry
```

`npm run` starts in the repository folder, so pass `--data` / `--project` (`project` also reads `DECKMATE_DATA` from `.env.local`; `skills` and `agents` take only `--project`); otherwise the commands read the repository itself. `deckmate --help` lists all subcommands and project commands.

### Checks explained

- `npm test` includes regressions for byte preservation, hash conflicts, sandbox restrictions and idempotent card creation. Changes to the parser or the write path must come with tests.
- `npm run check` is for the legacy section format (`features/**/*.md` with `### X.Y` slices): it compares the TypeScript parser with a project's own `Tools/board.py` on every file, verifies byte boundaries and write-back, and never modifies the project. It needs that project and Python, so it is not part of CI or the pull request checklist.

## Contributor License Agreement

Before your first pull request is merged, sign the [Contributor License Agreement](CLA.md) once by commenting on the pull request:

> I have read the CLA Document and I hereby sign the CLA

A bot checks the signature and records it; later pull requests need nothing more. You keep the copyright in your work.

Why a CLA: it lets the maintainer offer a paid hosted version of Deckmate and commercial licenses alongside the open one. In return, every accepted contribution stays available to everyone under the AGPL permanently; a commercial license is only ever offered in addition to it.

## Pull requests

1. Open or find an issue first (see the issue templates). Small, single-topic PRs merge fastest.
2. Branch from `main` and keep the diff focused; do not mix refactors with features.
3. Before submitting, run `npm run typecheck`, `npm test` and `npm run build` — all green. The PR template lists them as a checklist.
4. For UI changes, attach screenshots (light and dark theme where relevant).
5. If your change writes project data files, explain in the PR which bytes change and which are preserved.
6. Every release section is written in both `CHANGELOG.md` and `CHANGELOG.ru.md` with the same version heading.

## Project rules for code and data

These rules are strict because Deckmate edits other people's repositories:

- **Files are the truth.** SQLite indexes are derived and rebuildable. Never treat the database as primary data, and never hand-edit it.
- **Write only what changed.** Data files are patched block-by-block: unchanged prefixes/suffixes must stay byte-identical, including BOM, line endings and YAML comments. A write path that re-serializes whole files is a defect.
- **Guard every write.** Hashes (`manifestHash`/`sourceHash`) are checked before publication; stale hashes must fail loudly, never silently overwrite.
- **Readable code.** Full names, short functions, comments that explain *why*. A second way to do the same thing is a defect; dead code and temporary workarounds are removed in the same change.
- **Docs use absolute dates** (2026-11-04), never "today" or "for now".
- **No cloud, no accounts, no embedded AI features, no auto-commits** — these are outside the product by design.

## Reporting bugs and requesting features

Use the issue templates ([bug report](.github/ISSUE_TEMPLATE/bug_report.yml), [feature request](.github/ISSUE_TEMPLATE/feature_request.yml)). For security matters follow [SECURITY.md](SECURITY.md). By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
