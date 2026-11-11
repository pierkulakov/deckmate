# Resolve a blocking question

**When:** a Task cannot meet its tolerances without a human decision. **Not this:** returning a failed submission → [review](review.md).
**Person:** chooses the answer and records it in the rule Doc, or answers directly when the Task has no rule Doc.
**Agent:** asks a concrete question, pauses dependent work, checks the saved answer, and resumes only when the blocker is resolved.

## Steps

1. Read `deckmate project brief <c-ref> --budget 1500 --data <project>`.
   → Follow [brief](../references/cli.md#brief) to the relevant rule ranges with [show](../references/cli.md#show), check existing decisions, and identify what prevents the [Task](../references/cards.md#task) from passing. Save an ISO timestamp with timezone for the next check-in.
2. First check the [rule Doc route](../references/cards.md#rule-doc-and-questions). Ask `deckmate project ask <c-ref> "<question>" --member <you> --data <project>`; add `--to <human>` only when a top-level rule Doc exists, otherwise contact the person directly.
   → Inspect `question`, `link`, and `warnings` ([ask](../references/cli.md#ask)). Name the uncertainty, viable choices, and the affected criterion; use the acting agent's registered ID and the intended human's ID.
3. Check where the question landed ([rule Doc and questions](../references/cards.md#rule-doc-and-questions)):
   - **Task under a top-level rule Doc:** the Doc's `## Open questions` gains the question and a link to a child Decision Task; that Task belongs to the named human and enters their Hand. Check the link and [human's Hand](../references/cli.md#hand).
   - **Native Task without a rule Doc:** its own `## Open questions` gains the question; no Decision Task is created and `--to` is not used. Tell the person directly, including the c-ref, question, and what is paused; do not wait for a Task to reach their Hand.
4. Stop work on this Task and anything that depends on the answer; tell the person which cards are waiting.
   → `ask` leaves the source Task's state and dependencies unchanged and does not stop `next`. Continue only independent, already approved work; do not invent an answer to keep the queue moving.
5. At the agreed check-in, for a rule-Doc question run `deckmate project inbox <member> --since <saved-ISO> --data <project>`; for a local question skip inbox and reread the Task with [show](../references/cli.md#show).
   → Inspect the saved decision, not just [notifications](../references/cli.md#inbox). Pause the session rather than polling continuously.
6. Have the person record the answer:
   - **Rule Doc:** open its question in the UI, choose **Answer**, select the answering human, and record the decision. Alternatively, with that human's approval, use HTTP `record-decision` via [the API reference](../references/api.md), not a CLI command. The answer lands in `## Decided`, the open item is removed, and the linked Decision Task is accepted.
   - **No rule Doc:** the person replies directly; save the approved answer under `## Decided` in the Task body with the answering person and local date, then remove the resolved local question only through the running server's UI / HTTP `update-card-content` ([server startup rule](../references/api.md)), never by hand. `record-decision` is for a rule Doc, not a Task.
7. Verify `deckmate project show <rule-c-ref> --lines <a-b> --data <project>`.
   → Read the saved `## Decided` range and check the answer, human, date, and removal of the open question; check the linked Decision Task's completion. For a local-only question, use the source Task's c-ref and answer range instead. If the answer is ambiguous or saving warned, clarify or reconcile before resuming.
8. When the answer resolves the blocker, run `deckmate project state <c-ref> started --member <you> --data <project>` as you actually resume.
   → Confirm the saved [state](../references/cli.md#state), reread the affected rules and tolerances, then continue [work](work.md); the Decision Task's acceptance does not accept the implementation Task.

## Done when

- The approved answer is saved in the rule Doc's `## Decided` or the local Task body; `deckmate project show <c-ref> --lines <a-b> --data <project>` verifies it, not a remembered conversation.
- The open question is resolved, any linked Decision Task is accepted, and the affected work resumes against the saved decision; otherwise the blocker stays reported and work stays paused.

## Rules

- Raise a blocker as soon as it affects a tolerance — waiting spreads avoidable rework.
- Address one named human who can decide — an unanswered broadcast has no owner.
- Offer evidence and choices without deciding for the person — a question must preserve their control.
- End the question with a saved decision — a conversation alone cannot guide later work.
- Verify the decision in its source range — a quiet inbox or shortened brief cannot prove absence.

## Pitfalls

- No Decision Task was created → contact the person directly; the local-only warning is not a delivery confirmation.
- The answer is missing from `inbox` → read the rule Doc or local Task; notifications are not an answer log.
