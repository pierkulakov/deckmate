# Area lenses
A lens defines requirements, questions, references, and checks for an area. Get project facts through `brief`, `find`, and `show`.
Use a lens when analyzing an area or auditing work in that area, so findings have relevant checks.
Use it when planning cards for that area to turn its requirements into verifiable results.
## Add a lens
- Create `<area>.md` with YAML frontmatter containing `area: <area>` and `title: <title>` between `---` markers.
- Include all five sections in order: "Requirements", "Area questions", "References", "Warning signs", and "How to verify".
- Use 5–8, 5–7, 4–6, 4–6, and 3–4 lines per section, respectively; keep the entire file within 35 lines.
- Put one verifiable rule or question on each line. Omit generic praise and domain history.
- In "Requirements", cover readability, visual consistency with rules, budgets, and the area's responsibility boundaries.
- Establish scale, entity counts, camera, target frame time, and acceptance criteria before proposing a solution.
- In "References", name the game and behavior to observe; link each line to GDC, the developer, or an analysis.
- Do not add unsourced lines. Prefer primary sources and do not attribute an analyst's conclusions to the developer.
- Describe observable defects in "Warning signs" and tie "How to verify" to measurements and a demonstration to a person.
- Do not copy project-specific facts, limits, or paths into a lens: they become stale and replace research.
## Project lenses
- Store custom lenses in `<project>/tasks/deckmate-lenses/<area>.md`; a project lens replaces the same-area built-in lens during analysis and runner substitution.
- Use the same format for a project lens.
- Separate general practice from project-specific rules: the former may belong in a built-in lens, the latter only in the project lens.
