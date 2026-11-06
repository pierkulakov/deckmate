---
deckmate: project-template
schema: 1
id: sports
title: Sports
description: Match rules, teams, players, venues and career events for competitive sports games.
category: games
genre: null
order: 8
spaces:
  - id: gdd
    title: Game Design Documents (GDD)
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: match-rules
    space: gdd
    title: Match Rules
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: rules
    journey: sports-match-rules
    description: Scoring, restarts, fouls, time limits and tie resolution.
  - id: teams
    space: gdd
    title: Teams
    kind: asset
    icon: users
    color: "#5e7bd6"
    art: factions
    description: Rosters, team identity, formations and tactical strengths.
  - id: players
    space: gdd
    title: Players
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: units
    journey: sports-players
    description: Player archetypes, attributes, actions and control response.
  - id: venues
    space: gdd
    title: Venues
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: maps
    journey: sports-venues
    description: Field dimensions, boundaries, camera clearance and atmosphere.
  - id: career-events
    space: gdd
    title: Career Events
    kind: asset
    icon: tasks
    color: "#5e7bd6"
    art: knowledge
    description: Competitions, selection decisions, training and progression rewards.
  - id: coding
    space: production
    title: Coding
    kind: task
    icon: code
    color: "#5e1f8b"
    art: coding
    roles:
      - code
    description: Gameplay systems, data integration and tools.
  - id: art
    space: production
    title: Art
    kind: task
    icon: palette
    color: "#d57240"
    art: art
    roles:
      - art
    description: Models, sprites, materials and visual effects.
  - id: game-design
    space: production
    title: Game Design
    kind: task
    icon: gamepad
    color: "#94713e"
    art: game-design
    roles:
      - design
    description: Rules, tuning and playable design experiments.
  - id: audio
    space: production
    title: Audio
    kind: task
    icon: audio
    color: "#477967"
    art: audio
    roles:
      - audio
    description: Sound effects, ambience and event timing.
  - id: bugs-qa
    space: production
    title: Bugs & QA
    kind: task
    icon: bug
    color: "#b64c5b"
    art: bugs
    roles:
      - qa
    description: Reproduction cases, regression checks and playtest findings.
tags:
  - name: bug
    color: "#687e9c"
    emoji: 🐞
samples:
  - deck: match-rules
    title: Three-Minute Overtime
    markdown: After a tied regulation match, play one three-minute overtime period. A goal ends the match immediately. If time expires level, record a draw; pause the clock during restarts.
  - deck: players
    title: Playmaker
    markdown: A passing specialist with quick direction changes and moderate shooting power. Creates space for teammates but loses shoulder-to-shoulder contests against stronger players. Use the same controls as other archetypes.
  - deck: venues
    title: Riverside Court
    markdown: A compact outdoor court for three-a-side matches. Mark a continuous boundary and safe restart spots. Keep the gameplay camera clear of the riverside fence and separate crowd noise from whistle cues.
---

Define the sport through its rules and the people and places that make a match readable. GDD separates match rules, teams, players, venues and career events. Journeys cover a rule change, a player archetype and a playable venue, with concrete checks for scoring, controls and field boundaries. Optional examples describe a small arcade league.
