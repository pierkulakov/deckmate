# Changelog

Notable changes are grouped by version using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-11-06

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

### Changed

- **Deck covers.** Compact 132×180 covers with saved image cropping, task progress, soft hover lighting and a distinct current-deck contour; mouse and keyboard reordering share the shelf.
- **Documentation.** English and Russian READMEs describe the current Decks screen and use refreshed screenshots captured from a real demo project.
- **Demo studio.** The sample Run belongs to a recurring schedule, and initial task transitions are recorded in the activity journal so the project pulse shows its current Run, acceptances and review age.

### Fixed

- Opening a Run from Hand or the project pulse selects that Run on the Timeline.
- Browser capture sends the native Enter activation event, so keyboard navigation can be verified reliably.
- CI normalizes Windows temporary-directory aliases, waits for the WebSocket client's close event during shutdown tests, and grants CodeQL access to workflow-run metadata.
