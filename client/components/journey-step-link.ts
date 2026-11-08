// The server appends a Journey step back-link to every generated Sub Card's body (server/journeys.ts); in the
// Markdown reading view that machine tail reads as noise. This helper hides it for display only — the file on
// disk keeps the link, so the data contract stays the single source of truth.
const stepLinkPattern = /(?:\r?\n)+---[ \t]*(?:\r?\n)+Journey step: \[([^\]\r\n]+)\]\(\.\.\/tasks\/journeys\/([^/\s)]+)\/steps\/([^/\s)]+)\.md\)[ \t]*(?:\r?\n)*$/;

/**
 * Splits the trailing server-written step link off a Sub Card body. Returns the body without the link only when
 * the link is the text's last block and points at the card's own Journey step; anything else stays untouched.
 */
export function splitJourneyStepLink(markdown: string, journey?: { journeyId: string; stepId: string } | null): { body: string; hasLink: boolean } {
  const match = stepLinkPattern.exec(markdown);
  if (!match || !journey) return { body: markdown, hasLink: false };
  const [, label, journeyId, stepId] = match;
  if (label !== journey.stepId || journeyId !== journey.journeyId || stepId !== journey.stepId) {
    return { body: markdown, hasLink: false };
  }
  return { body: markdown.slice(0, match.index).replace(/(?:\r?\n)+$/u, ''), hasLink: true };
}
