## Deckmate board

This project's board is kept in Deckmate. Do not read `cards/` wholesale and do not write card files by hand.

Take and hand in a card with commands; they work on the files and need no server:

- `npx deckmate project next <member>` — the next card in a member's Hand
- `npx deckmate project brief <card>` — everything needed for one card
- `npx deckmate project report <card> --file report.md --member <member> --state review` — hand it in

Create or change cards only through the running board:

1. `GET http://127.0.0.1:4317/api/snapshot?source=sandbox` returns `token`. If nothing answers, start `npx deckmate --no-open` in the project folder in the background and wait for the address to answer. If it cannot start, stop and tell the person; do not look for another way.
2. `GET /api/catalog?source=sandbox` returns `manifestHash`.
3. `POST /api/catalog` with the headers `Content-Type: application/json`, `x-deckmate-token: <token>` and `x-deckmate-actor: <member id>`, and this body for each new card:

   ```json
   {"action":"create-card","source":"sandbox","manifestHash":"<manifestHash>","cardId":"card:<new UUID>","kind":"task","title":"<title>","markdown":"","deckId":null,"trackIds":[],"parentId":null,"owner":null,"effort":null,"priority":null}
   ```

   `deckId: null` sends the card to Inbox when the project has one that accepts it; otherwise the card stays without a deck. Take `manifestHash` for the next request from the response.
4. Stop a server you started yourself.

Two rules hold everywhere: never mark your own work accepted — a reviewer does that; and put a blocking question through `npx deckmate project ask` instead of guessing.

These rules cover taking a card, doing it and handing it in. For planning, review, Journey steps, design documents, playtests and team setup, open the `/deckmate` skill first: it carries the route for each.
