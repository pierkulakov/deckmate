# Discuss a question and apply its decision

**When:** a card needs a human decision, or a saved answer needs implementation. **Not this:** reviewing a submission → [review](review.md).
**Person:** discusses and approves the answer. **Agent:** records that answer, edits its target, and marks it applied.

## Model

- The question lives on the card it concerns; the addressee is optional, and the answer target defaults to that card.
- `ask` accepts 1–900 characters and uses the first registered human when `to` is omitted; if no human is registered, the question is unaddressed. Any open question keeps its Task out of `next` until answered.
- `question <c-ref#N>` supplies the question, optional addressee, target range and three latest decisions for discussion in chat.
- After the person answers, `answer <c-ref#N> … --as <human>` records a pending decision in that card's Decided section.
- `next` returns pending decisions before cards: edit the supplied `path:from-to` target, then `apply_decision` / `apply`.
- The brief lists open question refs and unapplied decisions; applied decisions leave the pool.

## Steps

Enter at the first unfinished operation: step 1 only for a new question, step 2 for an existing `c-…#N`, step 3 once the person has answered, and step 4 for a saved pending decision.

1. Ask with MCP `ask`, or `deckmate project ask <c-ref> "<question>" --member <you> [--to <human>] [--target <c-ref[#section]>] --data <project>`; text must be 1–900 characters.
   → Name the uncertainty and affected criterion. Without `--to`, the first registered human is selected; if there is none, the question has no addressee. The default target is the same card; use another card or section only when the answer belongs there.
2. Find the concerned card's current question ref (`c-…#N`) in `brief`, then read it with MCP `question {ref:"c-…#N"}` or `deckmate project question <c-ref#N> --data <project>`. `ask` returns the question text, not a ref.
   → Discuss the supplied question and recent decisions. Do not search for the target: the package already contains its inclusive `path:from-to` range.
3. After the person actually answers, record it with MCP `answer {ref,rev,answer,as:"<human>"}` — `rev` is the card's rev returned by `question` — or `deckmate project answer <c-ref#N> "<answer>" --as <human> --member <you> --rev <rev> --data <project>`.
   → The id in `as` names the answering human. Never invent consent or record the agent as the person; the output gives the decision index and target.
4. Run `next` when ready to implement. It returns a pending decision before ordinary card work, with `target` and the fixed next step `edit the target, then apply_decision`.
   → Edit only that target through the project's authorized editing route. For a card target use its normal content editor / guarded server write; for source files use the assigned code workflow and checks.
5. Mark the completed edit with MCP `apply_decision {card,index,rev,note?}` — `rev` is the decision's rev returned by `next` — or `deckmate project apply <c-ref> <index> --rev <rev> [--note "<text>"] --data <project>`.
   → Decision indexes are zero-based. Do not mark before the edit exists. The returned `applied` value is the application date (or an empty legacy mark when its date is unknown); an optional `note` (up to 2000 characters) is saved beside the applied mark as an application note.
6. Reread `brief <c-ref>` or the target range and run the affected checks.
   → The open question is gone, the decision is no longer pending, and `next` can return ordinary card work. Otherwise finish the edit before reporting completion.

## Rules

- A question has at most one human addressee; when no human is registered, its addressee is null. Preserve the named person's control over the answer.
- Chat is discussion, not a saved decision: always finish `answer`, then the target edit and `apply_decision`.
- Keep dependent work paused while its source Task remains unfinished; `next` excludes the source Task while any open question remains unanswered.
- Do not turn a question into a separate work card, and never accept your own implementation work.
