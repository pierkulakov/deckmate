# Changelog

Notable changes are grouped by version using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-11-08

### Added

- **Deckmate Desktop.** An Electron shell for Windows in `desktop/`: launches from an icon, opens a start screen with Open folder, Create project and recent projects, and reopens the last project on launch. It runs the same local server on a free port inside the app, remembers zoom (Ctrl+wheel, Ctrl+=/−/0) and window size, and has an EN/RU menu. It builds as a portable folder and an unsigned NSIS installer.
- **Clean shutdown.** The server stops cleanly on a `shutdown` message from the desktop shell.

### Changed

- **README.** Leads with the desktop flow (Quick start: Desktop, then CLI) and has a Start screen section with a screenshot.
- **Social preview.** Mentions the desktop app.

## [0.1.0] - 2026-11-07

First public release.

### Added

- **Board over Markdown.** Project files are the source of truth; a rebuildable SQLite index, file watching and block edits that preserve untouched bytes, BOM and line endings. Stale writes are rejected by hash instead of overwriting.
- **Decks and cards.** Spaces, typed decks with covers, Task/Hero/Doc cards, Sub Card families, owners, effort, priority, dependencies, tags, deck summaries, ordering and zones, bulk actions, CSV import and export.
- **Project pulse.** The Decks home screen shows work in progress, the review queue, accepted tasks over 14 days, current Run progress and cards without a deck, with direct links to the relevant views.
- **Manual deck piles.** Keep active decks on the shelf and move others into a pile within their space. Search by deck name also finds piled decks.
- **Planning.** Per-member Hands with seven focus slots, an ordered reserve and a weekly done pile; Runs and Milestones on a Timeline with carry-over, burndown and velocity; Quick Settings for owner, Run, Milestone, effort and priority.
- **Journeys.** Reusable step templates with instructions for people or agents, dependencies, lessons and metrics; 42 built-in templates, from bug fixes and playtests to genre-specific production.
- **Starter templates.** Starters for games (Action, Adventure, Platformer, Puzzle, Roguelike, RPG, Simulation, Sports, Strategy and Survival) and software (pet projects, web apps and libraries) on the Games and Software shelves of **Start from template**, with decks, Journeys and optional example Heroes.
- **Vision.** Excalidraw boards with live card and progress nodes, images, attachments and Markdown document previews.
- **Search and flow.** Global search with filters, keyboard shortcuts for every common action, activity history, watching and due-date notifications.
- **Agents.** `deckmate project` gives compact JSON for the next card, a card brief, questions and reports without a running server; the `/deckmate` skill in the open Agent Skills format installs with `deckmate skills install`; `deckmate agents run` prepares assignments for configured launchers.
- **Two languages.** The interface is English with Russian in the app menu; the file format reads English and Russian words and writes the project's own.
- **Install and run.** `npx deckmate` with `init` for a demo studio, `--data`, `--port`, `--read-only` and `--no-open`; a Docker image; CI on Ubuntu and Windows; release automation for GitHub Releases, GHCR and npm.
- **Docker runtime.** The image uses Node 26 on Debian Bookworm Slim and includes a `HEALTHCHECK`.
- **Genre guides.** The `/deckmate` skill adds guides for action, adventure, puzzle, roguelike, simulation, sports, strategy and survival.
- **Support guide.** [SUPPORT.md](SUPPORT.md) routes questions, bug reports and vulnerability disclosures.

### Changed

- **Deck covers.** Compact 132×180 covers with saved image cropping, task progress, soft hover lighting and a distinct current-deck contour; mouse and keyboard reordering share the shelf.
- **Documentation.** English and Russian READMEs describe the current Decks screen and use refreshed screenshots captured from a real demo project. Security and API documentation describe the default loopback binding and Docker's host-loopback port mapping accurately. Local project data and release-working notes are excluded from Git staging and Docker build context; asset origins and CLA storage setup are documented.
- **Security hardening.** The server accepts IPv6 loopback `[::1]` in the `Host` header, and unexpected 500 responses use generic error text instead of raw internal messages.
- **CodeQL.** Static analysis now covers Python alongside JavaScript and TypeScript.
- **Social preview.** Text stays readable at chat-thumbnail size and shows one complete row of real demo cards; screenshot capture records the client build hash and checks the preview upload-size limit.
- **Demo studio.** The sample Run belongs to a recurring schedule, and initial task transitions are recorded in the activity journal so the project pulse shows its current Run, acceptances and review age.

### Fixed

- Opening a Run from Hand or the project pulse selects that Run on the Timeline.
- Saving a Journey template uses the shared guarded writer and rejects symlink/junction ancestors, including a directory replaced before publication.
- Empty-deck guidance aligns with the first action-rail button, including narrow layouts.
- Source Sans 3's license notice includes the Adobe copyright embedded in the shipped fonts.
- The initial HTML language matches the default English interface.
- Browser capture sends the native Enter activation event, so keyboard navigation can be verified reliably.
- CI normalizes Windows temporary-directory aliases, waits for the WebSocket client's close event during shutdown tests, and grants CodeQL access to workflow-run metadata.
- The app refuses to be framed by other sites (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), so a hostile page cannot steer clicks in the local interface.
- The catalog scan no longer follows a linked `docs`, `features` or `tasks` folder out of the project, warns about the skipped folder and reads every Markdown file through the guarded reader.
- Agent launchers are argument lists (`run: [executable, ...args]`) started without a shell, so a folder name cannot run shell commands. On Windows, npm `.cmd` shims start through `cmd.exe` with quoted arguments, and values containing `%`, `!`, `"` or line breaks are refused for them; a bare executable is looked up in `PATH` only; a shell string needs an explicit `shell: true` and receives the paths in `DECKMATE_PROMPT` and `DECKMATE_CWD`.
- Manifest writes patch only the changed values and keep comments and hand-written YAML; a stale Journey step removal or card import fails before writing anything.
- A WebSocket upgrade with an unparsable URL no longer crashes the server, and filesystem errors no longer put absolute paths into API replies.
- `deckmate agents run` refuses to overwrite an edited assignment in the same `--out` folder, and `rebuild-board.py` keeps the BOM and CRLF line endings of the files it rewrites.
- Card history keeps loaded pages and the scroll position across refreshes, and pasting several images keeps every link.
- The Russian interface no longer shows leftover English labels in card screens, the Sub Card composer or screen-reader labels.
- Status colors and Journey buttons reach 4.5:1 contrast in both themes, and the deck table fits phone widths without horizontal scrolling.
- Third-party notices: `dist/client/third-party-licenses.md` now carries full license texts for bundled packages that ship no license file and for code embedded in prebuilt packages (Chevrotain, Langium, the vscode-languageserver libraries and lodash-es inside `@mermaid-js/parser`, js-yaml inside `mermaid`); the build fails on an empty section or on undeclared embedded code.
- Source-checkout instructions also open the demo, and the `/deckmate` analyze and audit workflows move new cards to `discussing` after creating them.

[Unreleased]: https://github.com/pierkulakov/deckmate/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pierkulakov/deckmate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pierkulakov/deckmate/releases/tag/v0.1.0
