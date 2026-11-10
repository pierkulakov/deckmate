# Changelog

Notable changes are grouped by version using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Russian version: [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [Unreleased]

## [0.6.0] - 2026-11-10

### Added

- **Deckmate Desktop.** The Windows app now uses Tauri 2; its installer is about 32 MB instead of 121 MB. The installer automatically removes the old Electron installation while keeping `%APPDATA%\Deckmate`, including settings, recent projects and language.
- **Updates.** Installed Desktop downloads updates in the background and verifies their update signature; you can install later or skip a version. The portable build only notifies you and offers the download page.
- **What's new.** A window shows the changes after an update; you can also open it from Help.
- **Workspace.** Pin, remove and reorder projects on the start screen or in the board's side panel; Ctrl+1–9 opens the first nine. The side panel shows shortcut labels and project initials; Ctrl+Shift+P opens the start screen.
- **Deck covers.** Six new covers: Characters, Levels, Story, Agents, Releases and Ideas.
- **Unsaved work.** Desktop warns before closing, switching projects or installing an update if you have unsaved changes. Windows shows why Deckmate is blocking shutdown so you can cancel it and save.
- **Third-party licenses.** Desktop includes licenses for Node.js, Rust dependencies and WebView2 in `THIRD-PARTY-NOTICES.txt` next to the app.
- **Spaces.** Delete a space with no decks from its header.

### Changed

- **Start screen.** Navigate project lists with the keyboard; workspace projects no longer repeat under Recent. The start screen, menus and dialogs use clearer wording, including that Create project makes a sample project.
- **Refreshed look.** Controls, chips, tabs and panels have sharper, flatter shapes instead of pill shapes; the server status badge remains a capsule.
- **Card proportions.** On larger screens, the open-card column is wider and fills the available height, with larger reading text; covers on the open-deck shelf are larger.
- **Card state row.** Four buttons (`▷ [!] [?] ✓`) use their fill to show work, blockers, review and acceptance without a separate state label; `[!]` opens dependencies. `[?]` submits for review or, in Review, offers Accept review and Request changes; requesting changes requires a reason and returns the card to Not started.
- **Card sections.** Properties, Sub Cards, Dependencies, Attachments and History open in a column beside the card's icon rail, over the deck.
- **Card filters.** In All cards and open decks, one row shows the count, removable filters and Clear all. The In progress and In review figures in the project pulse open filtered All cards; Back and Forward restore the view.
- **Smoother board.** Opening and closing decks and cards, moving between cards and hovering tiles do much less work per frame, and these transitions no longer shift the layout. The deck gallery has refreshed hover and focus feedback and a cleaner opening transition; Hand reordering is steadier, and opening or closing a deck no longer shows an unwanted tooltip or focus ring.
- **Installer.** The installer and the Windows app list show the publisher, homepage and license. Deleting app data when you uninstall now also removes `%APPDATA%\Deckmate`. The bundled server is smaller.
- **Agent skill.** The `/deckmate` skill's commands, states and references match the CLI, and the HTTP actions it relies on ship inside the skill, so agents no longer need files from the Deckmate repository. Its project profile also supports software, and the documentation walks through an agent's work from picking a card to review.
- **Release checks.** Releases are prepared as drafts, the update signature is checked before publication, and the update manifest is uploaded last. `npm run desktop:updater-e2e` checks updates end to end, and screenshot capture has timeouts. CI runs browser tests in three parallel shards on Ubuntu and Windows, and a release tag publishes only a commit with green CI instead of running the tests again.
- **Dependency blocking.** Only an existing, active, unfinished prerequisite blocks a card; archived, deleted and missing prerequisites do not. The board, agent briefs and activity history use the same rule.
- **CLI options.** Commands now reject options that do not apply to them and suggest the available options. `--help` works across commands and subcommands; each `project` command has an example.
- **Skill installation.** `deckmate skills install` now refuses to replace locally changed or added files without `--force`; move your changes out first if you want to keep them.
- **README links.** Documentation links and images work from the npm package page.

### Fixed

- **Long paths.** Projects in Windows folders with paths longer than 260 characters can be opened and created.
- **Page recovery.** A page that keeps crashing no longer reloads endlessly: choose Reload or Start screen. A page that stops responding offers Reload or Wait.
- **Board preferences.** Saved card drafts and board preferences remain available after a restart or project switch when the saved local port is free.
- **Desktop settings.** A setting that could not be saved no longer looks applied, and a damaged `desktop.json` is kept as a dated copy before the defaults are used.
- **Drive roots.** A project at the root of a drive is named after the drive instead of showing an empty name.
- **Agent briefs.** Answers recorded under an English `## Decided` heading now appear in `deckmate project brief`.
- **Attachments.** A failed check after publishing the attachment registry no longer deletes the uploaded file. The attachments panel refreshes when another tab or agent changes attachments.
- **Partial saves.** A conflict after an earlier save step now warns that some changes were saved instead of reporting a simple failure; internal conflict codes are hidden.
- **Card state retries.** Repeating a state change completes unfinished Owner, Hand and acceptance-date steps; repeating start does not move a card already in Hand.
- **Review feedback.** Return reasons are recorded even for cards without a deck, and `deckmate project brief` shows agents the latest recorded return feedback.
- **Review shortcuts.** Space and W open review choices rather than accidentally accepting a card in Review.
- **Card refresh.** Ordinary card switches no longer flash a loading label, and short Quick Settings saves no longer flash the card's controls.
- **Manifest writes.** The manifest uses the same guarded writer as cards. Deck, space and Track forms detect changes made since opening and keep the entered values on conflict.
- **Dependencies.** The dependency graph is reread before saving, so a cycle introduced during the request is rejected.
- **CSV import.** Tags are saved in batches, and a repeated import completes missing tags on matching cards.
- **Journey saves.** An operation journal lets a later write targeting the Journey resume an interrupted save. A conflicting external edit names the file; the API can abandon the unfinished operation without rolling back files.
- **Tabs and Vision.** Switching tabs keeps the selected deck, search and Ordering; clicking the active tab no longer closes the deck. Vision refreshes card references and selection properties after edits.
- **Interface text.** Connection errors follow the interface language, Hand keeps its name in Russian, and card tiles no longer show a native title tooltip on hover.
- **Steadier layout.** Rapid filtering no longer duplicates cards; table rows stay together, Quick Settings menus no longer jump or clip, and save-status labels no longer overlap.
- **First load.** The light theme no longer flashes before the saved theme, and the header no longer shifts on first load.
- **Desktop shortcuts.** Menu shortcuts work with focus in the page: Ctrl+Shift+P, Ctrl+O, Ctrl+1–9, Ctrl+R, Ctrl+Q and F11.
- **Desktop reliability.** Update cleanup leaves unrelated folders alone; a stuck project creation times out and can be cancelled by quitting; if the server port is taken, Desktop retries on another port.

### Removed

- Removed: deck piles; all decks are shown on the Decks home screen; existing `piled` keys are ignored.

## [0.5.0] - 2026-11-09

### Added

- **Spaces.** Reorder spaces with Move up and Move down in the space header or the Position field in space settings.
- **Hero done by hand.** A Hero without Task Sub Cards can be marked done and unmarked; with Task Sub Cards it is done once they are all accepted, and the server rejects a manual mark.

### Changed

- **Doc Cards.** A Doc tile reads as a page: copper band with the notebook icon and word count, a chapter mark and the start of the text on its face; the open Doc card uses the same copper.
- **Decks.** Hero Cards come first when a deck is grouped by priority or state.
- **Accepted Hero.** The band keeps the working Hero's gold metal and ribbon; the holographic finish stays on the face and rim.

### Fixed

- The Hero strip on Sub Card tiles starts level with the card title.
- The open editor no longer jumps while a card is dragged between lanes.
- Browser tests wait up to 45 s for headless Chrome on CI instead of about 10 s.

## [0.4.0] - 2026-11-09

### Added

- **Templates in Russian.** Bundled Journey and project templates carry Russian titles and descriptions (`locales.ru` in the template header); the pickers show them in the Russian interface, and importing into a Russian-format project names the Journey in Russian.
- **Accepted Hero foil.** An accepted Hero tile carries a holographic foil and an iridescent rim that follow the pointer; with reduced motion or touch it stays still.
- **Attachments.** Deleting an attachment that is inserted in the card text offers to remove its links as well.
- **Task to Hero.** Dropping a top-level Task without Sub Cards into an Asset deck asks whether to make it a Hero; the server's `promote-parent` accepts an empty Sub Card list for this.

### Changed

- **Decks home.** The document and card counts moved from a footer under the decks to a quiet line under the project name; source warnings open from that line.
- **Hero family.** Doc Sub Cards show in the Hero's family; progress and the finished family count Task Sub Cards only. The Sub Cards panel counts and marks Sub Cards without a deck.
- **Cards.** Tiles tilt up to 8°. A Hero tile's Sub Card progress is a quiet line whose steps are sized by each Sub Card's effort.

### Fixed

- The open Hero card's band again uses the Hero gold for its owner medallion and labels, and an accepted Hero band its accepted metal (regressed in 0.3.0).
- An image in card text whose file is gone shows a "file not found" chip instead of a broken image; pasted images use the same link format as the insert menu.
- Native select lists are readable in the dark theme, and the Sub Card composer's deck picker shows one focus frame.
- `npm run dev` proxies only `/api/` and `/r/` to the server, so the dev board loads again.
- Notification state keeps a member whose id is `constructor` in the file instead of on `Object.prototype`; Journey templates are read only inside the project folder.
- Steadier browser tests on CI (reduced motion on Windows runners, toast animation timing) and test helpers that pass data as arguments instead of building code strings.

## [0.3.0] - 2026-11-09

### Added

- **Desktop projects.** Switch directly to another recent project from the board's project menu.
- **Development.** `npm run dev` runs the watched server and Vite with hot reload.
- **Attachments.** Insert an attachment into card text from the editor, or copy its Markdown link from the attachments panel.

### Changed

- **Inbox and Sub Cards.** A Task or Mixed deck can be designated as Inbox for compatible cards created without a chosen deck; otherwise cards remain Unassigned. Sub Cards can belong to working decks independently of their Hero.
- **Journeys.** Hero cards show compact step mini-cards and a Journey menu; opening a step shows its Sub Card in the Sub Cards tab, with Esc returning to the Hero. The Sub Card displays a step note.
- **Cards and materials.** Open-card properties offer quick settings and clickable tag chips; the card number moves to the footer. Metallic cards gain cursor lighting and tilt.
- **Card attachments.** Card covers were removed; legacy cover entries remain preserved. Deck and planning covers are unaffected.

### Fixed

- Improved narrow layouts, contrast, focus and scrolling, and refined Russian interface wording; added tests for these flows and accessibility.

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

[Unreleased]: https://github.com/pierkulakov/deckmate/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/pierkulakov/deckmate/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/pierkulakov/deckmate/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/pierkulakov/deckmate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pierkulakov/deckmate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pierkulakov/deckmate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pierkulakov/deckmate/releases/tag/v0.1.0
