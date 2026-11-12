import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLang } from '../client/i18n.ts';
import { JourneyTrack, journeyTrackModels, orderJourneySteps } from '../client/components/JourneyTrack.tsx';
import { JourneyStepNote } from '../client/components/JourneyStepNote.tsx';
import { splitJourneyStepLink } from '../client/components/journey-step-link.ts';
import { journeyStepTitle } from '../client/components/journey-step-title.ts';
import type { CatalogCard, CatalogJourneyStep } from '../src/catalog-contracts.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

function stepCard(id: string, title: string, state: CatalogCard['state'], stepId: string, dependsOn: string[] = []): CatalogCard {
  return {
    id, kind: 'task', path: `cards/${id}.md`, version: null, title, state, owner: null, deckId: 'production',
    trackIds: [], parentId: 'card:hero', markdown: '', sourceHash: 'hash', range: null, dependsOn,
    journey: { journeyId: 'production-journey', version: 1, stepId, instanceId: 'instance-1' },
  };
}

const stepDependencies: Record<string, string[]> = {
  design: [], build: ['design'], review: ['design'], polish: [], integrate: ['build'],
};
const steps: CatalogJourneyStep[] = ['design', 'build', 'review', 'polish', 'integrate'].map(id => ({
  id, title: `${id[0].toUpperCase()}${id.slice(1)}: %PARENT_TITLE%`, markdown: '', deckId: 'production', owner: null, dependsOn: stepDependencies[id],
}));
const design = stepCard('card:design', 'Design prop', 'done', 'design');
const build = stepCard('card:build', 'Build prop', 'started', 'build', ['card:design']);
const review = stepCard('card:review', 'Review prop', 'review', 'review', ['card:design']);
const polish = stepCard('card:polish', 'Polish prop', 'not-started', 'polish');
const integrate = stepCard('card:integrate', 'Integrate prop', 'not-started', 'integrate', ['card:build']);
const run = [integrate, polish, design, review, build];
const props = { title: 'Prop production', version: 1, cards: run, steps };
const done = run.map(card => ({ ...card, state: 'done' as const }));
const waiting = [design, integrate];

function renderTrack(cards: CatalogCard[] = run, overrides: Partial<Parameters<typeof JourneyTrack>[0]> = {}): string {
  return renderToStaticMarkup(<JourneyTrack {...props} cards={cards}
    cardsById={new Map([...run, ...cards].map(card => [card.id, card]))} {...overrides} />);
}

describe('Journey mini-cards', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    setLang('en');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows template order and makes the complete template title a menu trigger beside the quiet version', () => {
    const html = renderTrack();
    const labels = [...html.matchAll(/aria-label="(\d\. [^"]+)"/gu)].map(match => match[1].split(' — ')[0]);
    expect(labels).toEqual(['1. Design prop', '2. Build prop', '3. Review prop', '4. Polish prop', '5. Integrate prop']);
    expect(html).toContain('class="journey-track-title-button"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Prop production: steps"');
    expect(html).toContain('<span class="journey-track-title">Prop production</span>');
    expect(html).toContain('</button><span class="journey-track-version">v1</span>');
    expect(html).not.toContain('Journey: Prop production');
    setLang('ru');
    expect(renderTrack()).toContain('aria-label="Prop production: шаги"');
  });

  it('uses a hidden accepted description beside the aria-hidden counter', () => {
    const html = renderTrack();
    expect(html).toContain('aria-hidden="true">1/5</span>');
    expect(html).toContain('class="visually-hidden">1 of 5 accepted</span>');
    expect(html).not.toContain('journey-track-count is-done');
    setLang('ru');
    expect(renderTrack()).toContain('1 из 5 принято');
  });

  it('marks only the first available step and uses its template name in Next', () => {
    const html = renderTrack();
    expect(html.match(/data-next="true"/gu)).toHaveLength(1);
    expect(html).toContain('data-state="working" data-next="true"');
    expect(html).toContain('aria-label="Build prop">Build</button>');
    expect(html).toContain('· started</span>');
    expect(html).not.toContain('%PARENT_TITLE%');
    expect(renderTrack([polish])).not.toContain('journey-track-state');
  });

  it('announces completion without Next and enters the row at its last card', () => {
    setLang('ru');
    const html = renderTrack(done);
    expect(html).not.toContain('data-next');
    expect(html).toContain('Все шаги приняты');
    expect(html).toContain('journey-track-count is-done');
    expect(html).toContain('aria-hidden="true">5/5</span>');
    expect(html.match(/tabindex="0"/gu)).toHaveLength(1);
    expect(html).toContain('tabindex="0" aria-label="5. Integrate prop');
  });

  it('names the open dependency when all remaining steps wait, in both languages', () => {
    const html = renderTrack(waiting);
    expect(html).not.toContain('data-next');
    expect(html).toContain('Waiting on:</span>');
    expect(html).toContain('class="journey-track-wait" title="Build prop">Build prop</strong>');
    expect(html).toContain('Blocked by dependency (waiting on: Build prop)');
    expect(html).toContain('tabindex="0" aria-label="2. Integrate prop');
    setLang('ru');
    const russian = renderTrack(waiting);
    expect(russian).toContain('Ждёт:</span>');
    expect(russian).toContain('заблокировано зависимостью (ждёт: Build prop)');
    expect(russian.match(/aria-label="Исполнение Journey"/gu)).toHaveLength(2);
  });

  it('falls back to the card title for absent or empty template labels', () => {
    expect(renderTrack([build], { steps: [] })).toContain('aria-label="Build prop">Build prop</button>');
    expect(renderTrack([build], { steps: [{ ...steps[1], title: ' — %PARENT_TITLE% : ' }] }))
      .toContain('aria-label="Build prop">Build prop</button>');
  });

  it.each([
    ['Sound: %PARENT_TITLE%', 'Sound'], ['%PARENT_TITLE% — Build – ', 'Build'],
    [' , · - Design: %PARENT_TITLE% — ', 'Design'], ['Plan sound for %PARENT_TITLE%', 'Plan sound for'],
    ['%PARENT_TITLE%', 'Full card'], [' ', 'Full card'],
  ])('cleans the compact template label %s', (title, expected) => {
    expect(journeyStepTitle(title, '', 'Full card')).toBe(expected);
  });

  it('retains the dialog Hero substitution and unnamed-step fallback', () => {
    expect(journeyStepTitle('Sound: %PARENT_TITLE%', '‹Hero›', 'New step')).toBe('Sound: ‹Hero›');
    expect(journeyStepTitle('Sound: %PARENT_TITLE%', 'Tidekeeper Ferry')).toBe('Sound: Tidekeeper Ferry');
    expect(journeyStepTitle('', '‹Hero›', 'New step')).toBe('New step');
  });

  it('keeps unmatched cards in family order and renders no empty execution block', () => {
    const stray = stepCard('card:stray', 'Stray card', 'not-started', 'gone-step');
    expect(orderJourneySteps([stray, build, design], steps).map(card => card.id))
      .toEqual(['card:design', 'card:build', 'card:stray']);
    expect(orderJourneySteps([build, design], []).map(card => card.id)).toEqual(['card:build', 'card:design']);
    expect(renderTrack([])).toBe('');
  });

  it('builds the step models the row renders, with the run counters', () => {
    const cardsById = new Map(run.map(card => [card.id, card]));
    const { models, nextIndex, accepted } = journeyTrackModels(run, steps, cardsById, 'en');
    expect(models.map(model => model.title)).toEqual(['Design', 'Build', 'Review', 'Polish', 'Integrate']);
    expect(models.map(model => model.state)).toEqual(['accepted', 'working', 'review', 'planned', 'blocked']);
    expect(models.map(model => model.card.id)).toEqual([design.id, build.id, review.id, polish.id, integrate.id]);
    expect(nextIndex).toBe(1);
    expect(accepted).toBe(1);
    expect(models.find(model => model.next)?.card.id).toBe(build.id);
    expect(models.find(model => model.state === 'blocked')?.stateLabel).toBe('Waiting: Build');
  });

  it('splits the server-written step link off a Sub Card body for display only', () => {
    const link = (eol: string) => `Do the thing.${eol}${eol}---${eol}${eol}Journey step: [review](../tasks/journeys/production-journey/steps/review.md)${eol}`;
    const journey = { journeyId: 'production-journey', stepId: 'review' };
    expect(splitJourneyStepLink(link('\n'), journey)).toEqual({ body: 'Do the thing.', hasLink: true });
    expect(splitJourneyStepLink(link('\r\n'), journey)).toEqual({ body: 'Do the thing.', hasLink: true });
    expect(splitJourneyStepLink(link('\n'), { ...journey, journeyId: 'other-journey' })).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n'), { ...journey, stepId: 'build' })).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n') + 'tail text', journey)).toEqual({ body: link('\n') + 'tail text', hasLink: false });
    expect(splitJourneyStepLink(link('\n'), null)).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink(link('\n'))).toEqual({ body: link('\n'), hasLink: false });
    expect(splitJourneyStepLink('No link at all.', journey)).toEqual({ body: 'No link at all.', hasLink: false });
  });

  it('renders the step note with its position, step name, journey title and step state', () => {
    const html = renderToStaticMarkup(<JourneyStepNote {...props} card={review}
      cardsById={new Map(run.map(card => [card.id, card]))} />);
    expect(html).toContain('Step 3 of 5 · <strong>Review</strong> · Prop production <span class="journey-step-note-version">v1</span>');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('data-step-state="review"');
    expect(html).toContain('title="Prop production v1 · Step 3 of 5 · Review · Review"');
    const stray = { ...review, journey: undefined };
    expect(renderToStaticMarkup(<JourneyStepNote {...props} card={stray} cardsById={new Map()} />)).toBe('');
    setLang('ru');
    expect(renderToStaticMarkup(<JourneyStepNote {...props} card={review}
      cardsById={new Map(run.map(card => [card.id, card]))} />)).toContain('Шаг 3 из 5');
  });
});
