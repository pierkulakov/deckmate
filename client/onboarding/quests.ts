import { Bot, Compass, Footprints, SlidersHorizontal, Users } from 'lucide-react';
import type { CardState } from '../../src/format-vocabulary.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import { defineText } from '../i18n.ts';
import { changedCards, hasSearchFilter, ownerOf, stateOf, type CardChange } from './catalog-facts.ts';
import type { Chapter } from './model.ts';
import type { OnboardingSignal } from './signals.ts';

// The Level panel registry (2026-11-05): five chapters, and every quest pays out exactly on the real action it
// teaches. A rule reads only the signal and the catalog-facts helpers, so no quest knows which button did the change.

export const questText = defineText({
  firstMovesTitle: 'First moves',
  openDeckTitle: 'Open a deck',
  openDeckBody: 'Cards live in decks, their home. On the `Decks` tab, click any deck to open its cards.',
  handAddTitle: 'Put a card in your Hand',
  handAddBody: 'A Hand is a personal queue, apart from Owner. Tick a card on `Decks`, press `Hand` in the bar that appears and pick whose Hand — or drag the card onto the `Add to hand` tab.',
  visitHandTitle: 'Visit your Hand',
  visitHandBody: 'The `Hand` tab is your personal queue: the cards you mean to do next, in your order.',
  startCardTitle: 'Start a card',
  startCardBody: 'Open a card from your `Hand` and press `Start work`. The card moves to Started — work has begun.',
  finishCardTitle: 'Finish a card',
  finishCardBody: 'Close what is done: press `Accept card` on a card in `Hand`, and it leaves the queue for the done pile.',
  workingTogetherTitle: 'Working together',
  assignOwnerTitle: 'Assign an owner',
  assignOwnerBody: 'Someone must answer for every card. Open one, press `Pick` by `Owner` and choose a member.',
  setPriorityTitle: 'Set a priority',
  setPriorityBody: 'Priority shows what comes first. Open a card and pick `High`, `Medium` or `Low` under `Priority`.',
  setEffortTitle: 'Estimate the effort',
  setEffortBody: 'Effort makes the load visible. Open a card and press a number under `Effort` — a rough guess is fine.',
  blockCardTitle: 'Make a card wait',
  blockCardBody: 'Open a card, then `Hero and Sub Cards` → `Dependencies` → `Add card` and pick what it waits on. It stays blocked until that card is done.',
  unblockCardTitle: 'Unblock a card',
  unblockCardBody: 'Two ways out: accept the card others wait on, or open `Dependencies` and remove the waiting. Then the card can move.',
  requestReviewTitle: 'Send work to review',
  requestReviewBody: 'Finished work goes to review. In `Hand`, press `Send to review` on a card you have started.',
  resolveReviewTitle: 'Resolve a review',
  resolveReviewBody: 'A card in review needs a verdict: `Accept card`, or return it — Deckmate will ask for a reason, and the reason teaches.',
  makeItYoursTitle: 'Make it yours',
  pickPreferenceTitle: 'Set theme or language',
  pickPreferenceBody: 'The theme lives behind the sun button in the top bar; the language — under `Русский` in the app menu behind the Deckmate mark.',
  activityFeedTitle: 'Open the activity feed',
  activityFeedBody: 'Every change in a deck lands in one log. Open a deck and press `Activity` on its left rail.',
  meetTeamTitle: 'Meet the team',
  meetTeamBody: 'People and agents sit in one registry. Open the app menu behind the Deckmate mark and press `Members…`.',
  attachFileTitle: 'Attach a file',
  attachFileBody: 'A picture or a PDF lives on the card itself. Open a card, press the `Attachments` paperclip, then drop the file or browse.',
  shapeProjectTitle: 'Shape the project',
  startTemplateTitle: 'Start from a template',
  startTemplateBody: 'Ten game genres, ready to go: in the app menu press `Start from template…`, pick one and `Apply`.',
  runJourneyTitle: 'Run a Journey',
  runJourneyBody: 'A Journey builds the plan for you. Open a `Hero` card, press `Journey`, create the step cards — the steps become its Sub Cards.',
  visionCardTitle: 'Put a card on Vision',
  visionCardBody: 'Vision is a free board for thinking. On the `Vision` tab, find a card with `Find a card…` and click it: the node stays linked to the real card.',
  filterSearchTitle: 'Search with filters',
  filterSearchBody: 'The `Search cards…` field speaks filters: `#tag`, `@owner`, `state:…`. Type one and watch the list narrow.',
  shortcutsTitle: 'See the shortcuts',
  shortcutsBody: 'Press `?` for every shortcut of the current screen. The keyboard button in the corner does the same.',
  agentsTitle: 'Agents on the team',
  addAgentTitle: 'Add an agent',
  addAgentBody: 'Agents are team members too. In `Members…` press `Add member` and set the kind to `Agent`.',
  installSkillTitle: 'Install the agent skill',
  installSkillBody: 'Run `npx deckmate skills install` in the project folder: Claude Code and Codex get the `/deckmate` skill and see the whole board.',
  agentOwnerTitle: 'Hand a card to an agent',
  agentOwnerBody: 'Open a card and set its `Owner` to an agent. Assigning runs nothing — the agent takes the card when you run it.',
  agentReportTitle: 'Get an agent report',
  agentReportBody: 'Run the agent on its card — `npx deckmate project next <agent>` or the `/deckmate` skill. Keep Deckmate open: the card moves to review on its own.',
  agentReviewTitle: 'Review an agent',
  agentReviewBody: 'An agent never accepts its own work. Read the report on the card, then accept it or return it with what to fix.',
  answerQuestionTitle: 'Answer an open question',
  answerQuestionBody: 'A Doc can ask. Find its open questions, press `Answer` — the answer lands in the resolved list and closes the linked card.',
}, {
  firstMovesTitle: 'Первые шаги',
  openDeckTitle: 'Откройте колоду',
  openDeckBody: 'Карты живут в колодах — это их дом. На вкладке `Decks` щёлкните по любой колоде, чтобы увидеть её карты.',
  handAddTitle: 'Положите карту в Hand',
  handAddBody: 'Hand — личная очередь, отдельная от Owner. Отметьте карту на `Decks`, нажмите `Hand` в появившейся полосе и выберите, чья это рука, — или перетащите карту на ярлык `Добавить в руку`.',
  visitHandTitle: 'Загляните в Hand',
  visitHandBody: 'Вкладка `Hand` — ваша личная очередь: карты, за которые вы возьмётесь, в вашем порядке.',
  startCardTitle: 'Возьмитесь за карту',
  startCardBody: 'Откройте карту из `Hand` и нажмите `Взять в работу` — карта перейдёт в состояние «В работе».',
  finishCardTitle: 'Закройте карту',
  finishCardBody: 'Закройте готовое: нажмите `Принять карточку` на карте в `Hand` — она уйдёт из очереди в стопку готовых.',
  workingTogetherTitle: 'Работа вместе',
  assignOwnerTitle: 'Назначьте владельца',
  assignOwnerBody: 'За каждую карту кто-то отвечает. Откройте карту, нажмите `Pick` у поля `Owner` и выберите участника.',
  setPriorityTitle: 'Поставьте приоритет',
  setPriorityBody: 'Приоритет показывает, что делать первым. Откройте карту и выберите `Высокий`, `Средний` или `Низкий` в поле `Priority`.',
  setEffortTitle: 'Оцените трудоёмкость',
  setEffortBody: 'Effort показывает нагрузку. Откройте карту и нажмите число в поле `Effort` — примерная оценка тоже годится.',
  blockCardTitle: 'Поставьте карту на ожидание',
  blockCardBody: 'Откройте карту, затем `Hero и Sub Cards` → `Зависимости` → `Добавить карту` и выберите, чего она ждёт. Карта заблокирована, пока та не закрыта.',
  unblockCardTitle: 'Снимите ожидание',
  unblockCardBody: 'Два выхода: принять карту, которой ждут, или открыть `Зависимости` и убрать ожидание. После этого карта снова движется.',
  requestReviewTitle: 'Отправьте на приёмку',
  requestReviewBody: 'Готовая работа уходит на приёмку. В `Hand` нажмите `Отправить на приёмку` на карте, которую делаете.',
  resolveReviewTitle: 'Разберите приёмку',
  resolveReviewBody: 'Карте в приёмке нужно решение: `Принять карточку` или вернуть — Deckmate спросит причину, и причина многому учит.',
  makeItYoursTitle: 'Под себя',
  pickPreferenceTitle: 'Смените тему или язык',
  pickPreferenceBody: 'Тема прячется за кнопкой солнца в верхней полосе; язык — за пунктом `English` в меню со значком Deckmate слева.',
  activityFeedTitle: 'Откройте ленту событий',
  activityFeedBody: 'Каждое изменение в колоде попадает в один журнал. Откройте колоду и нажмите `Activity` на её левой панели.',
  meetTeamTitle: 'Познакомьтесь с командой',
  meetTeamBody: 'Люди и агенты сидят в одном реестре. Откройте меню за значком Deckmate и нажмите `Участники…`.',
  attachFileTitle: 'Приложите файл',
  attachFileBody: 'Картинка или PDF живут на самой карте. Откройте карту, нажмите скрепку `Attachments` и перетащите файл или выберите его.',
  shapeProjectTitle: 'Устройство проекта',
  startTemplateTitle: 'Начните с шаблона',
  startTemplateBody: 'Десять игровых жанров под ключ: в меню приложения нажмите `Начать с шаблона…`, выберите жанр и `Применить`.',
  runJourneyTitle: 'Запустите Journey',
  runJourneyBody: 'Достаточно списка шагов: откройте карту `Hero`, нажмите `Journey` и создайте карты шагов — они станут её Sub Cards.',
  visionCardTitle: 'Положите карту на Vision',
  visionCardBody: 'Vision — свободное полотно для мыслей. На вкладке `Vision` найдите карту через `Найти карточку…` и щёлкните по ней: узел останется связан с картой.',
  filterSearchTitle: 'Поищите с фильтрами',
  filterSearchBody: 'Поле `Поиск карт…` понимает фильтры: `#тег`, `@владелец`, `state:…`. Наберите один — и список сузится.',
  shortcutsTitle: 'Откройте сочетания клавиш',
  shortcutsBody: 'Нажмите `?` — и увидите все сочетания текущего экрана. Кнопка клавиатуры в углу делает то же самое.',
  agentsTitle: 'Агенты в команде',
  addAgentTitle: 'Добавьте агента',
  addAgentBody: 'Агенты — тоже участники команды. В `Участники…` нажмите `Добавить участника` и поставьте вид `Агент`.',
  installSkillTitle: 'Поставьте навык агенту',
  installSkillBody: 'Запустите `npx deckmate skills install` в папке проекта: Claude Code и Codex получат навык `/deckmate` и увидят всю доску.',
  agentOwnerTitle: 'Отдайте карту агенту',
  agentOwnerBody: 'Откройте карту и назначьте `Owner` — агента. Назначение ничего не запускает: агент возьмёт карту, когда его запустят.',
  agentReportTitle: 'Дождитесь отчёта агента',
  agentReportBody: 'Запустите агента на его карте — `npx deckmate project next <агент>` или навык `/deckmate`. Держите Deckmate открытым: карта сама приедет в приёмку.',
  agentReviewTitle: 'Разберите работу агента',
  agentReviewBody: 'Агент не принимает свою работу сам. Прочитайте отчёт в карте и примите её — или верните с указанием, что поправить.',
  answerQuestionTitle: 'Ответьте на открытый вопрос',
  answerQuestionBody: 'Doc умеет спрашивать. Найдите его открытые вопросы и нажмите `Ответить` — ответ уйдёт в решённые и закроет связанную карту.',
});

export type QuestTextKey = keyof typeof questText.en;

type ChangeTest = (change: CardChange, after: CatalogView) => boolean;

/** A card changed by a save from this browser passes `test`: the person here did it, not a teammate or an agent. */
function anyEdit(signal: OnboardingSignal, test: ChangeTest): boolean {
  return signal.type === 'catalog-edit' && changedCards(signal.before, signal.after).some(change => test(change, signal.after));
}

/** A card changed in the files by someone else — an agent's own process, a teammate, an editor — passes `test`. */
function anyObserved(signal: OnboardingSignal, test: ChangeTest): boolean {
  return signal.type === 'catalog-observed' && changedCards(signal.before, signal.after).some(change => test(change, signal.after));
}

/** The card entered `state` from a different one; brand-new cards do not count. */
function movedInto(change: CardChange, state: CardState): boolean {
  return change.previous !== undefined && stateOf(change.card) === state && stateOf(change.previous) !== state;
}

/** The card left `state` for a different one. */
function movedFrom(change: CardChange, state: CardState): boolean {
  return change.previous !== undefined && stateOf(change.previous) === state && stateOf(change.card) !== state;
}

/** True when `next` carries an id that `previous` did not. */
function gainedId(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  const before = new Set(previous ?? []);
  return (next ?? []).some(id => !before.has(id));
}

/** True when an id of `previous` is missing from `next`. */
function lostId(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  const after = new Set(next ?? []);
  return (previous ?? []).some(id => !after.has(id));
}

// «Show me» targets (2026-11-05). Every list names the action element first; what follows are the first steps when
// the action needs an open card or an open deck, so the ring lands on the nearest place to start. Element names the
// interface translates appear in both languages; data attributes and shared classes do not translate.
const openCardStart = '.deck-card-open, .catalog-table-title, .catalog-deck-cover';
const cardProperties = '.card-preview-action-rail [aria-label="Properties"]';
const handCards = '.hand-slot .deck-card, .hand-queue-open, .hand-section-row, .hand-card-open, .global-tabs button:nth-child(2)';
const startWorkButton = '.card-preview-state-actions [aria-label="Start work"], .card-preview-state-actions [aria-label="Взять в работу"]';
const reviewButton = '.card-preview-state-actions [aria-label="Send to review"], .card-preview-state-actions [aria-label="Отправить на приёмку"]';
const acceptButton = '.card-preview-state-actions [aria-label="Accept card"], .card-preview-state-actions [aria-label="Принять карточку"]';

export const chapters: readonly Chapter<QuestTextKey>[] = [{
  id: 'first-moves',
  title: 'firstMovesTitle',
  icon: Footprints,
  quests: [
    { id: 'open-deck', xp: 40, title: 'openDeckTitle', body: 'openDeckBody', view: 'deck', target: '.catalog-deck-cover',
      done: signal => signal.type === 'deck-opened' },
    { id: 'hand-add', xp: 80, title: 'handAddTitle', body: 'handAddBody', view: 'deck',
      target: `.bulk-action-button[aria-label="Hand"], ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }) =>
        previous !== undefined && gainedId(previous.handMemberIds, card.handMemberIds)) },
    { id: 'visit-hand', xp: 40, title: 'visitHandTitle', body: 'visitHandBody', view: 'hand', target: '.global-tabs button:first-child',
      done: signal => signal.type === 'view' && signal.view === 'hand' },
    { id: 'start-card', xp: 80, title: 'startCardTitle', body: 'startCardBody', view: 'hand',
      target: `${startWorkButton}, ${handCards}`,
      done: signal => anyEdit(signal, change => movedInto(change, 'started')) },
    { id: 'finish-card', xp: 100, title: 'finishCardTitle', body: 'finishCardBody', view: 'hand',
      target: `${acceptButton}, ${handCards}`,
      done: signal => anyEdit(signal, change => movedInto(change, 'done')) },
  ],
}, {
  id: 'working-together',
  title: 'workingTogetherTitle',
  icon: Users,
  quests: [
    { id: 'assign-owner', xp: 60, title: 'assignOwnerTitle', body: 'assignOwnerBody', view: 'deck',
      target: `[data-property="owner"] .card-properties-pick, ${cardProperties}, ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }) =>
        previous !== undefined && card.owner !== null && card.owner !== previous.owner) },
    { id: 'set-priority', xp: 60, title: 'setPriorityTitle', body: 'setPriorityBody', view: 'deck',
      target: `[data-property="priority"] .card-properties-priorities, ${cardProperties}, ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }) =>
        previous !== undefined && card.priority != null && card.priority !== previous.priority) },
    { id: 'set-effort', xp: 60, title: 'setEffortTitle', body: 'setEffortBody', view: 'deck',
      target: `[data-property="effort"] .card-properties-effort-values, ${cardProperties}, ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }) =>
        previous !== undefined && card.effort != null && card.effort !== previous.effort) },
    { id: 'block-card', xp: 100, title: 'blockCardTitle', body: 'blockCardBody', view: 'deck',
      target: `.card-dependencies-add button, [data-card-family], ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }) =>
        previous !== undefined && gainedId(previous.dependsOn, card.dependsOn)) },
    { id: 'unblock-card', xp: 80, title: 'unblockCardTitle', body: 'unblockCardBody', view: 'deck',
      target: `.card-dependencies, [data-card-family], ${openCardStart}`,
      done: signal => anyEdit(signal, (change, after) =>
        (change.previous !== undefined && lostId(change.previous.dependsOn, change.card.dependsOn))
        || (movedInto(change, 'done') && after.cards.some(card => (card.dependsOn ?? []).includes(change.card.id)))) },
    { id: 'request-review', xp: 100, title: 'requestReviewTitle', body: 'requestReviewBody', view: 'hand',
      target: `${reviewButton}, ${handCards}`,
      done: signal => anyEdit(signal, change => movedInto(change, 'review')) },
    { id: 'resolve-review', xp: 100, title: 'resolveReviewTitle', body: 'resolveReviewBody', view: 'hand',
      target: `${acceptButton}, ${handCards}`,
      done: signal => anyEdit(signal, change => movedFrom(change, 'review')) },
  ],
}, {
  id: 'make-it-yours',
  title: 'makeItYoursTitle',
  icon: SlidersHorizontal,
  quests: [
    { id: 'pick-preference', xp: 60, title: 'pickPreferenceTitle', body: 'pickPreferenceBody',
      target: '[aria-label="Dark theme"], [aria-label="Light theme"], [aria-label="Светлая тема"], [aria-label="Тёмная тема"]',
      done: signal => signal.type === 'preference' },
    { id: 'activity-feed', xp: 60, title: 'activityFeedTitle', body: 'activityFeedBody', view: 'deck',
      target: '.deck-action-rail [aria-label="Activity"], .catalog-deck-cover',
      done: signal => signal.type === 'panel-opened' && signal.panel === 'activity' },
    { id: 'meet-team', xp: 60, title: 'meetTeamTitle', body: 'meetTeamBody', target: '.mission-control-trigger',
      done: signal => signal.type === 'panel-opened' && signal.panel === 'members' },
    { id: 'attach-file', xp: 80, title: 'attachFileTitle', body: 'attachFileBody', view: 'deck',
      target: `.card-preview-action-rail [aria-label="Attachments"], ${openCardStart}`,
      done: signal => signal.type === 'catalog-edit' && signal.action.action === 'upload-attachment' },
  ],
}, {
  id: 'shape-project',
  title: 'shapeProjectTitle',
  icon: Compass,
  quests: [
    // start-template and add-agent point at the menu mark: their dialogs are modal, so «Show me» runs before they open.
    { id: 'start-template', xp: 150, title: 'startTemplateTitle', body: 'startTemplateBody', view: 'deck',
      target: '.mission-control-trigger',
      done: signal => signal.type === 'catalog-edit' && signal.action.action === 'apply-project-template' },
    { id: 'run-journey', xp: 150, title: 'runJourneyTitle', body: 'runJourneyBody', view: 'deck',
      target: `.card-preview-journey-action, .deck-journey-button, ${openCardStart}`,
      done: signal => signal.type === 'catalog-edit' && signal.action.action === 'apply-journey' },
    { id: 'vision-card', xp: 120, title: 'visionCardTitle', body: 'visionCardBody', view: 'vision', target: '.vision-search input',
      done: signal => signal.type === 'vision-card-added' },
    { id: 'filter-search', xp: 80, title: 'filterSearchTitle', body: 'filterSearchBody',
      target: '.global-search input[role="combobox"]',
      done: signal => signal.type === 'search' && hasSearchFilter(signal.query) },
    { id: 'shortcuts', xp: 40, title: 'shortcutsTitle', body: 'shortcutsBody', target: '.shortcuts-corner-button',
      done: signal => signal.type === 'panel-opened' && signal.panel === 'shortcuts' },
  ],
}, {
  id: 'agents',
  title: 'agentsTitle',
  icon: Bot,
  quests: [
    { id: 'add-agent', xp: 100, title: 'addAgentTitle', body: 'addAgentBody', target: '.mission-control-trigger',
      done: signal => {
        if (signal.type !== 'catalog-edit' || signal.action.action !== 'configure-members') return false;
        const before = new Set((signal.before.members ?? []).filter(member => member.kind === 'agent').map(member => member.id));
        return (signal.after.members ?? []).some(member => member.kind === 'agent' && !before.has(member.id));
      } },
    // install-skill has no target: the action is a terminal command, not an interface element.
    { id: 'install-skill', xp: 150, title: 'installSkillTitle', body: 'installSkillBody',
      done: signal => signal.type === 'facts' && signal.facts.agentSkill },
    { id: 'agent-owner', xp: 100, title: 'agentOwnerTitle', body: 'agentOwnerBody', view: 'deck',
      target: `[data-property="owner"] .card-properties-pick, ${cardProperties}, ${openCardStart}`,
      done: signal => anyEdit(signal, ({ card, previous }, after) =>
        previous !== undefined && card.owner !== previous.owner && ownerOf(after, card)?.kind === 'agent') },
    { id: 'agent-report', xp: 200, title: 'agentReportTitle', body: 'agentReportBody', view: 'hand', target: handCards,
      // Observed, not edited: the agent writes the files from its own process, this browser only reads them.
      done: signal => anyObserved(signal, (change, after) => ownerOf(after, change.card)?.kind === 'agent' && movedInto(change, 'review')) },
    { id: 'agent-review', xp: 150, title: 'agentReviewTitle', body: 'agentReviewBody', view: 'hand',
      target: `${acceptButton}, ${handCards}`,
      done: signal => anyEdit(signal, (change, after) =>
        ownerOf(after, change.card)?.kind === 'agent' && movedFrom(change, 'review')) },
    { id: 'answer-question', xp: 120, title: 'answerQuestionTitle', body: 'answerQuestionBody', view: 'deck',
      target: `.open-question-actions > button:last-of-type, .catalog-card-open-questions, ${openCardStart}`,
      done: signal => signal.type === 'catalog-edit' && signal.action.action === 'record-decision' },
  ],
}];
