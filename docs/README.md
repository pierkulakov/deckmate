# Deckmate documentation

Documentation index. Source code is in `client/`, `server/`, `src/`, `tools/`, and `tests/`. Product overview: [README.md](../README.md) (English) / [README.ru.md](../README.ru.md) (Russian).

## Core documents

| Document | Contents |
|---|---|
| [catalog.md](catalog.md) | Data model and full contract: entities (Space/Deck/Task/Hero/Doc/Track/Hand/Journey/Vision), source files, manifest, CardOptions, guarded writes, HTTP API, agent CLI, activity journal, and implementation boundaries. |
| [mcp.md](mcp.md) | The `deckmate mcp` server for AI clients: connecting a client, project and member resolution, the eleven board tools, rev guards, retry-safe creation, limits, and the `deckmate project` equivalents. |
| [api.md](api.md) | Local HTTP API for the app and tools that need a live server: run modes, token and actor headers, hash guards, read and write endpoints, errors, examples. |
| [Desktop](../desktop/README.md) | Tauri 2 shell, Windows requirements, workspace, updates, development and release checks. |
| [skills.md](skills.md) | `/deckmate` skills: project installation, fourteen workflows, lenses, genres, engines, project profile, agent configuration, and `npm run agents -- run`. Configuration format: [agents-config.md](agents-config.md). |
| Skill examples: [English](skill-examples.md) / [Русский](skill-examples.ru.md) | Requests and step-by-step examples for every workflow, decisions and board layout. |
| [../PRODUCT.md](../PRODUCT.md) | Product direction: purpose, positioning, users, principles, and design requirements. |
| [../DESIGN.md](../DESIGN.md) | Design system: tokens, card materials, decks, tilt, glare, and reduced motion. |
| [ui-map.md](ui-map.md) | UI screens and entry points, component/CSS ownership, shared-element blast radius, responsive and shell branches, captures, and tests by zone. |
| [../AGENTS.md](../AGENTS.md) | Rules for agents and people working on Deckmate: directories, the agent route on a project, code rules, checks, and commits. |
| [github-settings.md](github-settings.md) | Maintainer setup: private preparation, public opening, npm credentials, publication and recovery. |

After `npm run build`, use `npm run shots` to regenerate the README images; `npm run shots -- --skip-desktop` leaves the start screen untouched, and `npm run shots -- --social` renders only the social preview from the existing card crop.
