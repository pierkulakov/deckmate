# Genre guides
- Add `<key>.md` with YAML frontmatter containing `genre: <key>` and `title: <title>` between `---` markers.
- Keep four sections in order: `## First playable` with 3–5 lines for the hypothesis, cheapest test and measures, first Heroes, and starter template; `## References` with 4–6 games; `## Player communities` with 2–4 communities; and `## Genre pitfalls` with 3–5 lines.
- Give each reference a specific behavior to observe and a link to the developer, GDC, or an analysis. Do not reproduce the game's feature list.
- Give each community a link and a research question; support every reference, community, and pitfall with a source.
- Exclude facts specific to one project: the genre supplies a starting point for research, and the project profile refines or replaces its conclusions.
- Store custom genres in `<project>/tasks/deckmate-genres/<key>.md`; they override built-in genres with the same key.
- The `genre` field in `tasks/deckmate-project.md` selects the file; `{genre}` receives the project version's path, or the built-in path if none exists.
- Add a new genre with a file in the same format. Do not add a second key registry.
## Built-in guides
- `action`, `adventure`, `platformer`, `puzzle`, `roguelike`, `rpg`, `shooter`, `simulation`, `sports`, `survival`.
- `strategy` is the umbrella for `rts`, `4x`, and `tactics`; it routes to them and keeps the content they share.
