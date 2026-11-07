import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyManifest, readProjectCatalog } from './catalog.ts';
import { applyJourney, publishJourney } from './journeys.ts';
import { createManagedMarkdown, editNativeCardProperties, type NativeCardMetadata } from './native-cards.ts';
import { bundledDeckArt } from './deck-art.ts';
import { appendActivity, describeActivity } from './activity.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import type { CardOptions } from '../src/bulk-contracts.ts';
import type { CatalogCard, CatalogJourneyStep, RunConfiguration } from '../src/catalog-contracts.ts';
import type { CardState } from '../src/format-vocabulary.ts';

async function prepareDirectory(directory: string): Promise<string> {
  const root = path.resolve(directory);
  const ancestors: string[] = [];
  for (let current = root; current !== path.dirname(current); current = path.dirname(current)) ancestors.unshift(current);
  for (const ancestor of ancestors) {
    try {
      const entry = await lstat(ancestor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Demo destination must be a directory without symbolic links.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(ancestor);
    }
  }
  if ((await readdir(root)).length > 0) throw new Error('Demo destination is not empty. Choose a new or empty folder.');
  return realpath(root);
}

// 2026-11-05: stable IDs and explicit ordering keep fresh demo projects comparable in documentation captures.
function demoId(name: string): string {
  const hex = createHash('sha256').update('deckmate-demo:' + name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function dateOffset(start: Date, days: number): string {
  return localIsoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days));
}

async function createMarkdown(root: string, filename: string, metadata: unknown, markdown: string): Promise<void> {
  if (!await createManagedMarkdown(root, filename, metadata, markdown)) throw new Error(`Demo file already exists: ${filename}`);
}

interface DemoCard {
  title: string;
  kind: NativeCardMetadata['kind'];
  deckId: string;
  summary: string;
  acceptance: string;
  owner?: string;
  state?: CardState;
  effort?: number;
  priority?: 'high' | 'medium' | 'low';
}

const cards: DemoCard[] = [
  { title: 'Moonwake Lantern', kind: 'hero', deckId: 'world', owner: 'Maya Chen', priority: 'high', summary: 'A brass lantern that reveals paths hidden beneath the tide. Warm light is the invitation to explore.', acceptance: 'The silhouette reads at gameplay distance; the light guides the player without a waypoint. Five Sub Cards follow the production Journey.' },
  { title: 'Tidekeeper Ferry', kind: 'hero', deckId: 'world', owner: 'Leo Park', priority: 'high', summary: 'A small ferry connecting the islands after dusk. Its bell, wake and wooden cabin should feel like a familiar home.', acceptance: 'The ferry arrives, boards the player and departs in one uninterrupted scene. Five Sub Cards follow the production Journey.' },
  { title: 'Paint the harbor color script', kind: 'task', deckId: 'world', owner: 'Maya Chen', state: 'started', effort: 3, priority: 'high', summary: 'Balance amber windows against a cool evening sea.', acceptance: 'Three lighting thumbnails remain readable in grayscale.' },
  { title: 'Shape the lighthouse silhouette', kind: 'task', deckId: 'world', owner: 'Leo Park', state: 'review', effort: 2, priority: 'medium', summary: 'Give the lighthouse a strong outline from the ferry approach.', acceptance: 'The landmark is visible from all three arrival cameras.' },
  { title: 'Block out the harbor market', kind: 'task', deckId: 'world', owner: 'Build Agent', state: 'started', effort: 5, priority: 'high', summary: 'Arrange stalls around a sheltered square with a clear route to the pier.', acceptance: 'The player can walk from spawn to the pier without a collision snag.' },
  { title: 'Sketch the tide garden', kind: 'task', deckId: 'world', owner: 'Maya Chen', state: 'not-started', effort: 2, priority: 'medium', summary: 'A garden that changes shape as water retreats.', acceptance: 'Low and high tide layouts share a recognizable focal point.' },
  { title: 'Polish the ferry arrival', kind: 'task', deckId: 'world', owner: 'Leo Park', state: 'not-started', effort: 3, priority: 'medium', summary: 'Time the first glimpse of the village to the last turn of the boat.', acceptance: 'The camera settles before control returns to the player.' },
  { title: 'Gather driftwood references', kind: 'task', deckId: 'world', owner: 'Research Agent', state: 'done', effort: 1, priority: 'low', summary: 'Collect weathered wood shapes that fit the harbor palette.', acceptance: 'Six original reference sketches are annotated with material notes.' },
  { title: 'Design the map room', kind: 'task', deckId: 'world', owner: 'Maya Chen', state: 'review', effort: 3, priority: 'high', summary: 'A quiet interior where the player plans the next crossing.', acceptance: 'The chart table, exit and lantern stand read from the entrance.' },
  { title: 'Dress the night fishing pier', kind: 'task', deckId: 'world', owner: 'Build Agent', state: 'not-started', effort: 2, priority: 'low', summary: 'Add nets, buckets and a single pool of warm light.', acceptance: 'Props support the route and leave the walking surface clear.' },
  { title: 'Implement the tide clock', kind: 'task', deckId: 'engineering', owner: 'Build Agent', state: 'started', effort: 5, priority: 'high', summary: 'Expose one shared tide value to water, paths and ambient sound.', acceptance: 'Save and load preserve the tide phase and the active route.' },
  { title: 'Keep lantern input responsive', kind: 'task', deckId: 'engineering', owner: 'Leo Park', state: 'review', effort: 2, priority: 'high', summary: 'Make raise, lower and inspect actions interruptible.', acceptance: 'No input is dropped when the player changes direction.' },
  { title: 'Add a scene validation command', kind: 'task', deckId: 'engineering', owner: 'Build Agent', state: 'not-started', effort: 3, priority: 'medium', summary: 'Report missing materials and disconnected travel points before a build.', acceptance: 'The command exits nonzero for a broken scene and names the offending asset.' },
  { title: 'Record the ferry bell', kind: 'task', deckId: 'audio', owner: 'Maya Chen', state: 'started', effort: 2, priority: 'high', summary: 'A soft bell that carries across the water without feeling urgent.', acceptance: 'Near and distant variations share the same recognizable attack.' },
  { title: 'Layer the harbor ambience', kind: 'task', deckId: 'audio', owner: 'Leo Park', state: 'review', effort: 3, priority: 'medium', summary: 'Combine waves, loose rigging and quiet conversation.', acceptance: 'The loop has no audible seam and leaves room for dialogue.' },
  { title: 'Prototype a low tide music cue', kind: 'task', deckId: 'audio', owner: 'Research Agent', state: 'not-started', effort: 2, priority: 'low', summary: 'A short musical response when a new path appears.', acceptance: 'The cue fades cleanly into the exploration bed.' },
  { title: 'The Moonwake promise', kind: 'doc', deckId: 'knowledge', summary: 'A small exploration game about restoring a coastal village, one evening crossing at a time.', acceptance: 'Curiosity before urgency. Warmth against the sea. Every repair changes a familiar place.' },
  { title: 'Art direction and materials', kind: 'doc', deckId: 'knowledge', summary: 'Use broad silhouettes, painted wood and restrained brass highlights. Amber marks places of welcome.', acceptance: 'Test assets in the dusk scene before adding surface detail. Keep material sources beside the exported asset.' },
  { title: 'How humans and agents work', kind: 'doc', deckId: 'knowledge', summary: 'Cards are Markdown in cards/. Decks and members are in tasks/deckmate.md. Journey instructions are in tasks/journeys/.', acceptance: 'Read the card, its parent and the relevant Journey step. Make a small change, record evidence, and ask a human to review. Assigning an agent does not start a model.' },
  { title: 'Playtest questions', kind: 'doc', deckId: 'knowledge', summary: 'Watch a new player arrive at the harbor without explaining the route.', acceptance: 'Can they find the lantern? Do they notice the tide changing? Which place do they want to visit next?' },
];

const steps: CatalogJourneyStep[] = [
  { id: 'design', title: 'Design %PARENT_TITLE%', deckId: 'production', owner: 'Maya Chen', dependsOn: [], effort: 2, priority: 'high', markdown: '# Goal\nSet the silhouette and material palette for %PARENT_TITLE%.\n\n- [x] Sketch three readable silhouettes.\n- [x] Select the warm and cool materials.\n\n## Acceptance\nThe approved design reads at gameplay distance.\n' },
  { id: 'build', title: 'Build %PARENT_TITLE%', deckId: 'production', owner: 'Build Agent', dependsOn: ['design'], effort: 5, priority: 'high', markdown: '# Goal\nBuild a lightweight prototype of %PARENT_TITLE%.\n\n- [x] Follow the approved design.\n- [ ] Test the model in the dusk scene.\n\n## Acceptance\nThe asset loads without missing materials and stays within its geometry budget.\n' },
  { id: 'review', title: 'Review %PARENT_TITLE%', deckId: 'production', owner: 'Maya Chen', dependsOn: ['design'], effort: 1, priority: 'medium', markdown: '# Goal\nReview the design of %PARENT_TITLE% with the art lead.\n\n- [x] Capture the approved view.\n- [ ] Record the review decision.\n\n## Acceptance\nA human checks the silhouette, palette and intended player experience.\n' },
  { id: 'integrate', title: 'Integrate %PARENT_TITLE%', deckId: 'production', owner: 'Build Agent', dependsOn: ['build'], effort: 3, priority: 'medium', markdown: '# Goal\nPlace %PARENT_TITLE% in the harbor after the build is accepted.\n\n- [ ] Connect interaction and collision.\n- [ ] Check the arrival sequence.\n\n## Acceptance\nThe complete interaction works in the playable scene.\n' },
  { id: 'polish', title: 'Plan sound for %PARENT_TITLE%', deckId: 'production', owner: 'Leo Park', dependsOn: [], effort: 2, priority: 'low', markdown: '# Goal\nPlan the sound and motion accents for %PARENT_TITLE%.\n\n- [ ] List the audible interactions.\n- [ ] Choose one memorable accent.\n\n## Acceptance\nA short cue sheet links every sound to an action in the scene.\n' },
];

async function createDecks(root: string, manifest: ReturnType<typeof emptyManifest>): Promise<void> {
  const definitions = [
    { id: 'world', title: 'World & props', kind: 'mixed' as const, art: 'buildings', color: '#607d98', icon: 'box', description: 'Places and objects that make Moonwake feel like home.' },
    { id: 'production', title: 'Production', kind: 'task' as const, art: 'art', color: '#027d84', icon: 'palette', description: 'From a clear design to an approved scene asset.' },
    { id: 'engineering', title: 'Engineering', kind: 'task' as const, art: 'coding', color: '#5e1f8b', icon: 'code', description: 'Small systems behind an uninterrupted evening adventure.' },
    { id: 'audio', title: 'Sound & music', kind: 'task' as const, art: 'audio', color: '#cf4a21', icon: 'audio', description: 'The harbor heard from near and far.' },
    { id: 'knowledge', title: 'Field notes', kind: 'knowledge' as const, art: 'knowledge', color: '#204bbd', icon: 'book', description: 'Shared direction, decisions and playtest questions.' },
  ];
  const directory = 'tasks/deckmate-assets/covers';
  await mkdir(path.join(root, directory), { recursive: true });
  for (const definition of definitions) {
    const { art, ...deck } = definition;
    const cover = `${directory}/${art}.webp`;
    await copyFile(await bundledDeckArt(art), path.join(root, cover), constants.COPYFILE_EXCL);
    manifest.decks.push({ ...deck, spaceId: 'studio', style: 'artwork', cover, coverPosition: 50 });
  }
}

async function createCards(root: string): Promise<void> {
  for (const card of cards) {
    const id = demoId(card.title);
    const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, title: card.title, kind: card.kind,
      deckId: card.deckId, state: card.kind === 'task' ? 'not-started' : null, owner: card.owner ?? null, effort: card.effort ?? null,
      priority: card.priority ?? null, trackIds: ['first-playable'], parentId: null };
    await createMarkdown(root, `cards/${id}.md`, metadata, `${card.summary}\n\n## ${card.kind === 'doc' ? 'Working notes' : 'Acceptance'}\n${card.acceptance}\n`);
  }
  const states = new Map(cards.map(card => [`card:${demoId(card.title)}`, card.state]));
  await setDemoStates(root, card => states.get(card.id));
}

// 2026-11-06: journal the real initialization transitions so the demo's pulse and activity agree with its cards.
async function setDemoStates(root: string, stateOf: (card: CatalogCard) => CardState | undefined): Promise<void> {
  const before = await readProjectCatalog(root);
  for (const card of before.cards) {
    const state = stateOf(card);
    if (state !== undefined && state !== card.state) {
      await editNativeCardProperties(root, card.id, card.sourceHash, { state }, undefined, before.formatLanguage);
    }
  }
  const after = await readProjectCatalog(root);
  const event = describeActivity(before, after, 'set-card-state');
  if (event) await appendActivity(root, event, after.formatLanguage);
}

async function createProductionJourney(root: string): Promise<void> {
  await publishJourney(root, async () => undefined, { id: demoId('production-journey'), version: 1, title: 'Prop production',
    deckId: 'world', description: 'A reusable path from silhouette to a playable harbor asset.', zones: [], steps });
  for (const seed of cards.filter(card => card.kind === 'hero')) {
    const catalog = await readProjectCatalog(root);
    const hero = catalog.cards.find(card => card.id === `card:${demoId(seed.title)}`)!;
    const journey = catalog.journeys![0];
    await applyJourney(root, catalog, { action: 'apply-journey', cardId: hero.id, sourceHash: hero.sourceHash,
      manifestHash: catalog.manifestHash, journeyId: journey.id, journeyHash: journey.fileHash,
      stepIds: steps.map(step => step.id), deckAssignments: {} });
  }
  const states: Record<string, CardState> = { design: 'done', build: 'started', review: 'review', integrate: 'not-started', polish: 'not-started' };
  await setDemoStates(root, card => card.journey ? states[card.journey.stepId] : undefined);
}

async function createPlanning(root: string, start: Date, catalogCards: CatalogCard[]): Promise<void> {
  const run = 'first-playable';
  const milestone = 'harbor-playtest';
  const configuration: RunConfiguration = { id: 'studio-run', shortName: 'MW', color: '#9258e5', labelTemplate: 'Run %RUN_NR%',
    startDate: dateOffset(start, -2), durationWeeks: 2, upcomingCount: 1, finishTime: '24:00',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, carryOver: { review: true, blocked: true, other: true } };
  await createMarkdown(root, 'tasks/deckmate-runs.md', { schema: 1, configurations: [configuration], runs: [{ id: run, number: 1,
    configurationId: configuration.id, start: configuration.startDate, end: dateOffset(start, 11), goal: 'First playable',
    description: 'Make one evening in Moonwake playable from shore to lighthouse.' }] }, '# First playable\n\nA focused production Run for the harbor arrival.\n');
  await createMarkdown(root, 'tasks/deckmate-milestones.md', { schema: 1, milestones: [{ id: milestone,
    title: 'Harbor playtest', date: dateOffset(start, 12), color: '#e2b66c' }] }, '# Harbor playtest\n\nInvite three new players to explore the first crossing.\n');
  const options: Record<string, CardOptions> = {};
  let handSlot = 0;
  const ordered = [...catalogCards].sort((first, second) => first.title.localeCompare(second.title, 'en'));
  for (const [index, card] of ordered.entries()) {
    const entry: CardOptions = { tags: [card.deckId === 'world' ? 'worldbuilding' : card.deckId ?? 'notes'] };
    if (card.kind !== 'doc') {
      entry.run = run;
      entry.milestone = milestone;
      entry.dueDate = dateOffset(start, card.kind === 'hero' ? 10 : 1 + index % 9);
      if (card.state === 'done') entry.doneAt = dateOffset(start, 0);
      else if (card.owner === 'Maya Chen') {
        entry.handMemberIds = ['maya'];
        entry.handOrder = { maya: handSlot++ };
      } else if (card.owner === 'Build Agent') {
        entry.handMemberIds = ['build-agent'];
        entry.handOrder = { 'build-agent': index };
      }
    }
    options[card.id] = entry;
  }
  await createMarkdown(root, 'tasks/deckmate-card-options.md', { schema: 1, cards: options }, '# Planning and personal queues\n\nDates, tags and Hand membership are shared project metadata. Owner and Hand are independent.\n');
  await createMarkdown(root, 'tasks/deckmate-tags.md', { schema: 1, tags: {
    worldbuilding: { color: '#d5b275' }, production: { color: '#52b7a7' }, engineering: { color: '#ad86d8' },
    audio: { color: '#e58e68' }, knowledge: { color: '#7d9dde' },
  } }, '# Project tags\n\nVisual categories for the Moonwake team.\n');
}

function sceneElement(id: string, type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type, x, y, width, height, angle: 0, strokeColor: '#495166', backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false, ...extra };
}

async function createVision(root: string): Promise<void> {
  const elements: Record<string, unknown>[] = [];
  const text = (id: string, value: string, x: number, y: number, width: number, size: number, color = '#1e2333') => {
    elements.push(sceneElement(id, 'text', x, y, width, size * 1.3 * value.split('\n').length, { text: value,
      originalText: value, fontSize: size, fontFamily: 2, textAlign: 'left', verticalAlign: 'top',
      containerId: null, lineHeight: 1.3, autoResize: true, strokeColor: color }));
  };
  text('title', 'MOONWAKE', 0, 0, 630, 52, '#9d5f00');
  text('subtitle', 'A quiet adventure between the tides', 2, 78, 700, 24);
  const pillars = [
    { title: '01 / EXPLORE', note: 'Follow the warm light.\nFind a path beneath the tide.', color: '#9d5f00' },
    { title: '02 / RESTORE', note: 'Repair a familiar place.\nLeave a visible change.', color: '#087f5b' },
    { title: '03 / RETURN', note: 'Take the evening ferry.\nSee the village come alive.', color: '#364fc7' },
  ];
  pillars.forEach((pillar, index) => {
    const left = index * 360;
    elements.push(sceneElement(`pillar-${index}`, 'rectangle', left, 142, 320, 148, { strokeColor: pillar.color, backgroundColor: '#eef0f6', roundness: { type: 3 } }));
    text(`heading-${index}`, pillar.title, left + 22, 162, 280, 20, pillar.color);
    text(`note-${index}`, pillar.note, left + 22, 206, 280, 17);
    if (index < 2) elements.push(sceneElement(`arrow-${index}`, 'arrow', left + 327, 216, 28, 0, { points: [[0, 0], [28, 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, strokeColor: '#8293ac' }));
  });
  const heroTitles = ['Moonwake Lantern', 'Tidekeeper Ferry'];
  heroTitles.forEach((title, index) => elements.push(sceneElement(`hero-${index}`, 'embeddable', index * 360, 336, 300, 230,
    { strokeWidth: 0, strokeColor: 'transparent', customData: { deckmateCardId: `card:${demoId(title)}`, deckmateCardView: 'full' }, link: `deckmate://card/${demoId(title)}` })));
  elements.push(sceneElement('production-progress', 'embeddable', 720, 336, 280, 120, { strokeWidth: 0, strokeColor: 'transparent',
    customData: { deckmateSmart: { deckId: 'production', state: null } }, link: 'deckmate://smart/production' }));
  text('north-star', 'WARMTH AGAINST THE SEA\nCuriosity before urgency.', 720, 488, 320, 18, '#9d5f00');
  await mkdir(path.join(root, 'boards'));
  await writeFile(path.join(root, 'boards', `${demoId('vision')}.excalidraw`), JSON.stringify({ type: 'excalidraw', version: 2,
    // 2026-11-05: Excalidraw transforms its light-space palette for dark mode; storing dark colors would invert to light.
    name: 'Moonwake — creative direction', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null, zoom: { value: 0.65 } }, files: {} }, null, 2) + '\n', { flag: 'wx' });
}

/** 2026-11-05: demo data is created only in an empty destination; existing project files are never replaced. */
export async function initializeDemo(directory: string): Promise<void> {
  const root = await prepareDirectory(directory);
  const start = new Date();
  // 2026-11-05: exclusive creation stops two initializers from both filling the same empty folder.
  await writeFile(path.join(root, 'README.md'), `# Moonwake Studio\n\nA fictional indie team making a quiet coastal adventure. Created ${localIsoDate(start)}.\n\nOpen with \`deckmate --data .\`. Edits are saved directly into this folder; add \`--read-only\` to browse without writing.\n\nThe 30 cards, five illustrated decks, production Journey, Run, milestone and Vision board are ordinary project files. Humans and agents share the same source; assigning an agent never starts a model.\n`, { flag: 'wx' });
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'studio', title: 'Moonwake Studio', kind: 'custom', icon: 'box' });
  await createDecks(root, manifest);
  manifest.members = [
    { id: 'maya', label: 'Maya Chen', kind: 'human', aliases: ['Maya'] },
    { id: 'leo', label: 'Leo Park', kind: 'human', aliases: ['Leo'] },
    { id: 'build-agent', label: 'Build Agent', kind: 'agent', aliases: [] },
    { id: 'research-agent', label: 'Research Agent', kind: 'agent', aliases: [] },
  ];
  manifest.tracks.push({ id: 'first-playable', title: 'First playable', description: 'One harbor arrival, made together across all five decks.' });
  manifest.pinnedMilestoneId = 'harbor-playtest';
  manifest.deckOrder = Object.fromEntries(manifest.decks.map(deck => [deck.id, {
    flatOrder: cards.filter(card => card.deckId === deck.id).map(card => `card:${demoId(card.title)}`),
  }]));
  await createMarkdown(root, 'tasks/deckmate.md', manifest, '# Moonwake Studio\n\nSchema 1 · Markdown is the source of truth.\n');
  await createCards(root);
  await createProductionJourney(root);
  await createPlanning(root, start, (await readProjectCatalog(root)).cards);
  await createVision(root);
}
