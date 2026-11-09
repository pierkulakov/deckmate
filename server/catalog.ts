import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, isSeq, parse, parseDocument as parseYamlDocument, stringify, type YAMLMap, type YAMLSeq } from 'yaml';
import { isMechanicPath, parseDocument } from '../src/markdown.ts';
import { appendCardReport, readCardContent, readHeroSections, updateCardContent } from './card-content.ts';
import type { CatalogCard, CatalogDeck, CatalogDeckManualOrder, CatalogDeckZone, CatalogEdit, CatalogMember, CatalogSpace, CatalogTrack, CatalogView, DeckKind } from '../src/catalog-contracts.ts';
import { deckAcceptsCard, deckCanBeInbox, newCardDeckId } from '../src/catalog-contracts.ts';
import { resolveMember } from '../src/members.ts';
import { linkDecisionTask, openQuestionsOf, parseOpenQuestions, recordDecision } from '../src/open-questions.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { containedFile } from './config.ts';
import { parseCached } from './parse-cache.ts';
import { assertCatalogCoverFile, isCatalogCoverPath, storeCatalogCover, type StoredCatalogCover } from './catalog-covers.ts';
import { createManagedMarkdown, editNativeCard, ensureManagedDirectory, editNativeCardParent, editNativeCardContent, editNativeCardProperties, nativeCardPath, readNativeCard, readNativeCards, readProjectMarkdown, replaceProjectMarkdown, validateNativeCardMetadata, type NativeCardFile, type NativeCardMetadata } from './native-cards.ts';
import { applyJourney, createJourney, readJourneys } from './journeys.ts';
import { bundledJourneyTemplatesDirectory, journeyTemplateDirectories, readJourneyTemplates } from './journey-templates.ts';
import { updateLegacyCardState } from './card-properties.ts';
import type { CardOptions } from '../src/bulk-contracts.ts';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions, sourceComments, type CardOptionsPatch } from './card-options.ts';
import { getCatalogHands, localIsoDate, selectCatalogHand } from '../src/catalog-hand.ts';
import { appendCardsToDeckOrder, completeDeckManualOrder } from '../src/catalog-manual-order.ts';
import { prepareProjectTag, projectTagsPath, readProjectTags } from './project-tags.ts';
import { milestonesPath, planningHistoryPath, runsPath } from '../src/planning-files.ts';
import { canonicalDataPath } from '../src/brand-compat.ts';
import { resolveDataPath } from './data-paths.ts';
import { validateCardFamily } from './card-family.ts';
import { heroCountedTasks } from '../src/hero-done.ts';
import { deckTypeChangeIssue } from '../src/deck-type-policy.ts';
import { catalogFileChanged, currentCatalogSnapshot, readCatalogSnapshot } from './catalog-snapshot.ts';
import { defineText, serverText, serverLang } from './i18n.ts';
import { cardStates, cardStateWords, projectFormatLanguage, readCardState, writeCardState, writeMarker, type CardState, type FormatLanguage } from '../src/format-vocabulary.ts';

const catalogText = defineText({
  invalidMembers: "Invalid project member list.",
  invalidMember: "Invalid project member or duplicate ID.",
  invalidDeckOrderMap: "Deck order must map decks to zones and card order.",
  deckParticipants: "Deck participants must contain up to 200 registered member IDs.",
  memberMissing: "Member not found in the project registry.",
  reportRollbackFailed: "The report may have been saved, but the state failed and the original card could not be restored safely. Read the card before retrying.",
  autoTag: "Deck auto-tag must be a nonempty string of up to 80 characters.",
  autoTagFlag: "The auto-tag flag must be a boolean.",
  deckYaml: "A deck must be an explicit YAML map without aliases to be moved to or from the pile in place.",
  templateText: "Deck card template must contain up to 50000 characters.",
  templateOwner: "Template Owner must be one line of up to 120 characters.",
  defaultOrder: "Default deck order must be a string such as order=state&direction=asc, up to 200 characters.",
  templateEffort: "Template Effort must be a nonnegative number.",
  templatePriority: "Template Priority must be high, medium or low.",
  yamlObject: "The catalog must contain a YAML object.",
  unsupportedSchema: "Unsupported catalog schema.",
  invalidFormatLanguage: "formatLanguage must be en or ru.",
  pinnedMilestone: "Invalid pinned Milestone ID.",
  subCardOrder: "Sub Cards order must map each Hero to a list of IDs.",
  subCardOrderIds: "Invalid or duplicate ID in Sub Cards order.",
  inboxMissing: "Inbox deck not found in the catalog.",
  inboxKind: "Inbox must take Tasks: choose a Task or Mixed deck.",
  emptyName: "Empty name or duplicate ID in the catalog.",
  duplicateMembership: "Duplicate card in membership.",
  yamlMissing: "Catalog YAML header is missing from tasks/deckmate.md.",
  duplicateCard: "Duplicate card addresses in project files.",
  linkedScanRoot: "Skipped linked scan root (symlink or junction).",
  deckMissing: "Deck not found.",
  spaceMissing: "Space not found.",
  selfDeckOrder: "A deck cannot be placed before itself.",
  deckInsertion: "The insertion deck must be in the target Space.",
  autoTagOrNull: "Deck auto-tag must be a nonempty string of up to 80 characters or null.",
  templateEffortOrNull: "Template Effort must be a nonnegative number or null.",
  titleLength: "The title must contain 1 to 120 characters.",
  deckKind: "Deck type must be asset, task, knowledge or mixed.",
  selectionSize: "Select 1 to 1000 cards.",
  invalidSelection: "Invalid or duplicate cards in the selection.",
  incompatibleSelection: "The selected deck does not accept all selected card types.",
  trackMissing: "Target Track not found.",
  sourceHashRequired: "The edit needs the card's current version. Refresh the catalog and try again.",
  cardMissingInFiles: "Card not found in project files.",
  incompatibleCard: "The selected deck does not accept this card type.",
  invalidCardTracks: "Invalid card Tracks.",
  manifestMissing: "The manifest has not been created yet.",
  yamlInvalid: "Invalid catalog YAML.",
  membershipMissing: "The catalog has no membership list.",
  membershipAlias: "Membership through a YAML alias cannot be edited in place.",
  parentPatch: "Changing the parent would modify other catalog properties.",
  parentHashes: "Changing the parent needs the card's and the Hero's current versions. Refresh the catalog and try again.",
  cardMissing: "Card not found.",
  journeyParent: "A Journey card cannot move to another Hero separately from its pipeline.",
  subCardOrderAlias: "Sub Cards order through a YAML alias cannot be edited in place.",
  heroOrderYaml: "Hero order must be an explicit YAML list.",
  subCardIdYaml: "Sub Card ID must be an explicit string without a YAML alias.",
  catalogPatch: "The edit would modify other catalog properties.",
  deckOrderAlias: "Deck order through a YAML alias cannot be edited in place.",
  deckOrderYaml: "Deck order must be an explicit YAML value.",
  heroSourceHash: "The edit needs the Hero's current version. Refresh the catalog and try again.",
  subCardUniqueIds: "Sub Cards order must contain unique Task IDs.",
  subCardOrderOwner: "Sub Cards order belongs to an active Hero or Doc without a parent.",
  invalidZone: "A zone needs an ID and a title of up to 120 characters.",
  zoneLimit: "A deck can contain up to 20 zones.",
  zoneNotEmpty: "Only empty zones can be deleted.",
  zoneDeck: "Zones order cards within one deck; move the card to change its deck.",
  zoneMissing: "Zone not found in this deck.",
  noZones: "This deck has no zones: cards use a single flat order.",
  cardInsertion: "The insertion card must be in the target zone.",
  owner: "Owner must be one line of up to 120 characters or null.",
  effort: "Card Effort must be a finite nonnegative number or null.",
  priority: "Card Priority must be high, medium, low or null.",
  cardSourceHash: "The edit needs the card's current version. Refresh the catalog and try again.",
  stateTaskOnly: "Only Task cards can change state; a Hero can only be marked done.",
  heroMarkStates: "A Hero can only be marked done or have that mark removed.",
  heroLegacyMark: "Only a Hero with its own card file can be marked done; a Hero from a mechanics document cannot.",
  heroHasTasks: (accepted: number, total: number) => `A Hero with Task Sub Cards is done when all of them are accepted: ${accepted} of ${total} so far.`,
  invalidState: `Invalid Task state. Use one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  returnReason: "The return reason must be one line of up to 500 characters.",
  returnFromReview: "A reason can only be recorded when returning a card from review.",
  stateStage: "state",
  ownerStage: "Owner on start",
  handStage: "top of Hand",
  acceptedDateStage: "acceptance date",
  repeatState: "Retrying the state change is safe: completed stages are skipped.",
  handDuplicates: "Hand order must not contain duplicate cards.",
  newCardId: "A new card ID must have the form card:<UUID>.",
  newCardKind: "A new card type must be task, hero or doc.",
  newCardTitle: "Card title must be one line of 1 to 1000 characters.",
  newCardText: "Card text must be a string of up to 200000 characters.",
  newCardTracks: "Invalid Tracks for the new card.",
  newCardEffort: "Card Effort must be a nonnegative number.",
  newCardPriority: "Card Priority must be high, medium or low.",
  newCardZone: "Invalid zone for the new card.",
  questionDoc: "An open question belongs to a rule Doc card.",
  humanDecision: "A human must make the decision: the member must have kind: human.",
  questionIndex: "Question index must be a nonnegative integer.",
  questionText: "The current question text is required.",
  decisionId: "The retry key must be a Task ID of the form card:<uuid>.",
  decisionDeck: "The decision Task needs a Task or Mixed deck.",
  questionChanged: "The question in “Open questions” has changed. Refresh the card.",
  decisionAlreadyLinked: "This decision Task is already linked to another question on the card.",
  decisionStage: "decision Task",
  memberHandStage: "member Hand",
  decisionMissing: "Decision Task not found after creation.",
  questionLinkStage: "link in the “Open questions” item",
  repeatRaiseDecision: "Retry raise-decision with the same taskCardId: completed stages will be skipped.",
  answerEmpty: "The answer must be a nonempty string.",
  decidedStage: "“Решено” entry",
  acceptDecisionStage: "decision Task acceptance",
  repeatRecordDecision: "Retrying record-decision is safe: the recorded answer will not be duplicated.",
  coverCleanup: "The catalog was not saved and the new cover could not be safely removed.",
  ambiguousMember: (value: string) => `Ambiguous member name: ${value}`,
  orderUnknownDeck: (deckId: string) => `Order refers to an unknown deck: ${deckId}`,
  invalidDeckOrder: (deckId: string) => `Invalid deck order: ${deckId}`,
  zoneListLimit: (deckId: string) => `Zones for deck ${deckId} must be a list of up to 20 entries.`,
  invalidDeckZone: (deckId: string) => `Invalid zone in deck ${deckId}.`,
  zonedDeckOrder: (deckId: string) => `Deck ${deckId} has zones: card order must be stored per zone.`,
  flatDeckOrder: (deckId: string) => `Flat order for deck ${deckId} cannot refer to zones.`,
  orderUnknownZone: (zoneId: string, deckId: string) => `Order refers to unknown zone “${zoneId}” in deck ${deckId}.`,
  invalidOrderCard: (deckId: string) => `Invalid or duplicate ID in the order for deck ${deckId}.`,
  duplicateOrderCard: (id: string, deckId: string) => `Card ${id} appears twice in the order for deck ${deckId}.`,
  invalidSpace: (space: { id: string }) => `Invalid Space: ${space.id}`,
  invalidDeck: (deck: { id: string }) => `Invalid deck: ${deck.id}`,
  pileFlag: (deckId: string) => `Deck ${deckId}: piled must be true or false.`,
  invalidTrack: (track: { id: string }) => `Invalid Track: ${track.id}`,
  invalidParent: (entry: { card: string }) => `Invalid Hero parent for ${entry.card}`,
  unknownMembershipDeck: (entry: { card: string }) => `Unknown deck for ${entry.card}`,
  invalidMembershipTracks: (entry: { card: string }) => `Invalid Tracks for ${entry.card}`,
  tagMissingCard: (tag: { name: string; cardId?: string | null }) => `Tag “${tag.name}” refers to a missing card: ${tag.cardId}`,
  missingMembership: (membership: { card: string }) => `Reference not found: ${membership.card}`,
  nativeMembership: (card: { id: string; path: string }) => `Native card ${card.id} ignores catalog membership: metadata is stored in ${card.path}.`,
  incompatibleDeckType: (card: { id: string; kind: string }, deck: { title: string }) => `Type ${card.kind} is incompatible with deck ${deck.title}: ${card.id}`,
  parentOverride: (card: { id: string }) => `Only Task and Doc support overriding the parent: ${card.id}`,
  missingParent: (card: { id: string; parentId: string | null }) => `Parent ${card.parentId} not found: ${card.id}`,
  invalidNativeDeck: (card: { id: string; deckId: string | null }) => `Invalid deck for native card ${card.id}: ${card.deckId}`,
  unknownTrack: (trackId: string, card: { id: string }) => `Unknown Track ${trackId}: ${card.id}`,
  missingDependency: (dependency: string, card: { id: string }) => `Dependency ${dependency} not found: ${card.id}`,
  ambiguousQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Question “${question.text}” refers to an ambiguous Task ${question.taskRef}: ${card.id}`,
  missingQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Question “${question.text}” refers to Task ${question.taskRef}, which is missing from the catalog: ${card.id}`,
  acceptedQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Task ${question.taskRef} is accepted, but question “${question.text}” remains in “Open questions”: ${card.id}`,
  missingSelectedCard: (selected: { cardId: string }) => `Card not found: ${selected.cardId}`,
  missingEntryCard: (entry: { cardId: string }) => `Card not found: ${entry.cardId}`,
  explicitYaml: (key: string) => `${key} must be an explicit YAML value.`,
  explicitYamlField: (key: string) => `${key} must be an explicit YAML value.`,
  decisionIdTaken: (existing: { id: string }) => `taskCardId is already used by card ${existing.id}.`,
  questionTaskMissing: (taskRef: string) => `Question Task ${taskRef} not found in the catalog.`,
  linkedJourneys: (deck: { title: string }, journeyBlockers: { title: string }[]) => `First delete the Journeys linked to deck “${deck.title}”: ${journeyBlockers.map(journey => `“${journey.title}”`).join(', ')}.`,
  partialChanges: (updated: string[], changes: readonly unknown[], pending: string[], error: unknown) => `Some changes were saved: ${updated.length} of ${changes.length}. Saved: ${updated.join(', ')}. Pending: ${pending.join(', ') || 'none'}. Refresh the catalog before retrying. ${error instanceof Error ? error.message : String(error)}`,
  guardianActor: (deck: { title: string } | undefined, guardianNames: string[], actorName: string) => `Only a Guardian can accept a card in deck “${deck!.title}”: ${guardianNames.join(', ')}. Request author ${actorName} is not a Guardian.`,
  guardianRequired: (deck: { title: string } | undefined, guardianNames: string[]) => `Only a Guardian can accept a card in deck “${deck!.title}”: ${guardianNames.join(', ')}. Set acceptedBy to the exact Guardian name or pass the card to a Guardian.`,
  partialAction: (done: string[], remaining: string[], repeatHint: string, error: unknown) => `Action partially completed: done — ${done.join(', ') || 'nothing'}; pending — ${remaining.join(', ')}. ${repeatHint} ${error instanceof Error ? error.message : String(error)}`,
}, {
  invalidMembers: "Некорректный список участников проекта.",
  invalidMember: "Некорректный участник проекта или повтор ID.",
  invalidDeckOrderMap: "Порядок колод должен быть объектом колода → зоны и порядок карточек.",
  deckParticipants: "Список участников колоды — до 200 ID реестра.",
  memberMissing: "Участник не найден в реестре проекта.",
  reportRollbackFailed: "Отчёт мог сохраниться, но запись состояния и безопасное восстановление исходной карточки не удались. Прочитайте карточку перед повтором.",
  autoTag: "Автотег колоды — непустая строка до 80 символов.",
  autoTagFlag: "Флаг автотега должен быть boolean.",
  deckYaml: "Колоду можно убрать в стопку или вернуть на полку точечно, только если она — явная YAML-карта без alias.",
  templateText: "Шаблон карточки колоды — текст до 50000 символов.",
  templateOwner: "Владелец шаблона — одна строка до 120 символов.",
  defaultOrder: "Порядок колоды по умолчанию — строка вида order=state&direction=asc до 200 символов.",
  templateEffort: "Оценка шаблона — число не меньше нуля.",
  templatePriority: "Приоритет шаблона — high, medium или low.",
  yamlObject: "Каталог должен содержать YAML-объект.",
  unsupportedSchema: "Неподдерживаемая схема каталога.",
  invalidFormatLanguage: "formatLanguage должен быть en или ru.",
  pinnedMilestone: "Некорректный ID закреплённого Milestone.",
  subCardOrder: "Порядок Sub Cards должен быть объектом Hero → список ID.",
  subCardOrderIds: "Некорректный или повторяющийся ID в порядке Sub Cards.",
  inboxMissing: "Колода Inbox не найдена в каталоге.",
  inboxKind: "Inbox должен принимать задачи: выберите колоду Task или Mixed.",
  emptyName: "Пустое имя или повтор ID в каталоге.",
  duplicateMembership: "Повтор карточки в membership.",
  yamlMissing: "В tasks/deckmate.md отсутствует YAML-шапка каталога.",
  duplicateCard: "В файлах повторяются адреса карточек.",
  linkedScanRoot: "Пропущен корневой каталог сканирования: символическая ссылка или junction.",
  deckMissing: "Колода не найдена.",
  spaceMissing: "Пространство не найдено.",
  selfDeckOrder: "Нельзя поставить колоду перед самой собой.",
  deckInsertion: "Колода для вставки должна находиться в целевом пространстве.",
  autoTagOrNull: "Автотег колоды — непустая строка до 80 символов или null.",
  templateEffortOrNull: "Оценка шаблона — число не меньше нуля или null.",
  titleLength: "Название должно содержать от 1 до 120 символов.",
  deckKind: "Тип колоды — asset, task, knowledge или mixed.",
  selectionSize: "Выберите от 1 до 1000 карточек.",
  invalidSelection: "Некорректные или повторяющиеся карточки в выборе.",
  incompatibleSelection: "Выбранная колода не принимает все типы карточек.",
  trackMissing: "Целевой трек не найден.",
  sourceHashRequired: "Для правки нужна актуальная версия карточки. Обновите каталог и повторите действие.",
  cardMissingInFiles: "Карточка не найдена в файлах.",
  incompatibleCard: "Этот тип карточки нельзя поместить в выбранную колоду.",
  invalidCardTracks: "Некорректные треки карточки.",
  manifestMissing: "Манифест ещё не создан.",
  yamlInvalid: "Некорректный YAML каталога.",
  membershipMissing: "В каталоге отсутствует список membership.",
  membershipAlias: "Membership через YAML alias не поддерживает точечную правку.",
  parentPatch: "Правка родителя изменила бы другие свойства каталога.",
  parentHashes: "Для смены родителя нужны актуальные версии карточки и выбранного Hero. Обновите каталог и повторите действие.",
  cardMissing: "Карточка не найдена.",
  journeyParent: "Карточку Journey нельзя переносить к другому Hero отдельно от конвейера.",
  subCardOrderAlias: "Порядок Sub Cards через YAML alias не поддерживает точечную правку.",
  heroOrderYaml: "Порядок Hero должен быть явным YAML-списком.",
  subCardIdYaml: "ID Sub Card должен быть явной строкой, без YAML alias.",
  catalogPatch: "Правка изменила бы другие свойства каталога.",
  deckOrderAlias: "Порядок колод через YAML alias не поддерживает точечную правку.",
  deckOrderYaml: "Порядок колоды должен быть явным YAML-значением.",
  heroSourceHash: "Нужна актуальная версия Hero. Обновите каталог и повторите действие.",
  subCardUniqueIds: "Порядок Sub Cards должен содержать уникальные ID задач.",
  subCardOrderOwner: "Порядок Sub Cards принадлежит активному Hero или Doc без родителя.",
  invalidZone: "Зона — идентификатор и название до 120 символов.",
  zoneLimit: "В колоде не больше 20 зон.",
  zoneNotEmpty: "Удалять можно только пустые зоны.",
  zoneDeck: "Зоны упорядочивают карточки одной колоды; для смены колоды перенесите карточку в колоду.",
  zoneMissing: "Зона не найдена в этой колоде.",
  noZones: "У колоды ещё нет зон: порядок задаётся одним плоским списком.",
  cardInsertion: "Карточка вставки должна находиться в целевой зоне.",
  owner: "Исполнитель — одна строка до 120 символов или null.",
  effort: "Цена карточки — конечное число не меньше нуля или null.",
  priority: "Приоритет карточки — high, medium, low или null.",
  cardSourceHash: "Нужна актуальная версия карточки. Обновите каталог и повторите действие.",
  stateTaskOnly: "Состояние можно менять только у Task; Hero можно только отметить выполненной.",
  heroMarkStates: "Hero можно только отметить выполненной или снять эту отметку.",
  heroLegacyMark: "Отметить выполненной можно только Hero с собственным файлом карточки, но не Hero из документа механики.",
  heroHasTasks: (accepted: number, total: number) => `Hero с Task Sub Cards становится выполненной, когда приняты все они: пока принято ${accepted} из ${total}.`,
  invalidState: `Недопустимое состояние Task. Допустимо: ${cardStates.flatMap(cardStateWords).join(', ')}.`,
  returnReason: "Причина возврата — одна строка до 500 символов.",
  returnFromReview: "Причина пишется только при возврате карточки с приёмки.",
  stateStage: "статус",
  ownerStage: "исполнитель по старту",
  handStage: "голова руки",
  acceptedDateStage: "дата приёмки",
  repeatState: "Повтор смены состояния безопасен: готовые этапы пропускаются.",
  handDuplicates: "Порядок руки — без повторов карточек.",
  newCardId: "Идентификатор новой карточки должен быть вида card:<UUID>.",
  newCardKind: "Тип новой карточки — task, hero или doc.",
  newCardTitle: "Название карточки — одна строка от 1 до 1000 символов.",
  newCardText: "Текст карточки — строка до 200000 символов.",
  newCardTracks: "Некорректные треки новой карточки.",
  newCardEffort: "Цена карточки — число не меньше нуля.",
  newCardPriority: "Приоритет карточки — high, medium или low.",
  newCardZone: "Некорректная зона новой карточки.",
  questionDoc: "Открытый вопрос живёт в Doc-карточке правила.",
  humanDecision: "Решение принимает человек: участник должен быть kind: human.",
  questionIndex: "Номер вопроса — целое неотрицательное число.",
  questionText: "Нужен текущий текст вопроса.",
  decisionId: "Ключ повтора — идентификатор задачи вида card:<uuid>.",
  decisionDeck: "Нужна колода Task/Mixed для задачи «Решение».",
  questionChanged: "Вопрос в «Открыто» изменился — обновите карточку.",
  decisionAlreadyLinked: "Эта задача «Решение» уже привязана к другому вопросу карточки.",
  decisionStage: "задача «Решение»",
  memberHandStage: "рука участника",
  decisionMissing: "Задача «Решение» не найдена после создания.",
  questionLinkStage: "ссылка в пункте «Открыто»",
  repeatRaiseDecision: "Повторите raise-decision с тем же taskCardId: готовые этапы пропустятся.",
  answerEmpty: "Ответ должен быть непустой строкой.",
  decidedStage: "запись «Решено»",
  acceptDecisionStage: "принятие задачи «Решение»",
  repeatRecordDecision: "Повтор record-decision безопасен: записанный ответ не дублируется.",
  coverCleanup: "Каталог не сохранён; безопасное удаление новой обложки не удалось.",
  ambiguousMember: (value: string) => `Неоднозначное имя участника: ${value}`,
  orderUnknownDeck: (deckId: string) => `Порядок ссылается на неизвестную колоду: ${deckId}`,
  invalidDeckOrder: (deckId: string) => `Некорректный порядок колоды: ${deckId}`,
  zoneListLimit: (deckId: string) => `Зоны колоды ${deckId} — список до 20 записей.`,
  invalidDeckZone: (deckId: string) => `Некорректная зона колоды ${deckId}.`,
  zonedDeckOrder: (deckId: string) => `У колоды ${deckId} есть зоны: порядок карточек хранится по зонам.`,
  flatDeckOrder: (deckId: string) => `Плоский порядок колоды ${deckId} не может ссылаться на зоны.`,
  orderUnknownZone: (zoneId: string, deckId: string) => `Порядок ссылается на неизвестную зону «${zoneId}» колоды ${deckId}.`,
  invalidOrderCard: (deckId: string) => `Некорректный или повторяющийся ID в порядке колоды ${deckId}.`,
  duplicateOrderCard: (id: string, deckId: string) => `Карточка ${id} встречается в порядке колоды ${deckId} дважды.`,
  invalidSpace: (space: { id: string }) => `Некорректное пространство: ${space.id}`,
  invalidDeck: (deck: { id: string }) => `Некорректная колода: ${deck.id}`,
  pileFlag: (deckId: string) => `Колода ${deckId}: piled — только true или false.`,
  invalidTrack: (track: { id: string }) => `Некорректный трек: ${track.id}`,
  invalidParent: (entry: { card: string }) => `Некорректный Hero-родитель у ${entry.card}`,
  unknownMembershipDeck: (entry: { card: string }) => `Неизвестная колода у ${entry.card}`,
  invalidMembershipTracks: (entry: { card: string }) => `Некорректные треки у ${entry.card}`,
  tagMissingCard: (tag: { name: string; cardId?: string | null }) => `Тег «${tag.name}» ссылается на отсутствующую карточку: ${tag.cardId}`,
  missingMembership: (membership: { card: string }) => `Ссылка не найдена: ${membership.card}`,
  nativeMembership: (card: { id: string; path: string }) => `Native-карточка ${card.id} игнорирует membership каталога: метаданные находятся в ${card.path}.`,
  incompatibleDeckType: (card: { id: string; kind: string }, deck: { title: string }) => `Тип ${card.kind} не подходит колоде ${deck.title}: ${card.id}`,
  parentOverride: (card: { id: string }) => `Только Task и Doc поддерживают переопределение родителя: ${card.id}`,
  missingParent: (card: { id: string; parentId: string | null }) => `Не найден родитель ${card.parentId}: ${card.id}`,
  invalidNativeDeck: (card: { id: string; deckId: string | null }) => `Некорректная колода native-карточки ${card.id}: ${card.deckId}`,
  unknownTrack: (trackId: string, card: { id: string }) => `Неизвестный трек ${trackId}: ${card.id}`,
  missingDependency: (dependency: string, card: { id: string }) => `Не найдена зависимость ${dependency}: ${card.id}`,
  ambiguousQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Вопрос «${question.text}» ссылается на неоднозначную задачу ${question.taskRef}: ${card.id}`,
  missingQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Вопрос «${question.text}» ссылается на задачу ${question.taskRef}, которой нет в каталоге: ${card.id}`,
  acceptedQuestionTask: (question: { text: string; taskRef: string | null }, card: { id: string }) => `Задача ${question.taskRef} принята, а вопрос «${question.text}» остался в «Открыто»: ${card.id}`,
  missingSelectedCard: (selected: { cardId: string }) => `Карточка не найдена: ${selected.cardId}`,
  missingEntryCard: (entry: { cardId: string }) => `Карточка не найдена: ${entry.cardId}`,
  explicitYaml: (key: string) => `${key} должен быть явным YAML-значением.`,
  explicitYamlField: (key: string) => `${key} должно быть явным YAML-значением.`,
  decisionIdTaken: (existing: { id: string }) => `taskCardId уже занят карточкой ${existing.id}.`,
  questionTaskMissing: (taskRef: string) => `Задача вопроса ${taskRef} не найдена в каталоге.`,
  linkedJourneys: (deck: { title: string }, journeyBlockers: { title: string }[]) => `Сначала удалите Journey, связанные с колодой «${deck.title}»: ${journeyBlockers.map(journey => `«${journey.title}»`).join(', ')}.`,
  partialChanges: (updated: string[], changes: readonly unknown[], pending: string[], error: unknown) => `Часть изменений сохранена: ${updated.length} из ${changes.length}. Сохранены: ${updated.join(', ')}. Остались: ${pending.join(', ') || 'нет'}. Обновите каталог перед повтором. ${error instanceof Error ? error.message : String(error)}`,
  guardianActor: (deck: { title: string } | undefined, guardianNames: string[], actorName: string) => `Принять карточку колоды «${deck!.title}» может только страж: ${guardianNames.join(', ')}. Автор запроса ${actorName} — не страж.`,
  guardianRequired: (deck: { title: string } | undefined, guardianNames: string[]) => `Принять карточку колоды «${deck!.title}» может только страж: ${guardianNames.join(', ')}. Назовите стража полем acceptedBy (точное имя) или передайте карточку стражу.`,
  partialAction: (done: string[], remaining: string[], repeatHint: string, error: unknown) => `Действие выполнено частично: сделано — ${done.join(', ') || 'ничего'}; не сделано — ${remaining.join(', ')}. ${repeatHint} ${error instanceof Error ? error.message : String(error)}`,
});


export const catalogPath = 'tasks/deckmate.md';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const deckKinds: DeckKind[] = ['asset', 'task', 'knowledge', 'mixed'];
const spaceKinds = ['gdd', 'tasks', 'knowledge', 'qa', 'custom'];
const deckStyles = ['symbol', 'artwork', 'minimal'];
const zoneIdPattern = /^[a-z0-9][a-z0-9-]{0,59}$/u;
interface Membership { card: string; deck?: string | null; tracks?: string[]; parentId?: string | null; owner?: string | null; effort?: number | null; priority?: CatalogCard['priority'] }
export interface CatalogManifest { schema: 1; formatLanguage?: 'en' | 'ru'; spaces: CatalogSpace[]; decks: CatalogDeck[]; tracks: CatalogTrack[]; membership: Membership[]; members?: CatalogMember[]; subCardOrder?: Record<string, string[]>; inboxDeckId?: string | null; pinnedMilestoneId?: string | null; deckOrder?: Record<string, CatalogDeckManualOrder | null> }

export const emptyManifest = (): CatalogManifest => ({ schema: 1, spaces: [], decks: [], tracks: [], membership: [] });

function validateMembers(members: CatalogMember[] | undefined): void {
  if (members === undefined) return;
  if (!Array.isArray(members) || members.length > 200) throw new Error(serverText(catalogText).invalidMembers);
  const identifiers = new Set<string>();
  const aliases = new Map<string, string>();
  for (const member of members) {
    if (!member || typeof member.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(member.id) || identifiers.has(member.id)
      || typeof member.label !== 'string' || !member.label.trim() || member.label.length > 120
      || !['agent', 'human'].includes(member.kind) || !Array.isArray(member.aliases) || member.aliases.length > 30
      || member.aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > 120)) throw new Error(serverText(catalogText).invalidMember);
    identifiers.add(member.id);
    for (const value of [member.label, ...member.aliases]) {
      const alias = value.trim().toLocaleLowerCase('ru-RU');
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== member.id) throw new Error(serverText(catalogText).ambiguousMember(value));
      aliases.set(alias, member.id);
    }
  }
}

/** Manual Order and Zones, 2026-11-04: zones and per-zone card lists live in the manifest next to subCardOrder. */
function validateDeckOrder(manifest: CatalogManifest): void {
  if (manifest.deckOrder === undefined) return;
  if (!manifest.deckOrder || typeof manifest.deckOrder !== 'object' || Array.isArray(manifest.deckOrder)) throw new Error(serverText(catalogText).invalidDeckOrderMap);
  for (const [deckId, order] of Object.entries(manifest.deckOrder)) {
    if (!manifest.decks.some(deck => deck.id === deckId)) throw new Error(serverText(catalogText).orderUnknownDeck(deckId));
    // null marks a removed manual order: the surgical patch rewrites one entry instead of deleting YAML nodes.
    if (order === null) continue;
    if (!order || typeof order !== 'object') throw new Error(serverText(catalogText).invalidDeckOrder(deckId));
    const zones = order.zones ?? [];
    if (!Array.isArray(zones) || zones.length > 20) throw new Error(serverText(catalogText).zoneListLimit(deckId));
    const zoneIds = new Set<string>();
    for (const zone of zones) {
      if (!zone || typeof zone.id !== 'string' || !zoneIdPattern.test(zone.id) || zoneIds.has(zone.id)
        || typeof zone.title !== 'string' || !zone.title.trim() || zone.title.length > 120) throw new Error(serverText(catalogText).invalidDeckZone(deckId));
      zoneIds.add(zone.id);
    }
    const hasZones = zones.length > 0;
    if (hasZones && order.flatOrder !== undefined) throw new Error(serverText(catalogText).zonedDeckOrder(deckId));
    if (!hasZones && order.zoneOrder !== undefined) throw new Error(serverText(catalogText).flatDeckOrder(deckId));
    const lists: Array<readonly [string, unknown]> = hasZones ? Object.entries(order.zoneOrder ?? {}) : [['', order.flatOrder ?? []]];
    const seen = new Set<string>();
    for (const [zoneId, cardIds] of lists) {
      if (hasZones && !zoneIds.has(zoneId)) throw new Error(serverText(catalogText).orderUnknownZone(zoneId, deckId));
      if (!Array.isArray(cardIds) || cardIds.length > 1000
        || cardIds.some(id => typeof id !== 'string' || !id || id.length > 1000 || /[\r\n\u0000]/u.test(id))
        || new Set(cardIds).size !== cardIds.length) throw new Error(serverText(catalogText).invalidOrderCard(deckId));
      for (const id of cardIds as string[]) {
        if (seen.has(id)) throw new Error(serverText(catalogText).duplicateOrderCard(id, deckId));
        seen.add(id);
      }
    }
  }
}

/** Deck watchers and guardians: up to 200 unique member IDs from the manifest registry (2026-11-04). */
export function normalizeDeckParticipants(value: unknown, members: CatalogMember[] | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 200
    || value.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(id))) throw new Error(serverText(catalogText).deckParticipants);
  const normalized = [...new Set(value)];
  if (normalized.some(id => !(members ?? []).some(member => member.id === id))) throw new Error(serverText(catalogText).memberMissing);
  return normalized;
}

function validateDeckParticipants(value: unknown, members: CatalogMember[] | undefined): void {
  if (value !== undefined) normalizeDeckParticipants(value, members);
}

/** Deck automation: a short auto-tag or null, plus a Template Card's default content and properties. */
// Default Order is the client's ordering URL form; the server keeps it opaque and only bounds its alphabet.
const defaultOrderPattern = /^[a-zA-Z0-9=&.,%]+$/u;

function validateDeckAutomation(deck: CatalogDeck): void {
  if (deck.autoTag !== undefined && deck.autoTag !== null
    && (typeof deck.autoTag !== 'string' || !deck.autoTag.trim() || deck.autoTag.length > 80 || deck.autoTag !== deck.autoTag.trim() || /[\u0000-\u001f]/u.test(deck.autoTag))) {
    throw new Error(serverText(catalogText).autoTag);
  }
  if (deck.autoTagKeep !== undefined && typeof deck.autoTagKeep !== 'boolean') throw new Error(serverText(catalogText).autoTagFlag);
  if (deck.templateMarkdown != null && (typeof deck.templateMarkdown !== 'string' || deck.templateMarkdown.length > 50000 || deck.templateMarkdown.includes('\u0000'))) {
    throw new Error(serverText(catalogText).templateText);
  }
  if (deck.templateOwner != null && (typeof deck.templateOwner !== 'string' || !deck.templateOwner.trim() || deck.templateOwner.length > 120 || /[\r\n\u0000]/u.test(deck.templateOwner))) {
    throw new Error(serverText(catalogText).templateOwner);
  }
  if (deck.defaultOrder !== undefined && (typeof deck.defaultOrder !== 'string' || !deck.defaultOrder || deck.defaultOrder.length > 200 || !defaultOrderPattern.test(deck.defaultOrder))) {
    throw new Error(serverText(catalogText).defaultOrder);
  }
  if (deck.templateEffort != null && (typeof deck.templateEffort !== 'number' || !Number.isFinite(deck.templateEffort) || deck.templateEffort < 0)) {
    throw new Error(serverText(catalogText).templateEffort);
  }
  if (deck.templatePriority != null && !['high', 'medium', 'low'].includes(deck.templatePriority)) throw new Error(serverText(catalogText).templatePriority);
}

function validateManifest(value: unknown): CatalogManifest {
  if (!value || typeof value !== 'object') throw new Error(serverText(catalogText).yamlObject);
  const manifest = value as CatalogManifest;
  if (manifest.schema !== 1 || !['spaces', 'decks', 'tracks', 'membership'].every(key => Array.isArray((value as Record<string, unknown>)[key]))) throw new Error(serverText(catalogText).unsupportedSchema);
  if (manifest.formatLanguage !== undefined && !['en', 'ru'].includes(manifest.formatLanguage)) throw new Error(serverText(catalogText).invalidFormatLanguage);
  validateMembers(manifest.members);
  if (manifest.pinnedMilestoneId != null && (typeof manifest.pinnedMilestoneId !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(manifest.pinnedMilestoneId))) throw new Error(serverText(catalogText).pinnedMilestone);
  if (manifest.subCardOrder !== undefined) {
    if (!manifest.subCardOrder || typeof manifest.subCardOrder !== 'object' || Array.isArray(manifest.subCardOrder)) throw new Error(serverText(catalogText).subCardOrder);
    for (const [heroId, cardIds] of Object.entries(manifest.subCardOrder)) {
      if (!heroId || heroId.length > 1000 || !Array.isArray(cardIds) || cardIds.length > 1000
        || cardIds.some(id => typeof id !== 'string' || !id || id.length > 1000 || /[\r\n\u0000]/u.test(id))
        || new Set(cardIds).size !== cardIds.length) throw new Error(serverText(catalogText).subCardOrderIds);
    }
  }
  // 2026-11-08: legacy Inbox kinds remain readable; new assignments are checked by setInboxDeck.
  if (manifest.inboxDeckId != null && (typeof manifest.inboxDeckId !== 'string' || !manifest.inboxDeckId
    || manifest.inboxDeckId.length > 80 || !manifest.decks.some(deck => deck.id === manifest.inboxDeckId))) throw new Error(serverText(catalogText).inboxMissing);
  validateDeckOrder(manifest);
  for (const collection of [manifest.spaces, manifest.decks, manifest.tracks]) {
    const identifiers = new Set<string>();
    for (const item of collection) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(item.id) || typeof item.title !== 'string' || !item.title.trim() || identifiers.has(item.id)) throw new Error(serverText(catalogText).emptyName);
      identifiers.add(item.id);
    }
  }
  for (const space of manifest.spaces) {
    if ((space.kind !== undefined && !spaceKinds.includes(space.kind))
      || (space.icon !== undefined && (typeof space.icon !== 'string' || space.icon.length > 32))) throw new Error(serverText(catalogText).invalidSpace(space));
  }
  for (const deck of manifest.decks) {
    if (!manifest.spaces.some(space => space.id === deck.spaceId) || !deckKinds.includes(deck.kind)
      || typeof deck.description !== 'string' || typeof deck.icon !== 'string' || deck.icon.length > 32 || !/^#[\da-f]{6}$/iu.test(deck.color)
      || (deck.style !== undefined && !deckStyles.includes(deck.style))
      || (deck.cover != null && !isCatalogCoverPath(deck.cover))
      || (deck.coverPosition !== undefined && (typeof deck.coverPosition !== 'number' || !Number.isFinite(deck.coverPosition) || deck.coverPosition < 0 || deck.coverPosition > 100))) throw new Error(serverText(catalogText).invalidDeck(deck));
    if (deck.piled !== undefined && typeof deck.piled !== 'boolean') throw new Error(serverText(catalogText).pileFlag(deck.id));
    validateDeckParticipants(deck.watcherIds, manifest.members);
    validateDeckParticipants(deck.guardianIds, manifest.members);
    validateDeckAutomation(deck);
  }
  for (const track of manifest.tracks) if (typeof track.description !== 'string') throw new Error(serverText(catalogText).invalidTrack(track));
  const cards = new Set<string>();
  for (const entry of manifest.membership) {
    if (!entry || typeof entry.card !== 'string' || cards.has(entry.card)) throw new Error(serverText(catalogText).duplicateMembership);
    if (entry.card.startsWith('card:')) { cards.add(entry.card); continue; }
    if (Object.hasOwn(entry, 'parentId') && entry.parentId !== null && (typeof entry.parentId !== 'string' || !entry.parentId)) throw new Error(serverText(catalogText).invalidParent(entry));
    if (Object.hasOwn(entry, 'owner')) validateOwner(entry.owner);
    if (Object.hasOwn(entry, 'effort')) validateEffort(entry.effort);
    if (Object.hasOwn(entry, 'priority')) validatePriority(entry.priority);
    if (entry.deck != null && !manifest.decks.some(deck => deck.id === entry.deck)) throw new Error(serverText(catalogText).unknownMembershipDeck(entry));
    if (entry.tracks !== undefined && (!Array.isArray(entry.tracks) || new Set(entry.tracks).size !== entry.tracks.length || entry.tracks.some(id => !manifest.tracks.some(track => track.id === id)))) throw new Error(serverText(catalogText).invalidMembershipTracks(entry));
    cards.add(entry.card);
  }
  return manifest;
}

export async function readManifest(root: string) {
  let bytes: Buffer;
  try { bytes = await readProjectMarkdown(root, catalogPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: null, manifest: emptyManifest(), yamlStart: 0, yamlEnd: 0 }; throw error; }
  return parseManifestBytes(bytes);
}

export function parseManifestBytes(bytes: Buffer) {
  const text = bytes.toString('utf8');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) throw new Error(serverText(catalogText).yamlMissing);
  const start = text.indexOf(match[1]);
  // 2026-11-04: parse manifest YAML once per content hash; catalog edits mutate it,
  // so each caller receives a separate copy of the parsed object.
  const manifest = structuredClone(parseCached('manifest', digest(bytes), bytes.length, () => validateManifest(parse(match[1]))));
  return { bytes, manifest, yamlStart: Buffer.byteLength(text.slice(0, start)), yamlEnd: Buffer.byteLength(text.slice(0, start + match[1].length)) };
}

/** The heading and intro paragraph written below the YAML of tasks/deckmate.md, in the project's format language (2026-11-05). */
const workspaceHeaderText: Record<FormatLanguage, { title: string; paragraph: string }> = {
  en: { title: '# Workspace', paragraph: 'Decks and tracks contain links to the source cards; texts and states remain in the project files.' },
  ru: { title: '# Рабочее пространство', paragraph: 'Колоды и треки содержат ссылки на исходные карточки; тексты и статусы остаются в файлах проекта.' },
};

/** The Markdown below the YAML block of a manifest being created, starting with its own line break. */
function workspaceHeader(language: FormatLanguage): string {
  const { title, paragraph } = workspaceHeaderText[language];
  return `\n${title}\n\n${paragraph}\n`;
}

/** The language of a manifest write: the parsed file's own language, or English when the file does not exist yet. */
function manifestLanguage(source: ManifestSource): FormatLanguage {
  return projectFormatLanguage(source.bytes ? source.manifest : undefined);
}

// App data files of the project: read by their own modules, never indexed as documents or Doc cards.
const appFiles = new Set([catalogPath, 'tasks/deckmate-card-options.md', 'tasks/deckmate-notifications.md', projectTagsPath, runsPath, milestonesPath, planningHistoryPath]);

async function markdownFiles(root: string): Promise<{ files: string[]; warnings: string[] }> {
  const files: string[] = [];
  const warnings: string[] = [];
  async function visit(relative: string) {
    const directory = path.join(root, relative);
    let entries;
    try {
      // 2026-11-07: scan roots have no parent Dirent to exclude symlinks and Windows junctions.
      // A root swapped for a link between lstat and readdir can only leak names into warnings: every read uses readProjectMarkdown's guard.
      const info = await lstat(directory);
      if (info.isSymbolicLink()) { warnings.push(`${relative}: ${serverText(catalogText).linkedScanRoot}`); return; }
      if (!info.isDirectory()) return;
      entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = `${relative}/${entry.name}`;
      if (entry.isDirectory()) { if (relative !== 'tasks') await visit(candidate); }
      else if (entry.isFile() && entry.name.endsWith('.md') && !appFiles.has(canonicalDataPath(candidate))) files.push(candidate);
    }
  }
  await Promise.all(['features', 'docs', 'tasks'].map(visit));
  return { files: files.sort(), warnings: warnings.sort() };
}

function contentTitle(markdown: string, relative: string): string {
  return /^(?:\uFEFF)?# (.+)$/mu.exec(markdown)?.[1] ?? path.posix.basename(relative, '.md');
}

function legacyOwnerNote(markdown: string, state: string): string | undefined {
  const lines = markdown.split(/\r?\n/u);
  for (const line of lines.slice(1, 12)) {
    if (line.startsWith('#')) break;
    const owner = /^\*\*Кто:\*\*\s*(.+)/u.exec(line);
    if (owner) return owner[1].trim();
  }
  if (state !== 'started') return undefined;
  const pattern = new RegExp(`\\((?:${cardStateWords('started').join('|')})(?![\\p{L}\\p{N}_])([^)]*)\\)`, 'u');
  return pattern.exec(lines[0])?.[1].replace(/^[ ,—]+|[ ,—]+$/gu, '') || undefined;
}

/** Parse a file's cards and its Doc card's open questions as a pure function of bytes (2026-11-04).
 * Cache by content hash; resolve owners from the manifest when assembling the view. */
interface ParsedFileCards { documentTitle: string; sourceHash: string; cards: CatalogCard[]; questions: ReturnType<typeof parseOpenQuestions> }

function parseFileCards(relative: string, bytes: Buffer, sourceHash: string): ParsedFileCards {
  const markdown = bytes.toString('utf8');
  const common = { path: relative, sourceHash, deckId: null, trackIds: [], parentId: null };
  const documentTitle = contentTitle(markdown, relative);
  const cards: CatalogCard[] = [{ ...common, id: `doc:${relative}`, kind: 'doc', version: null, title: documentTitle, state: null, owner: null, range: null, markdown }];
  if (!isMechanicPath(relative)) {
    return { documentTitle, sourceHash, cards, questions: parseOpenQuestions(markdown, serverLang()) };
  }
  const document = parseDocument(relative, bytes, serverLang());
  const heroIds = new Map<string, string>();
  // An epic includes the introduction after its H2, up to the first slice or next epic.
  for (const section of readHeroSections(document)) {
    heroIds.set(section.number, section.id);
    cards.push({ ...common, id: section.id, kind: 'hero', version: section.number, title: section.title, state: null, owner: null, range: null,
      markdown: bytes.subarray(section.introRange.start, section.introRange.end).toString('utf8') });
  }
  for (const slice of document.slices) {
    const sliceMarkdown = bytes.subarray(slice.range.start, slice.range.end).toString('utf8');
    const ownerNote = legacyOwnerNote(sliceMarkdown, slice.state);
    cards.push({ ...common, id: `task:${relative}#${slice.ver}`, kind: 'task', version: slice.ver,
      title: slice.title, state: slice.state, owner: null, ...(ownerNote ? { ownerNote } : {}), range: slice.range, iteration: slice.iter || null,
      parentId: heroIds.get(slice.ver.split('.')[0]) ?? null, markdown: sliceMarkdown });
  }
  return { documentTitle, sourceHash, cards, questions: openQuestionsOf(document.tree, serverLang()) };
}

/** A directory-tree fingerprint combines each file's content hash and path to cache parsed templates. */
async function directoryDigest(root: string, relativeDirectory: string): Promise<string> {
  let directory: string;
  try { directory = await containedFile(root, relativeDirectory); }
  catch (error) {
    // 2026-11-09: a missing folder and one linked outside its root hash as their code; nothing outside is read.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'OUTSIDE_PROJECT') return digest(code);
    throw error;
  }
  const files: string[] = [];
  async function visit(relative: string) {
    let entries;
    try { entries = await readdir(path.join(directory, relative), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    // 2026-11-06: the bundled templates span 85 folders; walking them one at a time cost about 20 ms per full read.
    // The listing is sorted below, so the parallel walk yields the same digest.
    await Promise.all(entries.map(async entry => {
      if (entry.isSymbolicLink()) return;
      const nested = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(nested);
      else if (entry.isFile()) files.push(nested);
    }));
  }
  await visit('');
  const hashes = await Promise.all(files.sort().map(async (file) => `${digest(await readFile(path.join(directory, file)))} ${file}`));
  return digest(hashes.join('\n'));
}

/** Best-effort filesystem dates support sorting by last update and creation date (2026-11-04). */
async function fileDates(root: string, relative: string): Promise<{ createdAt: string | null; updatedAt: string | null }> {
  try {
    const info = await stat(await containedFile(root, relative));
    return { createdAt: Number.isFinite(info.birthtimeMs) ? info.birthtime.toISOString() : null, updatedAt: Number.isFinite(info.mtimeMs) ? info.mtime.toISOString() : null };
  } catch { return { createdAt: null, updatedAt: null }; }
}

type FileDates = Awaited<ReturnType<typeof fileDates>>;
type FileResult = { relative: string; parsed: ParsedFileCards; dates: FileDates; warning?: never }
  | { relative: string; parsed?: never; warning: string };
interface CatalogInputs {
  rootDirectory: string;
  language: ReturnType<typeof serverLang>;
  source: Awaited<ReturnType<typeof readManifest>>;
  options: Awaited<ReturnType<typeof readCardOptions>>;
  tags: Awaited<ReturnType<typeof readProjectTags>>;
  legacyFiles: Map<string, FileResult>;
  scanWarnings: string[];
  native: Awaited<ReturnType<typeof readNativeCards>>;
  nativeDates: Map<string, FileDates>;
  journeyCatalog: Awaited<ReturnType<typeof readJourneys>>;
  templateCatalog: Awaited<ReturnType<typeof readJourneyTemplates>>;
}

// 2026-11-05: raw inputs belong to their immutable view, so incremental rebuilding never reapplies options to a projected card.
const catalogInputs = new WeakMap<CatalogView, CatalogInputs>();
// 2026-11-05: find the current inputs outside a write request without retaining old
// projects or revisions. Live views own the data; even weak lookup keys are bounded.
const latestInputs = new Map<string, WeakRef<CatalogInputs>>();
const maximumInputContexts = 16;
const nativeQuestions = new WeakMap<NativeCardFile, ReturnType<typeof parseOpenQuestions>>();

function inputContext(rootDirectory: string): string {
  return JSON.stringify([rootDirectory, serverLang()]);
}

function previousInputs(rootDirectory: string): CatalogInputs | undefined {
  const snapshot = currentCatalogSnapshot(rootDirectory);
  const inputs = snapshot ? catalogInputs.get(snapshot) : latestInputs.get(inputContext(rootDirectory))?.deref();
  return inputs?.rootDirectory === rootDirectory && inputs.language === serverLang() ? inputs : undefined;
}

async function readLegacyFile(root: string, relative: string, previous?: FileResult): Promise<FileResult | null> {
  try {
    const [bytes, dates] = await Promise.all([readProjectMarkdown(root, relative), fileDates(root, relative)]);
    const sourceHash = digest(bytes);
    const parsed = previous?.relative === relative && previous.parsed?.sourceHash === sourceHash
      ? previous.parsed
      : parseCached('project-file', JSON.stringify([relative, sourceHash]), bytes.length, () => parseFileCards(relative, bytes, sourceHash));
    return { relative, parsed, dates };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { relative, warning: `${relative}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function readTemplates(root: string): Promise<CatalogInputs['templateCatalog']> {
  const bundledDirectory = bundledJourneyTemplatesDirectory();
  const digests = await Promise.all(journeyTemplateDirectories(bundledDirectory, root)
    .map(location => directoryDigest(location.root, location.directory)));
  return parseCached('journey-templates', JSON.stringify([root, ...digests]), 65536,
    () => readJourneyTemplates(bundledDirectory, root));
}

async function nativeFileDates(root: string, native: CatalogInputs['native']): Promise<Map<string, FileDates>> {
  return new Map(await Promise.all(native.files.map(async file => [file.card.path, await fileDates(root, file.card.path)] as const)));
}

async function readFullProjectCatalog(root: string): Promise<CatalogView> {
  const source = await readManifest(root);
  const options = await readCardOptions(root);
  const tags = await readProjectTags(root);
  const rootDirectory = await realpath(root);
  const language = serverLang();
  const previous = previousInputs(rootDirectory);
  const { files, warnings: scanWarnings } = await markdownFiles(rootDirectory);
  const fileResults = await Promise.all(files.map(relative => readLegacyFile(rootDirectory, relative, previous?.legacyFiles.get(relative))));
  const legacyFiles = new Map(fileResults.filter((result): result is FileResult => result !== null).map(result => [result.relative, result]));
  const native = await readNativeCards(root, undefined, previous?.native);
  const nativeDates = await nativeFileDates(root, native);
  const journeyCatalog = await readJourneys(root);
  const templateCatalog = await readTemplates(root);
  return assembleCatalog({ rootDirectory, language, source, options, tags, legacyFiles, scanWarnings, native, nativeDates, journeyCatalog, templateCatalog });
}

export async function readProjectCatalog(root: string): Promise<CatalogView> {
  return readCatalogSnapshot(root, () => readFullProjectCatalog(root));
}

/** 2026-11-05: graph-wide publication guards must discover externally added cards too. */
export async function readFreshProjectCatalog(root: string): Promise<CatalogView> {
  return readFullProjectCatalog(root);
}

function isLegacyCatalogPath(relative: string): boolean {
  return !appFiles.has(canonicalDataPath(relative)) && /^(?:(?:features|docs)\/.+|tasks\/[^/]+)\.md$/u.test(relative);
}

/** 2026-11-05: changed paths are complete invalidations, including deletions; unrelated primary files are not read. */
export async function refreshProjectCatalog(root: string, previous: CatalogView, changedPaths: Iterable<string>): Promise<CatalogView> {
  const inputs = catalogInputs.get(previous);
  const rootDirectory = await realpath(root);
  if (!inputs || inputs.rootDirectory !== rootDirectory || inputs.language !== serverLang()) return readFullProjectCatalog(root);
  const changed = new Set([...changedPaths].map(canonicalDataPath));
  const legacyFiles = new Map(inputs.legacyFiles);
  const legacyChanges = await Promise.all([...changed].filter(isLegacyCatalogPath).map(async relative => ({
    relative, result: await readLegacyFile(rootDirectory, relative, inputs.legacyFiles.get(relative)),
  })));
  for (const { relative, result } of legacyChanges) {
    if (result === null) legacyFiles.delete(relative);
    else legacyFiles.set(relative, result);
  }
  const nativePaths = [...changed].filter(relative => /^cards\/[^/]+\.md$/iu.test(relative));
  let native = inputs.native;
  let nativeDates = inputs.nativeDates;
  if (nativePaths.length) {
    // 2026-11-05: an inaccessible cards directory has no usable baseline; recovery must discover its contents once.
    const incomplete = inputs.native.warnings.some(warning => warning.startsWith('cards:'));
    const refreshed = await readNativeCards(root, incomplete ? undefined : nativePaths, inputs.native);
    const directoryUnavailable = refreshed.warnings.some(warning => warning.startsWith('cards:'));
    const files = new Map((directoryUnavailable ? [] : inputs.native.files).map(file => [file.card.path, file]));
    nativeDates = directoryUnavailable ? new Map() : new Map(inputs.nativeDates);
    for (const relative of nativePaths) { files.delete(relative); nativeDates.delete(relative); }
    for (const file of refreshed.files) files.set(file.card.path, file);
    for (const [relative, dates] of await nativeFileDates(root, refreshed)) nativeDates.set(relative, dates);
    native = {
      rootDirectory, language: inputs.language,
      files: [...files.keys()].sort().map(relative => files.get(relative)!),
      warnings: [...inputs.native.warnings.filter(warning => !directoryUnavailable && !warning.startsWith('cards:')
        && !nativePaths.some(relative => warning.startsWith(relative + ':'))), ...refreshed.warnings].sort(),
    };
  }
  const [source, options, tags, journeyCatalog, templateCatalog] = await Promise.all([
    changed.has(catalogPath) ? readManifest(root) : inputs.source,
    changed.has(cardOptionsPath) ? readCardOptions(root) : inputs.options,
    changed.has(projectTagsPath) ? readProjectTags(root) : inputs.tags,
    [...changed].some(relative => relative.startsWith('tasks/journeys/')) ? readJourneys(root) : inputs.journeyCatalog,
    [...changed].some(relative => relative.startsWith('tasks/journey-templates/')) ? readTemplates(root) : inputs.templateCatalog,
  ]);
  return assembleCatalog({ rootDirectory, language: inputs.language, source, options, tags, legacyFiles, scanWarnings: inputs.scanWarnings, native, nativeDates, journeyCatalog, templateCatalog });
}

function assembleCatalog(inputs: CatalogInputs): CatalogView {
  const { rootDirectory, source, options, tags, native, nativeDates, journeyCatalog, templateCatalog } = inputs;
  const members = source.manifest.members ?? [];
  const documents: CatalogView['documents'] = [];
  const cards: CatalogCard[] = [];
  const warnings: string[] = [...inputs.scanWarnings];
  // Open questions are parsed with the file, using its content hash for native cards.
  // kindOverride can also turn a slice into a Doc; cache that parse by the slice's text hash.
  const questionsByCardId = new Map<string, ReturnType<typeof parseOpenQuestions>>();
  const ownerByNote = new Map<string, string | null>();
  const ownerOf = (note: string): string | null => {
    let owner = ownerByNote.get(note);
    if (owner === undefined) { owner = resolveMember(note, members); ownerByNote.set(note, owner); }
    return owner;
  };
  const fileResults = [...inputs.legacyFiles.keys()].sort().map(relative => inputs.legacyFiles.get(relative)!);
  for (const result of fileResults) {
    if (result.warning !== undefined) { warnings.push(result.warning); continue; }
    documents.push({ path: result.relative, title: result.parsed.documentTitle, hash: result.parsed.sourceHash });
    questionsByCardId.set(`doc:${result.relative}`, result.parsed.questions);
    for (const card of result.parsed.cards) {
      // Cached cards are immutable; copy them before applying view options and membership.
      const copy = { ...card, ...result.dates };
      if (copy.ownerNote !== undefined) copy.owner = ownerOf(copy.ownerNote);
      cards.push(copy);
    }
  }
  for (const file of native.files) {
    const owner = resolveMember(file.card.owner, members) ?? file.card.owner;
    cards.push({ ...file.card, ...nativeDates.get(file.card.path), owner, ...(file.card.owner && owner !== file.card.owner ? { ownerNote: file.card.owner } : {}) });
    documents.push({ path: file.document.path, title: file.document.title, hash: file.document.hash });
    if (file.card.kind === 'doc') {
      let questions = nativeQuestions.get(file);
      if (!questions) {
        questions = parseCached('doc-questions', JSON.stringify([file.card.path, file.card.sourceHash]), file.card.markdown.length,
          () => parseOpenQuestions(file.card.markdown, serverLang()));
        nativeQuestions.set(file, questions);
      }
      questionsByCardId.set(file.card.id, questions);
    }
  }
  warnings.push(...native.warnings);
  documents.push(...journeyCatalog.documents);
  warnings.push(...journeyCatalog.warnings);
  warnings.push(...templateCatalog.warnings);
  const inbox = source.manifest.decks.find(deck => deck.id === source.manifest.inboxDeckId);
  if (inbox && !deckCanBeInbox(inbox.kind)) warnings.push(serverText(catalogText).inboxKind);
  for (const card of cards) {
    Object.assign(card, options.options[card.id] ?? {});
    if (!card.id.startsWith('card:') && card.kindOverride) card.kind = card.kindOverride;
    // 2026-11-09: a native Hero keeps its manual done mark; Docs and legacy Heroes have no state.
    if (card.kind !== 'task' && !(card.kind === 'hero' && card.id.startsWith('card:') && card.state === 'done')) card.state = null;
    // 2026-11-03: a promoted legacy H3 retains its ID/body, but no longer inherits its structural Hero.
    if (card.kind === 'hero') { card.parentId = null; card.range = null; }
  }
  const byId = new Map(cards.map(card => [card.id, card]));
  if (byId.size !== cards.length) throw new Error(serverText(catalogText).duplicateCard);
  // A tag's card is configuration, not a structural link; a missing card must not break the index (2026-11-04).
  for (const tag of tags.tags) if (tag.cardId && !byId.has(tag.cardId)) warnings.push(serverText(catalogText).tagMissingCard(tag));
  for (const membership of source.manifest.membership) {
    const card = byId.get(membership.card);
    if (!card) { warnings.push(serverText(catalogText).missingMembership(membership)); continue; }
    if (card.id.startsWith('card:')) { warnings.push(serverText(catalogText).nativeMembership(card)); continue; }
    const deck = source.manifest.decks.find(candidate => candidate.id === membership.deck);
    if (deck && !deckAcceptsCard(deck.kind, card.kind)) warnings.push(serverText(catalogText).incompatibleDeckType(card, deck));
    else card.deckId = deck?.id ?? null;
    card.trackIds = membership.tracks ?? [];
    if (Object.hasOwn(membership, 'owner')) card.owner = membership.owner === null ? null : resolveMember(membership.owner, members) ?? membership.owner!;
    if (Object.hasOwn(membership, 'effort')) card.effort = membership.effort!;
    if (Object.hasOwn(membership, 'priority')) card.priority = membership.priority!;
    if (Object.hasOwn(membership, 'parentId')) {
      if (!['task', 'doc'].includes(card.kind)) { if (membership.parentId !== null) warnings.push(serverText(catalogText).parentOverride(card)); }
      else {
        // Missing means structural parent; null is an explicit detach, never a fallback.
        card.parentId = membership.parentId!;
        if (card.parentId && !['hero', 'doc'].includes(byId.get(card.parentId)?.kind ?? '')) warnings.push(serverText(catalogText).missingParent(card));
      }
    }
  }
  for (const { card } of native.files) {
    const deck = source.manifest.decks.find(candidate => candidate.id === card.deckId);
    if (card.deckId && (!deck || !deckAcceptsCard(deck.kind, card.kind))) warnings.push(serverText(catalogText).invalidNativeDeck(card));
    for (const trackId of card.trackIds) if (!source.manifest.tracks.some(track => track.id === trackId)) warnings.push(serverText(catalogText).unknownTrack(trackId, card));
    if (card.parentId && !['hero', 'doc'].includes(byId.get(card.parentId)?.kind ?? '')) warnings.push(serverText(catalogText).missingParent(card));
    for (const dependency of card.dependsOn ?? []) if (!byId.has(dependency)) warnings.push(serverText(catalogText).missingDependency(dependency, card));
  }
  // 2026-11-09: a Hero's manual done mark counts only while it has no counted Task Sub Cards; once it has them, they decide,
  // so the Hand pile, dependencies and the agent queue never see a mark the tile does not show.
  const heroesWithTasks = new Set(heroCountedTasks(cards.filter(card => !card.archived && !card.deleted)).map(card => card.parentId));
  for (const card of cards) if (card.kind === 'hero' && heroesWithTasks.has(card.id)) card.state = null;
  // 2026-11-04: the Doc's open-question entry is authoritative; question counts and warnings are derived.
  for (const card of cards) {
    if (card.kind !== 'doc') continue;
    const parsed = questionsByCardId.get(card.id)
      ?? parseCached('doc-questions', JSON.stringify(['text', digest(card.markdown)]), card.markdown.length, () => parseOpenQuestions(card.markdown, serverLang()));
    if (parsed.questions === null) continue;
    const questionWarnings = [...parsed.warnings];
    for (const question of parsed.questions) {
      if (!question.taskRef) continue;
      let task: CatalogCard | null = null;
      let ambiguous = false;
      try { task = resolveReference(cards, 'c', question.taskRef, serverLang()); }
      catch { ambiguous = true; }
      if (ambiguous) questionWarnings.push(serverText(catalogText).ambiguousQuestionTask(question, card));
      else if (!task) questionWarnings.push(serverText(catalogText).missingQuestionTask(question, card));
      else if (task.state === 'done') questionWarnings.push(serverText(catalogText).acceptedQuestionTask(question, card));
    }
    card.openQuestions = parsed.questions.map(question => ({ text: question.text, taskRef: question.taskRef }));
    card.openQuestionWarnings = questionWarnings;
  }
  const view: CatalogView = { rootIdentity: digest(rootDirectory), formatLanguage: manifestLanguage(source), documents, cards, spaces: source.manifest.spaces, decks: source.manifest.decks,
    tracks: source.manifest.tracks, members, journeys: journeyCatalog.journeys, journeyTemplates: [...templateCatalog.templates],
    subCardOrder: source.manifest.subCardOrder ?? {}, warnings, manifestHash: source.bytes ? digest(source.bytes) : '', optionsHash: options.hash, projectTags: tags.tags, tagsHash: tags.hash, configured: Boolean(source.bytes), indexedAt: '',
    inboxDeckId: source.manifest.inboxDeckId ?? null, pinnedMilestoneId: source.manifest.pinnedMilestoneId ?? null, deckOrder: normalizeDeckOrder(source.manifest.deckOrder) };
  catalogInputs.set(view, inputs);
  const context = inputContext(rootDirectory);
  latestInputs.delete(context);
  latestInputs.set(context, new WeakRef(inputs));
  while (latestInputs.size > maximumInputContexts) latestInputs.delete(latestInputs.keys().next().value!);
  return view;
}

/** null entries are removed manual orders; the client never needs to see them (2026-11-04). */
function normalizeDeckOrder(deckOrder: CatalogManifest['deckOrder']): Record<string, CatalogDeckManualOrder> {
  const result: Record<string, CatalogDeckManualOrder> = {};
  for (const [deckId, order] of Object.entries(deckOrder ?? {})) {
    if (!order) continue;
    const zones = (order.zones ?? []).length > 0;
    if (!zones && (order.flatOrder ?? []).length === 0 && Object.keys(order.zoneOrder ?? {}).length === 0) continue;
    result[deckId] = order;
  }
  return result;
}

function requiredDeck(manifest: CatalogManifest, deckId: string): CatalogDeck {
  const deck = manifest.decks.find(candidate => candidate.id === deckId);
  if (!deck) throw new Error(serverText(catalogText).deckMissing);
  return deck;
}

function requiredSpace(manifest: CatalogManifest, spaceId: string): CatalogSpace {
  const space = manifest.spaces.find(candidate => candidate.id === spaceId);
  if (!space) throw new Error(serverText(catalogText).spaceMissing);
  return space;
}

function moveDeck(manifest: CatalogManifest, edit: Extract<CatalogEdit, { action: 'move-deck' }>): void {
  const deck = requiredDeck(manifest, edit.deckId);
  requiredSpace(manifest, edit.spaceId);
  if (edit.beforeDeckId === edit.deckId) throw new Error(serverText(catalogText).selfDeckOrder);
  if (edit.beforeDeckId !== null && requiredDeck(manifest, edit.beforeDeckId).spaceId !== edit.spaceId) {
    throw new Error(serverText(catalogText).deckInsertion);
  }
  manifest.decks.splice(manifest.decks.indexOf(deck), 1);
  deck.spaceId = edit.spaceId;
  const lastTarget = manifest.decks.findLastIndex(candidate => candidate.spaceId === edit.spaceId);
  let position = lastTarget < 0 ? manifest.decks.length : lastTarget + 1;
  if (edit.beforeDeckId !== null) position = manifest.decks.findIndex(candidate => candidate.id === edit.beforeDeckId);
  manifest.decks.splice(position, 0, deck);
}

type DeckParticipantsEdit = Extract<CatalogEdit, { action: 'set-deck-watchers' | 'set-deck-guardians' }>;
type DeckAutomationEdit = Extract<CatalogEdit, { action: 'set-deck-automation' }>;
type DeleteDeckEdit = Extract<CatalogEdit, { action: 'delete-deck' }>;

/**
 * Deleting a deck sets its cards to deck: null and preserves their files.
 * Rewrite native cards before removing the deck so retries after any failed step do not lose data.
 */
async function deleteDeck(root: string, source: ManifestSource, edit: DeleteDeckEdit): Promise<string[]> {
  const deck = requiredDeck(source.manifest, edit.deckId);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  // Remove this deck's Journey and incoming steps from other Journeys before deleting the deck.
  const journeyBlockers = (catalog.journeys ?? [])
    .filter(journey => journey.deckId === edit.deckId || journey.steps.some(step => step.deckId === edit.deckId));
  if (journeyBlockers.length) {
    throw new Error(serverText(catalogText).linkedJourneys(deck, journeyBlockers));
  }
  const nativeCards = catalog.cards.filter(card => card.deckId === edit.deckId && card.id.startsWith('card:'));
  for (const card of nativeCards) {
    await editNativeCard(root, card.id, card.sourceHash, { deckId: null }, async () => { await verifyManifestHash(root, edit.manifestHash); });
  }
  source.manifest.decks.splice(source.manifest.decks.indexOf(deck), 1);
  if (source.manifest.inboxDeckId === edit.deckId) source.manifest.inboxDeckId = null;
  if (source.manifest.deckOrder) delete source.manifest.deckOrder[edit.deckId];
  for (const entry of source.manifest.membership) if (entry.deck === edit.deckId) entry.deck = null;
  validateManifest(source.manifest);
  await writeManifest(root, source, edit.manifestHash);
  return [catalogPath, ...nativeCards.map(card => card.path)];
}
/** Deck automation stores an auto-tag and Template Card; no-ops do not write the file. */
async function setDeckAutomation(root: string, source: ManifestSource, edit: DeckAutomationEdit): Promise<string[]> {
  const deck = requiredDeck(source.manifest, edit.deckId);
  const members = source.manifest.members ?? [];
  const autoTag = edit.autoTag === null ? null : edit.autoTag.trim();
  if (autoTag === '') throw new Error(serverText(catalogText).autoTagOrNull);
  const templateMarkdown = edit.templateMarkdown !== null && edit.templateMarkdown.trim() !== '' ? edit.templateMarkdown : null;
  const templateOwner = edit.templateOwner !== null && edit.templateOwner.trim() !== ''
    ? resolveMember(edit.templateOwner.trim(), members) ?? edit.templateOwner.trim() : null;
  if (edit.templateEffort !== null && (typeof edit.templateEffort !== 'number' || !Number.isFinite(edit.templateEffort) || edit.templateEffort < 0)) {
    throw new Error(serverText(catalogText).templateEffortOrNull);
  }
  if (edit.templatePriority !== null && !['high', 'medium', 'low'].includes(edit.templatePriority)) throw new Error(serverText(catalogText).templatePriority);
  // undefined in next means the field is absent; compare with current state to avoid no-op writes.
  const next = {
    autoTag: autoTag ?? undefined,
    autoTagKeep: autoTag !== null && edit.autoTagKeep ? true : undefined,
    templateMarkdown: templateMarkdown ?? undefined,
    templateOwner: templateOwner ?? undefined,
    templateEffort: edit.templateEffort ?? undefined,
    templatePriority: edit.templatePriority ?? undefined,
  };
  const current = {
    autoTag: deck.autoTag ?? undefined,
    autoTagKeep: deck.autoTagKeep ? true : undefined,
    templateMarkdown: deck.templateMarkdown ?? undefined,
    templateOwner: deck.templateOwner ?? undefined,
    templateEffort: deck.templateEffort ?? undefined,
    templatePriority: deck.templatePriority ?? undefined,
  };
  if (isDeepStrictEqual(current, next)) return [];
  Object.assign(deck, next);
  validateManifest(source.manifest);
  await writeManifest(root, source, edit.manifestHash);
  return [catalogPath];
}

/** Default deck order applies when viewers have no override; null/empty clears it, and no-ops do not write (2026-11-04). */
async function setDeckDefaultOrder(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-deck-default-order' }>): Promise<string[]> {
  const deck = requiredDeck(source.manifest, edit.deckId);
  const next = edit.defaultOrder || undefined;
  if (deck.defaultOrder === next) return [];
  if (next) deck.defaultOrder = next;
  else delete deck.defaultOrder;
  validateManifest(source.manifest);
  await writeManifest(root, source, edit.manifestHash);
  return [catalogPath];
}

/** Store deck subscriptions and guardians in the deck manifest; no-ops do not write (2026-11-04). */
async function setDeckParticipants(root: string, source: ManifestSource, edit: DeckParticipantsEdit): Promise<string[]> {
  const field = edit.action === 'set-deck-watchers' ? 'watcherIds' : 'guardianIds';
  const deck = requiredDeck(source.manifest, edit.deckId);
  const ids = normalizeDeckParticipants(edit.action === 'set-deck-watchers' ? edit.watcherIds : edit.guardianIds, source.manifest.members);
  if (isDeepStrictEqual(deck[field] ?? [], ids)) return [];
  if (ids.length) deck[field] = ids;
  else delete deck[field];
  validateManifest(source.manifest);
  await writeManifest(root, source, edit.manifestHash);
  return [catalogPath];
}

/**
 * 2026-11-06: the pile is a hand-set place on the Decks home screen, not a deck property worth reserializing the manifest for:
 * only this deck's `piled` key changes, the deck list order, deckOrder and cards stay as they are, and a repeat does not write.
 */
async function setDeckPile(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-deck-pile' }>): Promise<string[]> {
  if (typeof edit.piled !== 'boolean') throw new Error(serverText(catalogText).pileFlag(edit.deckId));
  const deck = requiredDeck(source.manifest, edit.deckId);
  if (Boolean(deck.piled) === edit.piled) return [];
  await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patchDeckPile(source, deck.id, edit.piled),
    () => verifyManifestHash(root, edit.manifestHash));
  return [catalogPath];
}

async function applyCatalogEdit(root: string, manifest: CatalogManifest, edit: CatalogEdit): Promise<StoredCatalogCover | null> {
  if ('title' in edit && (typeof edit.title !== 'string' || !edit.title.trim() || edit.title.length > 120)) throw new Error(serverText(catalogText).titleLength);
  if (edit.action === 'configure-members') manifest.members = edit.members;
  if (edit.action === 'create-space') manifest.spaces.push({ id: randomUUID(), title: edit.title.trim(), kind: edit.kind ?? 'custom', icon: edit.icon ?? '' });
  if (edit.action === 'update-space') Object.assign(requiredSpace(manifest, edit.spaceId), { title: edit.title.trim(), kind: edit.kind, icon: edit.icon });
  if (edit.action === 'create-deck') {
    // A client-chosen UUID lets New Deck upload its cover next; the same UUID again is the same deck, never a twin.
    const requestedId = typeof edit.deckId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(edit.deckId) ? edit.deckId : null;
    if (requestedId && manifest.decks.some(existing => existing.id === requestedId)) return null;
    const deck: CatalogDeck = { id: requestedId ?? randomUUID(), title: edit.title.trim(), spaceId: edit.spaceId, kind: edit.kind,
      icon: edit.icon, color: edit.color, description: edit.description, style: edit.style ?? 'symbol' };
    if (edit.coverPosition !== undefined) deck.coverPosition = edit.coverPosition;
    manifest.decks.push(deck);
    // Quick Capture creates a deck named Inbox; the first such deck also becomes the project's default receiver.
    if (!manifest.inboxDeckId && deckCanBeInbox(deck.kind) && deck.title.toLocaleLowerCase('ru-RU') === 'inbox') manifest.inboxDeckId = deck.id;
  }
  if (edit.action === 'update-deck') {
    const deck = requiredDeck(manifest, edit.deckId);
    if (edit.cover !== null) await assertCatalogCoverFile(root, edit.cover);
    Object.assign(deck, { title: edit.title.trim(), icon: edit.icon, color: edit.color, description: edit.description,
      style: edit.style, cover: edit.cover, coverPosition: edit.coverPosition });
  }
  if (edit.action === 'move-deck') moveDeck(manifest, edit);
  if (edit.action === 'upload-cover') {
    const deck = requiredDeck(manifest, edit.deckId);
    const asset = await storeCatalogCover(root, edit.dataUrl);
    deck.cover = asset.relativePath;
    deck.coverPosition ??= 50;
    deck.style = 'artwork';
    return asset;
  }
  if (edit.action === 'create-track') manifest.tracks.push({ id: randomUUID(), title: edit.title.trim(), description: edit.description });
  return null;
}

/** 2026-11-03: Inactive cards and Journey templates still constrain a deck's type. */
async function setDeckKind(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-deck-kind' }>): Promise<string[]> {
  if (!deckKinds.includes(edit.kind)) throw new Error(serverText(catalogText).deckKind);
  const deck = requiredDeck(source.manifest, edit.deckId);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const issue = deckTypeChangeIssue(edit.deckId, edit.kind, catalog.cards, catalog.journeys ?? [], serverLang());
  if (issue) throw new Error(issue);
  if (deck.kind === edit.kind) return [];
  const dependencies = (view: CatalogView) => JSON.stringify({
    optionsHash: view.optionsHash,
    cards: view.cards.map(card => [card.id, card.sourceHash, card.deckId, card.kind]),
    journeys: (view.journeys ?? []).map(journey => [journey.id, journey.fileHash]),
  });
  const baseline = dependencies(catalog);
  deck.kind = edit.kind;
  if (source.manifest.inboxDeckId === deck.id && !deckCanBeInbox(deck.kind)) source.manifest.inboxDeckId = null;
  validateManifest(source.manifest);
  await writeManifest(root, source, edit.manifestHash, async () => {
    const current = await readFreshProjectCatalog(root);
    if (current.manifestHash !== edit.manifestHash || dependencies(current) !== baseline) throw new Error('CATALOG_CONFLICT');
    const currentIssue = deckTypeChangeIssue(edit.deckId, edit.kind, current.cards, current.journeys ?? [], serverLang());
    if (currentIssue) throw new Error(currentIssue);
  });
  return [catalogPath];
}

type ManifestSource = Awaited<ReturnType<typeof readManifest>>;

async function writeManifest(root: string, source: ManifestSource, manifestHash: string, beforeCommit?: () => Promise<void>): Promise<string> {
  let manifestSaved = false;
  if (!source.bytes) source.manifest.formatLanguage ??= 'en';
  const candidate = source.bytes ? patchManifest(source)
    : Buffer.from(`---\n${stringify(source.manifest, { lineWidth: 0 }).trimEnd()}\n---\n${workspaceHeader(manifestLanguage(source))}`);
  let directory: string;
  try { directory = await containedFile(root, 'tasks'); }
  catch (error) {
    // 2026-11-05: the first write to an empty project creates its managed-data directory.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await ensureManagedDirectory(root, 'tasks');
    directory = await containedFile(root, 'tasks');
  }
  const filename = path.join(directory, path.posix.basename(await resolveDataPath(root, catalogPath)));
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await writeFile(temporary, candidate, { flag: 'wx' });
    temporaryCreated = true;
    for (let attempt = 0; ; attempt += 1) {
      await beforeCommit?.();
      let current: Buffer | null = null;
      try { current = await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if ((current ? digest(current) : '') !== manifestHash) throw new Error('CATALOG_CONFLICT');
      try {
        await rename(temporary, filename);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt >= 4) throw error;
        // 2026-11-05: Windows readers may briefly hold the manifest; recheck hashes after every bounded wait.
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    manifestSaved = true;
    catalogFileChanged(root, catalogPath);
  } finally {
    if (temporaryCreated && !manifestSaved) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  return digest(candidate);
}

type BulkEdit = Extract<CatalogEdit, { action: 'bulk-assign-deck' | 'bulk-add-track' }>;
interface MembershipChange { card: CatalogCard; changes: { deckId?: string | null; trackIds?: string[] } }

export async function verifyCardSources(root: string, cards: CatalogCard[]): Promise<void> {
  const files = new Map(cards.map(card => [card.path, card.sourceHash]));
  for (const [relative, sourceHash] of files) {
    if (digest(await readFile(await containedFile(root, relative))) !== sourceHash) throw new Error('CARD_CONFLICT');
  }
}

async function bulkMembership(root: string, source: ManifestSource, edit: BulkEdit): Promise<string[]> {
  if (!Array.isArray(edit.cards) || edit.cards.length < 1 || edit.cards.length > 1000) throw new Error(serverText(catalogText).selectionSize);
  const selectedIds = new Set<string>();
  for (const selected of edit.cards) {
    if (!selected || typeof selected.cardId !== 'string' || !selected.cardId.trim() || selected.cardId.length > 1000
      || selectedIds.has(selected.cardId) || typeof selected.sourceHash !== 'string' || !/^[0-9a-f]{64}$/u.test(selected.sourceHash)) throw new Error(serverText(catalogText).invalidSelection);
    selectedIds.add(selected.cardId);
  }
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const cards = edit.cards.map(selected => {
    const card = byId.get(selected.cardId);
    if (!card) throw new Error(serverText(catalogText).missingSelectedCard(selected));
    if (card.sourceHash !== selected.sourceHash) throw new Error('CARD_CONFLICT');
    return card;
  });
  if (edit.action === 'bulk-assign-deck') {
    const deck = catalog.decks.find(candidate => candidate.id === edit.deckId);
    if (edit.deckId !== null && (!deck || cards.some(card => !deckAcceptsCard(deck.kind, card.kind)))) throw new Error(serverText(catalogText).incompatibleSelection);
  } else if (!catalog.tracks.some(track => track.id === edit.trackId)) throw new Error(serverText(catalogText).trackMissing);
  const changes: MembershipChange[] = [];
  for (const card of cards) {
    if (edit.action === 'bulk-assign-deck') {
      if (card.deckId !== edit.deckId) changes.push({ card, changes: { deckId: edit.deckId } });
    } else if (!card.trackIds.includes(edit.trackId)) changes.push({ card, changes: { trackIds: [...card.trackIds, edit.trackId] } });
  }
  return applyMembershipChanges(root, source, edit, catalog, cards, changes, edit.action === 'bulk-assign-deck' ? edit.deckId : undefined);
}

/** 2026-11-04: single and bulk transfers share the order and automation write path. */
async function applyMembershipChanges(root: string, source: ManifestSource, edit: { manifestHash: string },
  catalog: CatalogView, cards: CatalogCard[], changes: MembershipChange[], targetDeckId?: string | null): Promise<string[]> {
  const orderChanges = new Map<string, CatalogDeckManualOrder | null>();
  if (targetDeckId !== undefined) {
    const deckChanges = changes.filter(change => change.card.deckId !== targetDeckId);
    const movingIds = deckChanges.map(change => change.card.id);
    const moving = new Set(movingIds);
    for (const sourceDeckId of new Set(deckChanges.map(change => change.card.deckId).filter((id): id is string => Boolean(id)))) {
      const current = catalog.deckOrder?.[sourceDeckId];
      if (!current) continue;
      const complete = completeDeckManualOrder(catalog.cards.filter(card => card.deckId === sourceDeckId), current);
      const zones = complete.zones ?? [];
      const next: CatalogDeckManualOrder = zones.length > 0
        ? { zones, zoneOrder: Object.fromEntries(Object.entries(complete.zoneOrder ?? {}).map(([zoneId, ids]) => [zoneId, ids.filter(id => !moving.has(id))])) }
        : { flatOrder: (complete.flatOrder ?? []).filter(id => !moving.has(id)) };
      orderChanges.set(sourceDeckId, zones.length === 0 && (next.flatOrder ?? []).length === 0 ? null : next);
    }
    const targetOrder = targetDeckId ? catalog.deckOrder?.[targetDeckId] ?? { flatOrder: [] } : undefined;
    if (targetDeckId && targetOrder && movingIds.length > 0) {
      const targetCards = catalog.cards.filter(card => card.deckId === targetDeckId && !moving.has(card.id));
      orderChanges.set(targetDeckId, appendCardsToDeckOrder(targetCards, targetOrder, movingIds, undefined, serverLang()));
    }
    if (orderChanges.size > 0) source.manifest.deckOrder = { ...source.manifest.deckOrder, ...Object.fromEntries(orderChanges) };
  }
  const legacy = changes.filter(change => !change.card.id.startsWith('card:'));
  const native = changes.filter(change => change.card.id.startsWith('card:'));
  for (const change of legacy) {
    const entry = source.manifest.membership.find(candidate => candidate.card === change.card.id) ?? { card: change.card.id };
    if (!source.manifest.membership.includes(entry)) source.manifest.membership.push(entry);
    if (Object.hasOwn(change.changes, 'deckId')) entry.deck = change.changes.deckId;
    if (change.changes.trackIds) entry.tracks = change.changes.trackIds;
  }
  validateManifest(source.manifest);
  await verifyCardSources(root, cards);
  let manifestHash = edit.manifestHash;
  const updated: string[] = [];
  let activeNative: string | null = null;
  let manifestSaved = false;
  const changedPaths: string[] = [];
  try {
    if (legacy.length > 0 || orderChanges.size > 0) {
      if (source.bytes) {
        let candidate = parseManifestBytes(source.bytes);
        for (const change of legacy) {
          if (Object.hasOwn(change.changes, 'deckId')) candidate = parseManifestBytes(patchLegacyScalar(candidate, change.card.id, 'deck', change.changes.deckId!));
          if (change.changes.trackIds) candidate = parseManifestBytes(patchLegacyScalar(candidate, change.card.id, 'tracks', change.changes.trackIds));
        }
        // Card membership and both decks' manual positions share one manifest revision; Track and Sub Cards stay untouched.
        for (const [deckId, order] of orderChanges) candidate = parseManifestBytes(patchDeckOrder(candidate, deckId, order));
        await replaceProjectMarkdown(root, catalogPath, manifestHash, candidate.bytes!, async () => {
          await verifyCardSources(root, cards);
          await verifyManifestHash(root, manifestHash);
        });
        manifestHash = digest(candidate.bytes!);
      } else manifestHash = await writeManifest(root, source, manifestHash, () => verifyCardSources(root, cards));
      manifestSaved = true;
      changedPaths.push(catalogPath);
      updated.push(...legacy.map(change => change.card.id));
    }
    for (const change of native) {
      let current: Buffer | null = null;
      try { current = await readProjectMarkdown(root, catalogPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if ((current ? digest(current) : '') !== manifestHash) throw new Error('CATALOG_CONFLICT');
      activeNative = change.card.id;
      await editNativeCard(root, change.card.id, change.card.sourceHash, change.changes, async () => {
        await verifyManifestHash(root, manifestHash);
        await verifyCardSources(root, cards.filter(card => !updated.includes(card.id)));
      });
      changedPaths.push(change.card.path);
      updated.push(change.card.id);
      activeNative = null;
    }
    // Apply auto-tags only to cards moved by this operation; leave existing deck cards untouched.
    if (targetDeckId !== undefined) {
      const moves = cards.filter(card => card.deckId !== targetDeckId)
        .map(card => autoTagMove(catalog, card.id, card.deckId, targetDeckId))
        .filter(move => move.fromDeck?.autoTag || move.toDeck?.autoTag);
      if (moves.length) changedPaths.push(...await applyDeckAutoTags(root, moves));
    }
  } catch (error) {
    const nativeSaved = error !== null && typeof error === 'object' && 'saved' in error && error.saved === true;
    const saved = manifestSaved || nativeSaved;
    if (nativeSaved && activeNative && !updated.includes(activeNative)) updated.push(activeNative);
    if (updated.length === 0 && !saved) throw error;
    const pending = changes.filter(change => !updated.includes(change.card.id)).map(change => change.card.id);
    const failure = new Error(serverText(catalogText).partialChanges(updated, changes, pending, error));
    Object.assign(failure, { saved: true, updated, pending });
    throw failure;
  }
  return [...new Set(changedPaths)];
}

type CardLinksEdit = Extract<CatalogEdit, { action: 'assign-deck' | 'set-tracks' | 'set-card-links' }>;

interface AutoTagMove { cardId: string; fromDeck: CatalogDeck | null; toDeck: CatalogDeck | null }

/**
 * 2026-11-04: add the deck's auto-tag when a card enters; remove it on exit unless the deck retains tags.
 * Do not retroactively rewrite existing cards. The tag need not be registered in project tags.
 * Return rewritten files.
 */
async function applyDeckAutoTags(root: string, moves: readonly AutoTagMove[]): Promise<string[]> {
  const options = await readCardOptions(root);
  const changes: Record<string, Partial<CardOptions>> = {};
  for (const move of moves) {
    const tags = options.options[move.cardId]?.tags ?? [];
    const gained = move.toDeck?.autoTag && !tags.includes(move.toDeck.autoTag) ? move.toDeck.autoTag : null;
    const lost = move.fromDeck?.autoTag && !move.fromDeck.autoTagKeep && move.fromDeck.autoTag !== move.toDeck?.autoTag
      && tags.includes(move.fromDeck.autoTag) ? move.fromDeck.autoTag : null;
    if (!gained && !lost) continue;
    const next = tags.filter(tag => tag !== lost);
    if (gained && !next.includes(gained)) next.push(gained);
    changes[move.cardId] = { tags: next };
  }
  if (!Object.keys(changes).length) return [];
  const plan = await prepareCardOptionsPatch(root, options.hash, changes);
  if (!plan.changed) return [];
  await plan.publish();
  return [cardOptionsPath];
}

/** Resolve both decks from one catalog snapshot when applying auto-tags to a moved card. */
function autoTagMove(catalog: CatalogView, cardId: string, fromDeckId: string | null, toDeckId: string | null): AutoTagMove {
  const deck = (id: string | null) => id ? catalog.decks.find(candidate => candidate.id === id) ?? null : null;
  return { cardId, fromDeck: deck(fromDeckId), toDeck: deck(toDeckId) };
}

async function editCardLinks(root: string, source: ManifestSource, edit: CardLinksEdit): Promise<string[]> {
  const isNative = edit.cardId.startsWith('card:');
  if ((isNative || edit.action === 'set-card-links') && (!edit.sourceHash || !/^[0-9a-f]{64}$/u.test(edit.sourceHash))) throw new Error(serverText(catalogText).sourceHashRequired);
  if (!isNative && (source.bytes ? digest(source.bytes) : '') !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(catalogText).cardMissingInFiles);
  if (edit.sourceHash !== undefined && card.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const changes: { deckId?: string | null; trackIds?: string[] } = {};
  if (edit.action === 'assign-deck' || edit.action === 'set-card-links') {
    const deck = catalog.decks.find(candidate => candidate.id === edit.deckId);
    if (edit.deckId !== null && (!deck || !deckAcceptsCard(deck.kind, card.kind))) throw new Error(serverText(catalogText).incompatibleCard);
    changes.deckId = edit.deckId;
  }
  if (edit.action === 'set-tracks' || edit.action === 'set-card-links') {
    if (!Array.isArray(edit.trackIds) || new Set(edit.trackIds).size !== edit.trackIds.length
      || edit.trackIds.some(trackId => !catalog.tracks.some(track => track.id === trackId))) throw new Error(serverText(catalogText).invalidCardTracks);
    changes.trackIds = edit.trackIds;
  }
  // 2026-11-04: a single transfer clears the old zone and appends to the new deck exactly like bulk.
  const targetDeckId = Object.hasOwn(changes, 'deckId') ? changes.deckId : undefined;
  const changed = (targetDeckId !== undefined && targetDeckId !== card.deckId)
    || (changes.trackIds !== undefined && !isDeepStrictEqual(changes.trackIds, card.trackIds));
  if (!changed) return [];
  return applyMembershipChanges(root, source, edit, catalog, [card], [{ card, changes }], targetDeckId);
}

type CreateCardEdit = Extract<CatalogEdit, { action: 'create-card' }>;

type CardParentEdit = Extract<CatalogEdit, { action: 'set-card-parent' }>;

/** Insert or replace one override; keep every other YAML/body byte, including comments. */
export function patchLegacyScalar(source: ManifestSource, cardId: string, key: 'parentId' | 'owner' | 'effort' | 'priority' | 'deck' | 'tracks', value: string | number | string[] | null): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const yaml = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const document = parseYamlDocument(yaml);
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(catalogText).yamlInvalid);
  const membership = document.get('membership', true);
  if (!isSeq(membership) || !membership.range) throw new Error(serverText(catalogText).membershipMissing);
  const entryIndex = source.manifest.membership.findIndex(entry => entry.card === cardId);
  const desired = { ...source.manifest, membership: [...source.manifest.membership] };
  const literal = JSON.stringify(value);
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  let start: number;
  let end: number;
  let inserted: string;
  if (entryIndex >= 0) {
    const entry = membership.items[entryIndex];
    if (!isMap(entry) || !entry.range) throw new Error(serverText(catalogText).membershipAlias);
    desired.membership[entryIndex] = { ...desired.membership[entryIndex], [key]: value };
    if (entry.has(key)) {
      const scalar = entry.get(key, true);
      if ((!isScalar(scalar) && !(Array.isArray(value) && isSeq(scalar))) || !scalar.range) throw new Error(serverText(catalogText).explicitYaml(key));
      [start, end] = scalar.range;
      inserted = (start === end && yaml[start - 1] === ':' ? ' ' : '') + literal + (yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '');
    } else if (entry.flow) {
      start = end = entry.range[0] + 1;
      inserted = `${key}: ${literal}, `;
    } else {
      start = end = entry.range[0];
      const column = start - (yaml.lastIndexOf('\n', start - 1) + 1);
      inserted = `${key}: ${literal}${newline}${' '.repeat(column)}`;
    }
  } else {
    desired.membership.unshift({ card: cardId, [key]: value });
    const entry = `{ card: ${JSON.stringify(cardId)}, ${key}: ${literal} }`;
    if (membership.flow) {
      start = end = membership.range[0] + 1;
      inserted = entry + (membership.items.length ? ', ' : '');
    } else {
      start = end = membership.range[0];
      const column = start - (yaml.lastIndexOf('\n', start - 1) + 1);
      inserted = `- ${entry}${newline}${' '.repeat(column)}`;
    }
  }
  const edited = yaml.slice(0, start) + inserted + yaml.slice(end);
  const roundtrip = parseYamlDocument(edited);
  if (roundtrip.errors.length || !isDeepStrictEqual(roundtrip.toJS(), desired)) throw new Error(serverText(catalogText).parentPatch);
  validateManifest(roundtrip.toJS());
  const byteStart = source.yamlStart + Buffer.byteLength(yaml.slice(0, start));
  const byteEnd = source.yamlStart + Buffer.byteLength(yaml.slice(0, end));
  return Buffer.concat([source.bytes.subarray(0, byteStart), Buffer.from(inserted), source.bytes.subarray(byteEnd)]);
}

async function setCardParent(root: string, source: ManifestSource, edit: CardParentEdit): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/u.test(edit.sourceHash)
    || (edit.expectedParentId !== null && typeof edit.expectedParentId !== 'string')
    || (edit.parentId !== null && (typeof edit.parentId !== 'string' || !edit.parentId))
    || (edit.parentId === null ? edit.parentSourceHash !== null : typeof edit.parentSourceHash !== 'string' || !/^[0-9a-f]{64}$/u.test(edit.parentSourceHash))) {
    throw new Error(serverText(catalogText).parentHashes);
  }
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(catalogText).cardMissing);
  if (card.sourceHash !== edit.sourceHash || card.parentId !== edit.expectedParentId) throw new Error('CARD_CONFLICT');
  const parent = validateCardFamily(catalog, [card], edit.parentId);
  if (parent && parent.sourceHash !== edit.parentSourceHash) throw new Error('CARD_CONFLICT');
  if (card.journey && card.parentId !== edit.parentId) throw new Error(serverText(catalogText).journeyParent);
  const verifySources = async () => {
    await verifyManifestHash(root, edit.manifestHash);
    const fresh = await readFreshProjectCatalog(root);
    if (fresh.optionsHash !== catalog.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
    const current = fresh.cards.find(item => item.id === card.id);
    if (!current || current.parentId !== card.parentId) throw new Error('CARD_CONFLICT');
    validateCardFamily(fresh, [current], edit.parentId);
    for (const candidate of parent ? [card, parent] : [card]) {
      const hash = candidate.id.startsWith('card:')
        ? (await readNativeCard(root, candidate.id))?.fileHash
        : digest(await readProjectMarkdown(root, candidate.path));
      if (hash !== candidate.sourceHash) throw new Error('CARD_CONFLICT');
    }
  };
  await verifySources();
  if (card.parentId === edit.parentId) return [];
  if (card.id.startsWith('card:')) {
    await editNativeCardParent(root, card.id, edit.sourceHash, edit.parentId, verifySources);
    return [card.path];
  }
  if (!source.bytes) {
    const manifest = { ...source.manifest, membership: [{ card: card.id, parentId: edit.parentId }] };
    validateManifest(manifest);
    const created = await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verifySources);
    if (!created) throw new Error('CATALOG_CONFLICT');
  } else {
    const bytes = patchLegacyScalar(source, card.id, 'parentId', edit.parentId);
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, bytes, verifySources);
  }
  return [catalogPath];
}

/** 2026-11-03: reorder only ID scalars when possible, leaving comments and unrelated YAML bytes intact. */
function patchSubCardOrder(source: ManifestSource, heroId: string, cardIds: string[]): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const yaml = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const document = parseYamlDocument(yaml, { keepSourceTokens: true });
  if (document.errors.length || !isMap(document.contents) || !document.contents.range) throw new Error(serverText(catalogText).yamlInvalid);
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  const desired = { ...source.manifest, subCardOrder: { ...source.manifest.subCardOrder, [heroId]: cardIds } };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const order = document.get('subCardOrder', true);
  const orderEntry = `${JSON.stringify(heroId)}: ${JSON.stringify(cardIds)}`;
  if (!document.has('subCardOrder')) {
    const start = document.contents.range[0] + (document.contents.flow ? 1 : 0);
    edits.push({ start, end: start, text: `subCardOrder: {${orderEntry}}` + (document.contents.flow ? ', ' : newline) });
  } else {
    if (!isMap(order) || !order.range) throw new Error(serverText(catalogText).subCardOrderAlias);
    if (!order.has(heroId)) {
      const start = order.range[0] + (order.flow ? 1 : 0);
      const column = start - (yaml.lastIndexOf('\n', start - 1) + 1);
      const suffix = order.flow ? (order.items.length ? ', ' : '') : newline + ' '.repeat(column);
      edits.push({ start, end: start, text: orderEntry + suffix });
    } else {
      const sequence = order.get(heroId, true);
      if (!isSeq(sequence) || !sequence.range) throw new Error(serverText(catalogText).heroOrderYaml);
      if (sequence.items.length === cardIds.length) {
        sequence.items.forEach((item, index) => {
          if (!isScalar(item) || !item.range || typeof item.value !== 'string') throw new Error(serverText(catalogText).subCardIdYaml);
          if (item.value === cardIds[index]) return;
          const [start, end] = item.range;
          edits.push({ start, end, text: JSON.stringify(cardIds[index]) + (yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '') });
        });
      } else {
        // 2026-11-07: a changed child set still has positional comments worth preserving.
        const [start, end] = sequence.range;
        edits.push(manifestReplacement(yaml, sequence.srcToken, start, end, JSON.stringify(cardIds)));
      }
    }
  }
  const descending = edits.sort((first, second) => second.start - first.start);
  return applyManifestEdits(source, yaml, descending, desired);
}

type ManifestTextEdit = { start: number; end: number; text: string };

/** 2026-11-07: comments inside a replaced value are source text, not disposable serialization trivia. */
function manifestReplacement(yaml: string, token: unknown, start: number, end: number, text: string): ManifestTextEdit {
  const comments = sourceComments(token).filter(comment => comment.offset >= start && comment.offset < end);
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  let inserted = text;
  for (const comment of comments) {
    const lineStart = yaml.lastIndexOf('\n', comment.offset - 1) + 1;
    const prefix = yaml.slice(Math.max(start, lineStart), comment.offset);
    if (/^[ \t]*$/u.test(prefix)) {
      if (inserted && !inserted.endsWith('\n')) inserted += newline;
      inserted += prefix;
    } else inserted += prefix.match(/[ \t]*$/u)?.[0] || ' ';
    inserted += comment.source + newline;
  }
  const ending = yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
  if (inserted && ending && !inserted.endsWith('\n')) inserted += ending;
  if (comments.length && !ending) inserted += ' '.repeat(start - (yaml.lastIndexOf('\n', start - 1) + 1));
  return { start, end, text: inserted };
}

/** 2026-11-07: diff parsed values, but publish source spans so untouched YAML never gets serialized. */
function patchManifest(source: ManifestSource): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const original = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  // Optional properties assigned undefined have the same meaning as omitted YAML keys.
  const desired = JSON.parse(JSON.stringify(source.manifest)) as CatalogManifest;
  let yaml = original;
  for (;;) {
    const document = parseYamlDocument(yaml, { keepSourceTokens: true });
    if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(catalogText).yamlInvalid);
    const previous = document.toJS();
    if (isDeepStrictEqual(previous, desired)) break;
    const edits = manifestValueEdits(yaml, document.contents, previous, desired, newline);
    const before = yaml;
    for (const edit of edits.sort((first, second) => second.start - first.start)) {
      yaml = yaml.slice(0, edit.start) + edit.text + yaml.slice(edit.end);
    }
    if (yaml === before) throw new Error(serverText(catalogText).catalogPatch);
  }
  return applyManifestEdits(source, original, [{ start: 0, end: original.length, text: yaml }], desired);
}

function manifestYaml(value: unknown, newline: string, indent: string, flow: boolean, original?: unknown): string {
  const quote = isScalar(original) && (original.type === 'QUOTE_SINGLE' || original.type === 'QUOTE_DOUBLE')
    ? original.type : undefined;
  return stringify(value, { lineWidth: 0, collectionStyle: flow ? 'flow' : 'block',
    defaultStringType: quote ?? 'PLAIN', blockQuote: !isScalar(original) })
    .replace(/\n$/u, '').replace(/\n/gu, newline + indent);
}

function manifestValueEdits(yaml: string, node: unknown, previous: unknown, next: unknown, newline: string, flow = false): ManifestTextEdit[] {
  const [start, end] = rangeOf(node);
  const indent = ' '.repeat(start - (yaml.lastIndexOf('\n', start - 1) + 1));
  if (isMap(node) && next !== null && typeof next === 'object' && !Array.isArray(next)) {
    const before = previous as Record<string, unknown>;
    const after = next as Record<string, unknown>;
    const removed = Object.keys(before).find(key => !Object.hasOwn(after, key));
    if (removed !== undefined && node.items.length > 1) {
      return removeManifestPair(yaml, node, node.items.findIndex(pair => isScalar(pair.key) && String(pair.key.value) === removed));
    }
    if (removed === undefined) {
      for (const [key, value] of Object.entries(after)) {
        if (!Object.hasOwn(before, key)) {
          const position = start + (node.flow ? 1 : 0);
          const suffix = node.flow ? (node.items.length ? ', ' : '') : newline + indent;
          const entry = manifestYaml({ [key]: value }, newline, indent, !!node.flow);
          return [{ start: position, end: position, text: (node.flow ? entry.slice(1, -1).trim() : entry) + suffix }];
        }
        if (!isDeepStrictEqual(before[key], value)) {
          // 2026-11-07: YAML keys may be numeric, and a flow key without ':' has no value node.
          const pair = node.items.find(pair => isScalar(pair.key) && String(pair.key.value) === key)!;
          if (pair.value === null) {
            const position = rangeOf(pair.key)[1];
            return [{ start: position, end: position, text: ': ' + manifestYaml(value, newline, indent, !!node.flow) }];
          }
          return manifestValueEdits(yaml, pair.value, before[key], value, newline, !!node.flow);
        }
      }
    }
  }
  if (isSeq(node) && Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length > next.length && previous.length > 1) {
      // Match named records before removing a slot so surviving decks keep their own comments.
      const identity = (value: unknown) => value && typeof value === 'object'
        ? (value as { id?: string; card?: string }).id ?? (value as { card?: string }).card ?? value : value;
      const missing = previous.findIndex(value => !next.some(candidate => isDeepStrictEqual(identity(value), identity(candidate))));
      return removeManifestItem(yaml, node, missing < 0 ? previous.length - 1 : missing);
    }
    for (let index = 0; index < Math.min(previous.length, next.length); index += 1) {
      if (!isDeepStrictEqual(previous[index], next[index])) return manifestValueEdits(yaml, node.items[index], previous[index], next[index], newline, !!node.flow);
    }
    if (next.length > previous.length) {
      const added = next.slice(previous.length);
      if (node.flow) {
        const position = node.items.length ? rangeOf(node.items.at(-1))[1] : start + 1;
        const values = added.map(value => manifestYaml(value, newline, indent, true));
        return [{ start: position, end: position, text: (node.items.length ? ', ' : '') + values.join(', ') }];
      }
      const position = manifestContentEnd(node.items.at(-1));
      const lines = indent + manifestYaml(added, newline, indent, false);
      const text = yaml[position - 1] === '\n' ? lines + newline : newline + lines;
      return [{ start: position, end: position, text }];
    }
  }
  const separator = start === end && yaml[start - 1] === ':' ? ' ' : '';
  const collectionFlow = (isMap(node) || isSeq(node)) && !!node.flow;
  // 2026-11-07: inserting before an implicit null's comment must not turn it into scalar content.
  const suffix = start === end && yaml[end] === '#' ? ' ' : '';
  const token = isMap(node) || isSeq(node) || isScalar(node) ? node.srcToken : undefined;
  return [manifestReplacement(yaml, token, start, end, separator + manifestYaml(next, newline, indent, flow || collectionFlow, node) + suffix)];
}

function removeManifestItem(yaml: string, sequence: YAMLSeq, index: number): ManifestTextEdit[] {
  const item = sequence.items[index];
  const [start, end] = rangeOf(item);
  const token = sequence.srcToken;
  if (token?.type === 'flow-collection') {
    const separatorIndex = index < sequence.items.length - 1 ? index + 1 : index;
    const comma = token.items[separatorIndex].start.find(item => item.type === 'comma');
    if (!comma) throw new Error(serverText(catalogText).yamlInvalid);
    return [manifestReplacement(yaml, token, start, end, ''), { start: comma.offset, end: comma.offset + 1, text: '' }];
  }
  const marker = token?.type === 'block-seq' ? token.items[index].start.find(item => item.type === 'seq-item-ind') : undefined;
  if (!marker) throw new Error(serverText(catalogText).yamlInvalid);
  const lineStart = yaml.lastIndexOf('\n', marker.offset - 1) + 1;
  const blockEnd = manifestContentEnd(item);
  // 2026-11-07: the last line of the block has no line break of its own, so take the one before it.
  if (blockEnd === yaml.length && yaml[blockEnd - 1] !== '\n') return [manifestReplacement(yaml, token, yaml[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1, blockEnd, '')];
  return [manifestReplacement(yaml, token, lineStart, blockEnd, '')];
}

/** Applies positioned YAML edits back to front, then proves the parsed result equals the desired manifest. */
function applyManifestEdits(source: ManifestSource, yaml: string, edits: ManifestTextEdit[], desired: CatalogManifest): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  let edited = yaml;
  let bytes: Buffer = source.bytes;
  for (const edit of edits) {
    edited = edited.slice(0, edit.start) + edit.text + edited.slice(edit.end);
    const start = source.yamlStart + Buffer.byteLength(yaml.slice(0, edit.start));
    const end = source.yamlStart + Buffer.byteLength(yaml.slice(0, edit.end));
    bytes = Buffer.concat([bytes.subarray(0, start), Buffer.from(edit.text), bytes.subarray(end)]);
  }
  const roundtrip = parseYamlDocument(edited);
  if (roundtrip.errors.length || !isDeepStrictEqual(roundtrip.toJS(), desired)) throw new Error(serverText(catalogText).catalogPatch);
  validateManifest(roundtrip.toJS());
  return bytes;
}

/** Manual Order and Zones, 2026-11-04: rewrite only one deck's deckOrder entry; null clears the stored order. */
function patchDeckOrder(source: ManifestSource, deckId: string, value: CatalogDeckManualOrder | null): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const yaml = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const document = parseYamlDocument(yaml);
  if (document.errors.length || !isMap(document.contents) || !document.contents.range) throw new Error(serverText(catalogText).yamlInvalid);
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  const entry = `${JSON.stringify(deckId)}: ${JSON.stringify(value)}`;
  const desired = { ...source.manifest, deckOrder: { ...source.manifest.deckOrder, [deckId]: value } };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const order = document.get('deckOrder', true);
  if (!document.has('deckOrder')) {
    const start = document.contents.range[0] + (document.contents.flow ? 1 : 0);
    edits.push({ start, end: start, text: `deckOrder: {${entry}}` + (document.contents.flow ? ', ' : newline) });
  } else if (!isMap(order) || !order.range) {
    throw new Error(serverText(catalogText).deckOrderAlias);
  } else if (!order.has(deckId)) {
    const start = order.range[0] + (order.flow ? 1 : 0);
    const column = start - (yaml.lastIndexOf('\n', start - 1) + 1);
    const suffix = order.flow ? (order.items.length ? ', ' : '') : newline + ' '.repeat(column);
    edits.push({ start, end: start, text: entry + suffix });
  } else {
    const current = order.get(deckId, true);
    if (!current || !current.range) throw new Error(serverText(catalogText).deckOrderYaml);
    const [start, end] = current.range;
    edits.push({ start, end, text: JSON.stringify(value) + (yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '') });
  }
  return applyManifestEdits(source, yaml, edits.sort((first, second) => second.start - first.start), desired);
}

/** 2026-11-05: project preferences change one scalar, preserving every neighbouring byte. */
function patchManifestPreference(source: ManifestSource, key: 'inboxDeckId' | 'pinnedMilestoneId', value: string | null): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const yaml = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const document = parseYamlDocument(yaml);
  if (document.errors.length || !isMap(document.contents) || !document.contents.range) throw new Error(serverText(catalogText).yamlInvalid);
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  const desired = { ...source.manifest, [key]: value };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  if (!document.has(key)) {
    const start = document.contents.range[0] + (document.contents.flow ? 1 : 0);
    edits.push({ start, end: start, text: `${key}: ${JSON.stringify(value)}` + (document.contents.flow ? ', ' : newline) });
  } else {
    const scalar = document.get(key, true);
    if (!isScalar(scalar) || !scalar.range) throw new Error(serverText(catalogText).explicitYamlField(key));
    const [start, end] = scalar.range;
    const separator = start === end && yaml[start - 1] === ':' ? ' ' : '';
    edits.push({ start, end, text: separator + JSON.stringify(value) + (yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '') });
  }
  return applyManifestEdits(source, yaml, edits.sort((first, second) => second.start - first.start), desired);
}

/**
 * 2026-11-06: a piled deck stores `piled: true`; putting it back on the shelf removes the key instead of writing false,
 * so a deck that was never piled has no trace of the feature. Only that key's bytes change.
 */
function patchDeckPile(source: ManifestSource, deckId: string, piled: boolean): Buffer {
  if (!source.bytes) throw new Error(serverText(catalogText).manifestMissing);
  const yaml = source.bytes.subarray(source.yamlStart, source.yamlEnd).toString('utf8');
  const document = parseYamlDocument(yaml, { keepSourceTokens: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(catalogText).yamlInvalid);
  const decks = document.get('decks', true);
  const entry = isSeq(decks) ? decks.items[source.manifest.decks.findIndex(deck => deck.id === deckId)] : undefined;
  if (!isMap(entry) || !entry.range) throw new Error(serverText(catalogText).deckYaml);
  const pairIndex = entry.items.findIndex(pair => isScalar(pair.key) && pair.key.value === 'piled');
  const desired = { ...source.manifest, decks: source.manifest.decks.map(deck => {
    if (deck.id !== deckId) return deck;
    const next: CatalogDeck = { ...deck, piled: true };
    if (!piled) delete next.piled;
    return next;
  }) };
  const edits = piled ? [pileInsertion(yaml, entry, pairIndex)] : removeManifestPair(yaml, entry, pairIndex);
  return applyManifestEdits(source, yaml, edits.sort((first, second) => second.start - first.start), desired);
}

function rangeOf(node: unknown): [number, number, number] {
  const range = (node as { range?: [number, number, number] } | null)?.range;
  if (!range) throw new Error(serverText(catalogText).deckYaml);
  return range;
}

/** 2026-11-07: block collection trivia can extend through the next sibling's indentation. */
function manifestContentEnd(node: unknown): number {
  const [, end, fullEnd] = rangeOf(node);
  return (isMap(node) || isSeq(node)) && !node.flow ? end : fullEnd;
}

/** Writes `piled: true` after the deck's last key, or turns an explicit `piled: false` into true. */
function pileInsertion(yaml: string, entry: YAMLMap, pairIndex: number): ManifestTextEdit {
  if (pairIndex >= 0) {
    const [start, end] = rangeOf(entry.items[pairIndex].value);
    return { start, end, text: 'true' };
  }
  const last = entry.items.at(-1)!;
  if (entry.flow) {
    const end = rangeOf(last.value ?? last.key)[1];
    return { start: end, end, text: ', piled: true' };
  }
  const newline = yaml.includes('\r\n') ? '\r\n' : '\n';
  const [entryStart, entryEnd] = rangeOf(entry);
  const indent = ' '.repeat(entryStart - (yaml.lastIndexOf('\n', entryStart - 1) + 1));
  // A block map's range ends after its last line break, except at the very end of the YAML block.
  const text = yaml[entryEnd - 1] === '\n' ? `${indent}piled: true${newline}` : `${newline}${indent}piled: true`;
  return { start: entryEnd, end: entryEnd, text };
}

/** Deletes a pair with its own line, leaving the neighbouring keys and their comments in place. */
function removeManifestPair(yaml: string, entry: YAMLMap, pairIndex: number): ManifestTextEdit[] {
  if (pairIndex < 0) throw new Error(serverText(catalogText).deckYaml);
  const pair = entry.items[pairIndex];
  const keyStart = rangeOf(pair.key)[0];
  const valueEnd = rangeOf(pair.value ?? pair.key)[1];
  const next = entry.items[pairIndex + 1];
  const previous = entry.items[pairIndex - 1];
  if (entry.flow) {
    const start = next ? keyStart : rangeOf(previous.value ?? previous.key)[1];
    const end = next ? rangeOf(next.key)[0] : valueEnd;
    if (!yaml.slice(start, end).includes('#')) return [{ start, end, text: '' }];
    // 2026-11-06: separators can carry a neighboring key's comment; remove only the comma and this pair.
    const token = entry.srcToken;
    const separator = token?.type === 'flow-collection' ? token.items[next ? pairIndex + 1 : pairIndex]?.start.find(item => item.type === 'comma') : undefined;
    if (!separator) throw new Error(serverText(catalogText).deckYaml);
    return [manifestReplacement(yaml, entry.srcToken, keyStart, valueEnd, ''), { start: separator.offset, end: separator.offset + 1, text: '' }];
  }
  // Keep a bare sequence marker when a comment separates the first key from the remaining map.
  if (pairIndex === 0 && next) {
    const end = rangeOf(next.key)[0];
    return [manifestReplacement(yaml, entry.srcToken, keyStart, yaml.slice(keyStart, end).includes('#') ? valueEnd : end, '')];
  }
  const lineStart = yaml.lastIndexOf('\n', keyStart - 1) + 1;
  if (!/^[ \t]*$/u.test(yaml.slice(lineStart, keyStart))) throw new Error(serverText(catalogText).deckYaml);
  const value = pair.value ?? pair.key;
  const end = manifestContentEnd(value);
  if (yaml.slice(valueEnd, end).includes('#')) return [manifestReplacement(yaml, entry.srcToken, keyStart, valueEnd, '')];
  // The last line of the YAML block has no line break of its own: take the one before it instead.
  if (end === yaml.length && yaml[end - 1] !== '\n') return [manifestReplacement(yaml, entry.srcToken, yaml[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1, end, '')];
  return [manifestReplacement(yaml, entry.srcToken, lineStart, end, '')];
}

/** 2026-11-05: planning prepares the pin before changing any of its related files. */
export async function preparePinnedMilestone(root: string, manifestHash: string, milestoneId: string | null) {
  const source = await readManifest(root);
  if ((source.bytes ? digest(source.bytes) : '') !== manifestHash) throw new Error('CATALOG_CONFLICT');
  const changed = (source.manifest.pinnedMilestoneId ?? null) !== milestoneId;
  const manifest = { ...source.manifest, pinnedMilestoneId: milestoneId };
  validateManifest(manifest);
  let nextBytes = source.bytes;
  if (changed) nextBytes = source.bytes ? patchManifestPreference(source, 'pinnedMilestoneId', milestoneId)
    : Buffer.from('---\n' + stringify(manifest, { lineWidth: 0 }) + '---\n' + workspaceHeader(manifestLanguage(source)));
  const nextHash = nextBytes ? digest(nextBytes) : '';
  return { changed, nextHash, previousBytes: source.bytes, nextBytes,
    async publish(beforePublish?: () => Promise<void>) {
      const verify = async () => { await beforePublish?.(); await verifyManifestHash(root, manifestHash); };
      if (!changed) { await verify(); return; }
      if (source.bytes) await replaceProjectMarkdown(root, catalogPath, manifestHash, nextBytes!, verify);
      else if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verify)) throw new Error('CATALOG_CONFLICT');
    },
  };
}

async function reorderSubCards(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'reorder-subcards' }>): Promise<string[]> {
  if (typeof edit.sourceHash !== 'string' || !/^[0-9a-f]{64}$/u.test(edit.sourceHash)) throw new Error(serverText(catalogText).heroSourceHash);
  if (!Array.isArray(edit.cardIds) || edit.cardIds.length > 1000
    || edit.cardIds.some(id => typeof id !== 'string' || !id || id.length > 1000)
    || new Set(edit.cardIds).size !== edit.cardIds.length) throw new Error(serverText(catalogText).subCardUniqueIds);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const hero = catalog.cards.find(card => card.id === edit.cardId);
  if (!hero || !['hero', 'doc'].includes(hero.kind) || hero.parentId !== null || hero.archived || hero.deleted) throw new Error(serverText(catalogText).subCardOrderOwner);
  if (hero.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const children = catalog.cards.filter(card => ['task', 'doc'].includes(card.kind) && card.parentId === hero.id && !card.archived && !card.deleted);
  const expected = new Map(children.map(card => [card.id, card.sourceHash]));
  if (edit.cardIds.length !== children.length || edit.cardIds.some(id => !expected.has(id))) throw new Error('CARD_CONFLICT');
  const verifySources = async () => {
    // A newly created native child can change the set without changing Hero bytes or the manifest.
    const fresh = await readFreshProjectCatalog(root);
    if (fresh.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
    if (fresh.optionsHash !== catalog.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
    if (fresh.cards.find(card => card.id === hero.id)?.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
    const current = fresh.cards.filter(card => ['task', 'doc'].includes(card.kind) && card.parentId === hero.id && !card.archived && !card.deleted);
    if (current.length !== expected.size || current.some(card => expected.get(card.id) !== card.sourceHash)) throw new Error('CARD_CONFLICT');
  };
  if (isDeepStrictEqual(source.manifest.subCardOrder?.[hero.id], edit.cardIds)) {
    await verifySources();
    return [];
  }
  if (!source.bytes) {
    const manifest = { ...source.manifest, subCardOrder: { [hero.id]: edit.cardIds } };
    validateManifest(manifest);
    if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verifySources)) throw new Error('CATALOG_CONFLICT');
  } else {
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patchSubCardOrder(source, hero.id, edit.cardIds), verifySources);
  }
  return [catalogPath];
}

/** Zone lists of one deck as stored: flat decks use the '' key so callers treat both shapes the same way. */
function deckOrderLists(order: CatalogDeckManualOrder | undefined): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  if ((order?.zones ?? []).length > 0) for (const zone of order!.zones!) lists.set(zone.id, order!.zoneOrder?.[zone.id] ?? []);
  else lists.set('', order?.flatOrder ?? []);
  return lists;
}

/** Add, rename, and reorder Zones; only empty Zones may be deleted. */
async function setDeckZones(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-deck-zones' }>): Promise<string[]> {
  const deck = requiredDeck(source.manifest, edit.deckId);
  const zones: CatalogDeckZone[] = [];
  const zoneIds = new Set<string>();
  for (const zone of edit.zones ?? []) {
    if (!zone || typeof zone.id !== 'string' || !zoneIdPattern.test(zone.id) || zoneIds.has(zone.id)
      || typeof zone.title !== 'string' || !zone.title.trim() || zone.title.length > 120) throw new Error(serverText(catalogText).invalidZone);
    zoneIds.add(zone.id);
    zones.push({ id: zone.id, title: zone.title.trim() });
  }
  if (zones.length > 20) throw new Error(serverText(catalogText).zoneLimit);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const current = catalog.deckOrder?.[deck.id];
  if (!current && zones.length === 0) return [];
  const deckCards = catalog.cards.filter(card => card.deckId === deck.id);
  // Materialize implicit first-zone cards too: otherwise an unlisted card could be lost by a zone edit.
  const currentLists = deckOrderLists(completeDeckManualOrder(deckCards, current ?? { flatOrder: [] }));
  for (const [zoneId, cardIds] of currentLists) if (zoneId && !zoneIds.has(zoneId) && cardIds.length > 0) throw new Error(serverText(catalogText).zoneNotEmpty);
  let next: CatalogDeckManualOrder | null;
  if (zones.length === 0) {
    const hasZones = (current?.zones ?? []).length > 0;
    const flatOrder = hasZones ? [] : currentLists.get('') ?? [];
    next = flatOrder.length > 0 ? { flatOrder } : null;
  } else {
    const zoneOrder: Record<string, string[]> = {};
    for (const zone of zones) zoneOrder[zone.id] = currentLists.get(zone.id) ?? [];
    // The first zone adopts the flat order: adding zones to a flat deck keeps its manual order visible.
    if ((current?.zones ?? []).length === 0 && currentLists.get('')!.length > 0 && zoneOrder[zones[0].id].length === 0) zoneOrder[zones[0].id] = currentLists.get('')!;
    next = { zones, zoneOrder };
  }
  if (isDeepStrictEqual(current ?? null, next)) return [];
  const verify = async () => {
    await verifyManifestHash(root, edit.manifestHash);
    if (!isDeepStrictEqual(normalizeDeckOrder((await readManifest(root)).manifest.deckOrder)[deck.id] ?? null, current ?? null)) throw new Error('CATALOG_CONFLICT');
  };
  if (!source.bytes) {
    const manifest = { ...source.manifest, deckOrder: { ...source.manifest.deckOrder, [deck.id]: next } };
    validateManifest(manifest);
    if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verify)) throw new Error('CATALOG_CONFLICT');
  } else {
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patchDeckOrder(source, deck.id, next), verify);
  }
  return [catalogPath];
}

/** Manual Order: place selected cards of one deck before a card of the target zone, or at its end. */
async function moveCardsInDeck(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'move-cards-in-deck' }>): Promise<string[]> {
  const selected = edit.cards;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 1000) throw new Error(serverText(catalogText).selectionSize);
  const selectedIds = new Set<string>();
  for (const entry of selected) {
    if (!entry || typeof entry.cardId !== 'string' || !entry.cardId.trim() || entry.cardId.length > 1000
      || selectedIds.has(entry.cardId) || typeof entry.sourceHash !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sourceHash)) throw new Error(serverText(catalogText).invalidSelection);
    selectedIds.add(entry.cardId);
  }
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const deck = catalog.decks.find(candidate => candidate.id === edit.deckId);
  if (!deck) throw new Error(serverText(catalogText).deckMissing);
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const cards = selected.map(entry => {
    const card = byId.get(entry.cardId);
    if (!card) throw new Error(serverText(catalogText).missingEntryCard(entry));
    if (card.sourceHash !== entry.sourceHash) throw new Error('CARD_CONFLICT');
    if (card.deckId !== edit.deckId) throw new Error(serverText(catalogText).zoneDeck);
    return card;
  });
  const current = catalog.deckOrder?.[deck.id];
  if (edit.beforeCardId !== null && selectedIds.has(edit.beforeCardId)) return [];
  const deckCards = catalog.cards.filter(card => card.deckId === deck.id);
  const materialized = completeDeckManualOrder(deckCards, current ?? { flatOrder: [] });
  const hasZones = (materialized.zones ?? []).length > 0;
  if (hasZones !== (edit.zoneId !== null)) throw new Error(hasZones ? serverText(catalogText).zoneMissing : serverText(catalogText).noZones);
  const lists = deckOrderLists(materialized);
  const targetList = lists.get(edit.zoneId ?? '');
  if (!targetList) throw new Error(serverText(catalogText).zoneMissing);
  if (edit.beforeCardId !== null && (typeof edit.beforeCardId !== 'string' || !targetList.includes(edit.beforeCardId))) throw new Error(serverText(catalogText).cardInsertion);
  for (const [zoneId, cardIds] of lists) lists.set(zoneId, cardIds.filter(id => !selectedIds.has(id)));
  const insertion = lists.get(edit.zoneId ?? '')!;
  const index = edit.beforeCardId === null ? insertion.length : insertion.indexOf(edit.beforeCardId);
  insertion.splice(index, 0, ...cards.map(card => card.id));
  const next: CatalogDeckManualOrder = hasZones
    ? { zones: materialized.zones, zoneOrder: Object.fromEntries(lists) }
    : { flatOrder: lists.get('')! };
  if (isDeepStrictEqual(current ?? null, next)) return [];
  const verify = async () => {
    await verifyManifestHash(root, edit.manifestHash);
    await verifyCardSources(root, cards);
    if (!isDeepStrictEqual(normalizeDeckOrder((await readManifest(root)).manifest.deckOrder)[deck.id] ?? null, current ?? null)) throw new Error('CATALOG_CONFLICT');
    for (const card of cards) if (byId.get(card.id)?.deckId !== deck.id) throw new Error('CARD_CONFLICT');
  };
  if (!source.bytes) {
    const manifest = { ...source.manifest, deckOrder: { ...source.manifest.deckOrder, [deck.id]: next } };
    validateManifest(manifest);
    if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verify)) throw new Error('CATALOG_CONFLICT');
  } else {
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patchDeckOrder(source, deck.id, next), verify);
  }
  return [catalogPath];
}

/** The default Inbox Deck receives cards created without an explicit deck. */
async function setInboxDeck(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-inbox-deck' }>): Promise<string[]> {
  if (edit.deckId !== null && !deckCanBeInbox(requiredDeck(source.manifest, edit.deckId).kind)) throw new Error(serverText(catalogText).inboxKind);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const deckId = edit.deckId ?? null;
  if ((source.manifest.inboxDeckId ?? null) === deckId) return [];
  const verify = () => verifyManifestHash(root, edit.manifestHash);
  if (!source.bytes) {
    const manifest = { ...source.manifest, inboxDeckId: deckId };
    validateManifest(manifest);
    if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verify)) throw new Error('CATALOG_CONFLICT');
  } else {
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patchManifestPreference(source, 'inboxDeckId', deckId), verify);
  }
  return [catalogPath];
}

function validateOwner(owner: unknown): asserts owner is string | null {
  if (owner !== null && (typeof owner !== 'string' || !owner.trim() || owner.length > 120 || /[\r\n\u0000]/u.test(owner))) throw new Error(serverText(catalogText).owner);
}

function validateEffort(effort: unknown): asserts effort is number | null {
  if (effort !== null && (typeof effort !== 'number' || !Number.isFinite(effort) || effort < 0)) throw new Error(serverText(catalogText).effort);
}

function validatePriority(priority: unknown): asserts priority is 'high' | 'medium' | 'low' | null {
  if (priority !== null && !['high', 'medium', 'low'].includes(priority as string)) throw new Error(serverText(catalogText).priority);
}

/**
 * 2026-11-04: only a deck guardian, human or agent, may accept its cards.
 * If x-deckmate-actor identifies the requester, check only that member's guardian rights.
 * Requests without an actor identify the guardian by exact name in acceptedBy.
 * The rule applies only when entering the accepted state; already-accepted cards are no-ops.
 */
export function guardianAcceptanceRefusal(catalog: CatalogView, card: CatalogCard, actorMemberId: string | null, acceptedBy: string | null | undefined): string | null {
  if (!card.deckId) return null;
  const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
  const guardianIds = deck?.guardianIds ?? [];
  if (!guardianIds.length) return null;
  const members = catalog.members ?? [];
  const guardianNames = guardianIds.map(id => members.find(member => member.id === id)?.label ?? id);
  if (actorMemberId !== null) {
    if (guardianIds.includes(actorMemberId)) return null;
    const actorName = members.find(member => member.id === actorMemberId)?.label ?? actorMemberId;
    return serverText(catalogText).guardianActor(deck, guardianNames, actorName);
  }
  const accepterLabel = typeof acceptedBy === 'string' ? acceptedBy.trim() : '';
  const accepter = members.find(member => member.label === accepterLabel);
  if (accepter && guardianIds.includes(accepter.id)) return null;
  return serverText(catalogText).guardianRequired(deck, guardianNames);
}

type CardStateEdit = Omit<Extract<CatalogEdit, { action: 'set-card-state' }>, 'state'> & { state: CardState };

function requiredCardState(value: string): CardState {
  const state = readCardState(value);
  if (!state) throw new Error(serverText(catalogText).invalidState);
  return state;
}

// 2026-11-09: a native Hero without counted Task Sub Cards takes a manual done mark; with them, its children decide.
function validateHeroMark(catalog: CatalogView, hero: CatalogCard, state: CardState) {
  if (!hero.id.startsWith('card:')) throw new Error(serverText(catalogText).heroLegacyMark);
  if (state !== 'done' && state !== 'not-started') throw new Error(serverText(catalogText).heroMarkStates);
  if (state !== 'done') return;
  const tasks = heroCountedTasks(catalog.cards.filter(card => card.parentId === hero.id && !card.archived && !card.deleted));
  if (tasks.length) throw new Error(serverText(catalogText).heroHasTasks(tasks.filter(task => task.state === 'done').length, tasks.length));
}

function validateCardState(catalog: CatalogView, card: CatalogCard, edit: CardStateEdit, actorMemberId: string | null): boolean {
  if (card.kind === 'hero') validateHeroMark(catalog, card, edit.state);
  else if (card.kind !== 'task') throw new Error(serverText(catalogText).stateTaskOnly);
  // A Hero without its done mark stores null; for the request it reads as not started.
  const current = card.state ?? 'not-started';
  if (edit.state === 'done' && current !== 'done') {
    const refusal = guardianAcceptanceRefusal(catalog, card, actorMemberId, edit.acceptedBy);
    if (refusal) throw new Error(refusal);
  }
  const returnReason = edit.returnReason ?? null;
  if (returnReason !== null && (typeof returnReason !== 'string' || returnReason.length > 500 || /[\r\n]/u.test(returnReason))) {
    throw new Error(serverText(catalogText).returnReason);
  }
  if (current === edit.state) return card.id.startsWith('task:') && edit.state === 'not-started';
  if (returnReason?.trim() && (current !== 'review' || edit.state === 'done')) throw new Error(serverText(catalogText).returnFromReview);
  return true;
}

async function setCardAttributes(root: string, source: ManifestSource, edit: Extract<CatalogEdit, { action: 'set-card-state' | 'set-card-properties' }>, actorMemberId: string | null = null): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/u.test(edit.sourceHash)) throw new Error(serverText(catalogText).cardSourceHash);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(catalogText).cardMissing);
  if (card.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const verify = async () => {
    await verifyManifestHash(root, edit.manifestHash);
    const hash = card.id.startsWith('card:') ? (await readNativeCard(root, card.id))?.fileHash : digest(await readProjectMarkdown(root, card.path));
    if (hash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  };
  await verify();
  if (edit.action === 'set-card-state') {
    const stateEdit: CardStateEdit = { ...edit, state: requiredCardState(edit.state) };
    const state = stateEdit.state;
    const formatLanguage = manifestLanguage(source);
    if (!validateCardState(catalog, card, stateEdit, actorMemberId)) return [];
    // 2026-11-04: starting and accepting cards changes more than state; apply stages sequentially as for question decisions.
    const members = catalog.members ?? [];
    // Starting an unowned card assigns it to the requester identified by x-deckmate-actor;
    // if the actor is unknown, use the first human member in the registry.
    const starter = members.find(member => member.id === actorMemberId) ?? members.find(member => member.kind === 'human') ?? null;
    const started = state === 'started';
    const startOwner = started && starter && !card.owner ? starter.label : null;
    const startHandMemberId = started && starter ? starter.id : null;
    // The state write changes sourceHash; later stages check the manifest and persisted state instead.
    const verifyStateSaved = async () => {
      await verifyManifestHash(root, edit.manifestHash);
      const current = (await refreshProjectCatalog(root, await readProjectCatalog(root), [card.path, cardOptionsPath])).cards.find(candidate => candidate.id === card.id);
      if (!current || current.state !== state) throw new Error('CARD_CONFLICT');
    };
    const writeOptions = async (changes: Record<string, CardOptionsPatch>): Promise<string[]> => {
      const options = await readCardOptions(root);
      const plan = await prepareCardOptionsPatch(root, options.hash, changes);
      if (!plan.changed) return [];
      await plan.publish();
      return [cardOptionsPath];
    };
    const stages: Array<{ title: string; run: () => Promise<string[]> }> = [
      {
        title: serverText(catalogText).stateStage,
        run: async () => {
          const changed = card.id.startsWith('card:')
            ? await editNativeCardProperties(root, card.id, edit.sourceHash, { state: card.kind === 'hero' && state !== 'done' ? null : state }, verify, formatLanguage)
            : await updateLegacyCardState(root, card, state, verify, formatLanguage);
          return changed ? [card.path] : [];
        },
      },
    ];
    if (startOwner !== null) stages.push({
      title: serverText(catalogText).ownerStage,
      run: async () => {
        if (card.id.startsWith('card:')) {
          const fresh = await readNativeCard(root, card.id);
          if (!fresh) throw new Error('CARD_CONFLICT');
          const changed = await editNativeCardProperties(root, card.id, fresh.fileHash, { owner: startOwner }, verifyStateSaved);
          return changed ? [card.path] : [];
        }
        const bytes = patchLegacyScalar(source, card.id, 'owner', startOwner);
        await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, bytes, verifyStateSaved);
        return [catalogPath];
      },
    });
    if (startHandMemberId !== null) stages.push({
      title: serverText(catalogText).handStage,
      run: async () => {
        const fresh = await readProjectCatalog(root);
        const hand = selectCatalogHand(getCatalogHands(fresh), startHandMemberId, serverLang());
        // Starting a card puts it first in the hand, even when full, without changing other hand members.
        const order = [card.id, ...hand.cards.filter(item => item.state !== 'done' && item.id !== card.id).map(item => item.id)];
        const byId = new Map(fresh.cards.map(item => [item.id, item]));
        const changes: Record<string, CardOptionsPatch> = {};
        for (const [index, id] of order.entries()) {
          const item = byId.get(id);
          if (!item) throw new Error('CARD_CONFLICT');
          const patch: CardOptionsPatch = { handOrder: { ...item.handOrder ?? {}, [startHandMemberId]: index } };
          if (id === card.id && !(item.handMemberIds ?? []).includes(startHandMemberId)) patch.handMemberIds = [...new Set([...item.handMemberIds ?? [], startHandMemberId])];
          changes[id] = patch;
        }
        return writeOptions(changes);
      },
    });
    if (card.state === 'done' || state === 'done') stages.push({
      // The acceptance date drives the done pile's weekly badge and auto-archiving.
      title: serverText(catalogText).acceptedDateStage,
      run: async () => {
        const current = (await readProjectCatalog(root)).cards.find(item => item.id === card.id);
        const doneAt = state === 'done' ? localIsoDate() : null;
        if ((current?.doneAt ?? null) === doneAt) return [];
        return writeOptions({ [card.id]: { doneAt } });
      },
    });
    return runDecisionStages(stages, serverText(catalogText).repeatState);
  }
  validateOwner(edit.owner); validateEffort(edit.effort); validatePriority(edit.priority);
  const owner = edit.owner === null ? null : resolveMember(edit.owner.trim(), catalog.members ?? []) ?? edit.owner.trim();
  const changes = { owner, effort: edit.effort, priority: edit.priority };
  if (card.id.startsWith('card:')) {
    const changed = await editNativeCardProperties(root, card.id, edit.sourceHash, changes, verify);
    return changed ? [card.path] : [];
  }
  const entry = source.manifest.membership.find(candidate => candidate.card === card.id);
  const changedKeys = (['owner', 'effort', 'priority'] as const).filter(key => !entry || !Object.hasOwn(entry, key) || entry[key] !== changes[key]);
  if (changedKeys.length === 0) return [];
  if (!source.bytes) {
    const manifest = { ...source.manifest, membership: [{ card: card.id, ...changes }] };
    validateManifest(manifest);
    if (!await createManagedMarkdown(root, catalogPath, manifest, workspaceHeader(manifestLanguage(source)), verify)) throw new Error('CATALOG_CONFLICT');
  } else {
    let patched = source;
    for (const key of changedKeys) patched = parseManifestBytes(patchLegacyScalar(patched, card.id, key, changes[key]));
    await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, patched.bytes!, verify);
  }
  return [catalogPath];
}

/** 2026-11-04: store the complete order of a member's open hand cards as slots in Card Options. */
async function reorderHand(root: string, edit: Extract<CatalogEdit, { action: 'reorder-hand' }>): Promise<string[]> {
  const order = edit.cards.map(selection => selection.cardId);
  if (new Set(order).size !== order.length) throw new Error(serverText(catalogText).handDuplicates);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const hand = selectCatalogHand(getCatalogHands(catalog), edit.memberId, serverLang());
  // The request sourceHash ensures card files have not changed since reordering.
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  for (const selection of edit.cards) {
    const card = byId.get(selection.cardId);
    if (!card || card.sourceHash !== selection.sourceHash) throw new Error('CARD_CONFLICT');
  }
  // Hand membership must also be unchanged: the order covers exactly the open hand cards.
  const openHandIds = new Set(hand.cards.filter(card => card.state !== 'done').map(card => card.id));
  if (order.length !== openHandIds.size || order.some(id => !openHandIds.has(id))) throw new Error('CARD_CONFLICT');
  const changes: Record<string, CardOptionsPatch> = {};
  for (const [index, id] of order.entries()) {
    changes[id] = { handOrder: { ...byId.get(id)!.handOrder ?? {}, [hand.member.id]: index } };
  }
  const options = await readCardOptions(root);
  const plan = await prepareCardOptionsPatch(root, options.hash, changes);
  if (!plan.changed) return [];
  await plan.publish();
  return [cardOptionsPath];
}

/** Create a native card at cards/<uuid>.md; repeating the same request is idempotent. */
async function createCard(root: string, edit: CreateCardEdit, source?: ManifestSource): Promise<string[]> {
  const manifestSource = source ?? await readManifest(root);
  const relativePath = nativeCardPath(edit.cardId);
  if (!relativePath) throw new Error(serverText(catalogText).newCardId);
  if (!['task', 'hero', 'doc'].includes(edit.kind)) throw new Error(serverText(catalogText).newCardKind);
  const title = edit.title.trim();
  if (!title || title.length > 1000 || /[\r\n]/u.test(title)) throw new Error(serverText(catalogText).newCardTitle);
  if (typeof edit.markdown !== 'string' || edit.markdown.length > 200000) throw new Error(serverText(catalogText).newCardText);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const deckId = newCardDeckId(edit.deckId, manifestSource.manifest.inboxDeckId, catalog.decks, edit.kind);
  const deck = catalog.decks.find(candidate => candidate.id === deckId);
  if (deckId !== null && !deck) throw new Error(serverText(catalogText).deckMissing);
  if (deck && !deckAcceptsCard(deck.kind, edit.kind)) throw new Error(serverText(catalogText).incompatibleCard);
  if (new Set(edit.trackIds).size !== edit.trackIds.length
    || edit.trackIds.some(trackId => !catalog.tracks.some(track => track.id === trackId))) throw new Error(serverText(catalogText).newCardTracks);
  const newChild = { id: edit.cardId, kind: edit.kind, parentId: edit.parentId };
  const parent = edit.parentId === null ? undefined : validateCardFamily(catalog, [newChild], edit.parentId);
  // Fill an empty body and unset properties from the deck's Template Card.
  const markdown = edit.markdown.trim() === '' ? deck?.templateMarkdown ?? '' : edit.markdown;
  const requestedOwner = edit.owner ?? deck?.templateOwner ?? null;
  validateOwner(requestedOwner);
  const owner = requestedOwner === null ? null : resolveMember(requestedOwner.trim(), catalog.members ?? []) ?? requestedOwner.trim();
  const effort = edit.effort ?? deck?.templateEffort ?? null;
  const priority = edit.priority ?? deck?.templatePriority ?? null;
  if (effort !== null && (typeof effort !== 'number' || !Number.isFinite(effort) || effort < 0)) {
    throw new Error(serverText(catalogText).newCardEffort);
  }
  if (priority !== null && !['high', 'medium', 'low'].includes(priority)) throw new Error(serverText(catalogText).newCardPriority);
  if (edit.zoneId != null && (typeof edit.zoneId !== 'string' || !zoneIdPattern.test(edit.zoneId))) throw new Error(serverText(catalogText).newCardZone);

  // A Zone's add button selects that lane; other new cards go to the end of the topmost lane.
  const currentOrder = deckId === null ? undefined : catalog.deckOrder?.[deckId];
  const alreadyOrdered = Boolean(currentOrder && ((currentOrder.flatOrder ?? []).includes(edit.cardId)
    || Object.values(currentOrder.zoneOrder ?? {}).some(cardIds => cardIds.includes(edit.cardId))));
  const nextOrder = currentOrder && !alreadyOrdered
    ? appendCardsToDeckOrder(catalog.cards.filter(card => card.deckId === deckId), currentOrder, [edit.cardId], edit.zoneId, serverLang())
    : null;
  if (!currentOrder && edit.zoneId) throw new Error(serverText(catalogText).zoneMissing);
  const orderBytes = nextOrder && deckId !== null ? patchDeckOrder(manifestSource, deckId, nextOrder) : null;
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: edit.cardId.slice(5), kind: edit.kind, title,
    state: edit.kind === 'task' ? writeCardState('not-started', manifestLanguage(manifestSource)) : null, owner, deckId, trackIds: edit.trackIds, parentId: edit.parentId };
  if (effort !== null) metadata.effort = effort;
  if (priority !== null) metadata.priority = priority;
  validateNativeCardMetadata(metadata, metadata.id);
  const published = await createManagedMarkdown(root, relativePath, metadata, markdown, async () => {
    await verifyManifestHash(root, edit.manifestHash);
    if (parent) {
      await verifyCardSources(root, [parent]);
      const fresh = await readFreshProjectCatalog(root);
      if (fresh.optionsHash !== catalog.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
      validateCardFamily(fresh, [newChild], edit.parentId);
    }
  });
  let saved = published;
  if (!published) {
    // This UUID already exists: identical request content confirms success; different content conflicts.
    const existing = await readNativeCard(root, edit.cardId).catch(() => null);
    if (!existing || JSON.stringify(existing.metadata) !== JSON.stringify(metadata) || existing.markdown !== markdown) throw new Error('CARD_ID_CONFLICT');
  }
  const verifyCreatedCard = async () => {
    const existing = await readNativeCard(root, edit.cardId);
    if (!existing || JSON.stringify(existing.metadata) !== JSON.stringify(metadata) || existing.markdown !== markdown) throw new Error('CARD_ID_CONFLICT');
  };
  const changedPaths = published ? [relativePath] : [];
  try {
    let manifestHash = edit.manifestHash;
    if (orderBytes) {
      await replaceProjectMarkdown(root, catalogPath, edit.manifestHash, orderBytes, verifyCreatedCard);
      manifestHash = digest(orderBytes);
      changedPaths.push(catalogPath);
      saved = true;
    }
    if (deck?.autoTag) {
      await verifyManifestHash(root, manifestHash);
      await verifyCreatedCard();
      const autoTagPaths = await applyDeckAutoTags(root, [autoTagMove(catalog, edit.cardId, null, deckId)]);
      changedPaths.push(...autoTagPaths);
      if (autoTagPaths.length > 0) saved = true;
    }
  } catch (error) {
    if (saved && error && typeof error === 'object' && !('saved' in error)) Object.assign(error, { saved: true });
    throw error;
  }
  return changedPaths;
}

type RaiseDecisionEdit = Extract<CatalogEdit, { action: 'raise-decision' }>;
type RecordDecisionEdit = Extract<CatalogEdit, { action: 'record-decision' }>;
type DecisionEdit = RaiseDecisionEdit | RecordDecisionEdit;

const escapedPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Apply compound-action stages sequentially; failures report completed and remaining stages.
 * After any saved stage, mark errors saved: return 200 with a warning, and let a retry finish the work.
 */
async function runDecisionStages(stages: Array<{ title: string; run: () => Promise<string[]> }>, repeatHint: string): Promise<string[]> {
  const done: string[] = [];
  const paths: string[] = [];
  for (const stage of stages) {
    try {
      paths.push(...await stage.run());
      done.push(stage.title);
    } catch (error) {
      const remaining = stages.filter(item => !done.includes(item.title)).map(item => item.title);
      const failure = new Error(serverText(catalogText).partialAction(done, remaining, repeatHint, error));
      if (done.length) Object.assign(failure, { saved: true });
      throw failure;
    }
  }
  return [...new Set(paths)];
}

/** Resolve the rule's Doc card, human owner, and current editable body, excluding legacy YAML/H1. */
async function readRuleCard(root: string, edit: DecisionEdit): Promise<{ card: CatalogCard; member: CatalogMember; markdown: string; sourceHash: string }> {
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(catalogText).cardMissing);
  if (card.kind !== 'doc') throw new Error(serverText(catalogText).questionDoc);
  const member = (catalog.members ?? []).find(candidate => candidate.id === edit.memberId);
  if (!member) throw new Error(serverText(catalogText).memberMissing);
  if (member.kind !== 'human') throw new Error(serverText(catalogText).humanDecision);
  const content = await readCardContent(root, card.id);
  return { card, member, markdown: content.markdown, sourceHash: content.sourceHash };
}

/** Publish Doc content with update-card-content primitives; sourceHash guards the write. */
async function writeRuleDoc(root: string, card: CatalogCard, sourceHash: string, markdown: string, manifestHash: string): Promise<string[]> {
  const verifyManifest = () => verifyManifestHash(root, manifestHash);
  if (card.id.startsWith('card:')) {
    const changed = await editNativeCardContent(root, card.id, sourceHash, { markdown }, verifyManifest);
    return changed ? [card.path] : [];
  }
  const content = await readCardContent(root, card.id);
  return updateCardContent(root, { action: 'update-card-content', manifestHash, cardId: card.id, sourceHash, title: content.title, markdown }, verifyManifest);
}

/** 2026-11-05: the framing sentences of a decision Task's body, in the project's format language; both sections are named by their markers. */
const decisionTaskText: Record<FormatLanguage, { fromRule: (rule: string, section: string) => string; answerNote: (section: string) => string }> = {
  en: {
    fromRule: (rule, section) => `A question from the rule ${rule}, section “${section}”:`,
    answerNote: section => `The human's answer is recorded by the record-decision command in the rule's “${section}” section.`,
  },
  ru: {
    fromRule: (rule, section) => `Вопрос из правила ${rule}, раздел «${section}»:`,
    answerNote: section => `Ответ человека записывается командой record-decision в «${section}» правила.`,
  },
};

/**
 * Turn an open question into a decision Task with a Doc parent, human owner, hand entry, and backlink.
 * Retries with the same taskCardId skip completed stages; check sourceHash only when writing the question.
 */
async function raiseDecision(root: string, edit: RaiseDecisionEdit, source: ManifestSource): Promise<string[]> {
  if (!Number.isInteger(edit.questionIndex) || edit.questionIndex < 0) throw new Error(serverText(catalogText).questionIndex);
  if (typeof edit.questionText !== 'string' || !edit.questionText.trim()) throw new Error(serverText(catalogText).questionText);
  if (typeof edit.taskCardId !== 'string' || !edit.taskCardId.startsWith('card:')) throw new Error(serverText(catalogText).decisionId);
  if (typeof edit.deckId !== 'string' || !edit.deckId) throw new Error(serverText(catalogText).decisionDeck);
  const rule = await readRuleCard(root, edit);
  const questions = parseOpenQuestions(rule.markdown, serverLang()).questions;
  const question = questions?.[edit.questionIndex];
  if (!question || question.text !== edit.questionText.trim()) throw new Error(serverText(catalogText).questionChanged);
  // A decision Task cannot serve two questions; the parser would flag the duplicate reference.
  const taskReference = shortReference('c', edit.taskCardId);
  if (questions?.some((other, index) => index !== edit.questionIndex && other.taskRef === taskReference)) {
    throw new Error(serverText(catalogText).decisionAlreadyLinked);
  }
  const questionTitle = question.text;
  const formatLanguage = manifestLanguage(source);
  const decisionMarker = writeMarker('decision', formatLanguage);
  const openQuestionsMarker = writeMarker('openQuestions', formatLanguage);
  const decidedMarker = writeMarker('decided', formatLanguage);
  const bodyText = decisionTaskText[formatLanguage];
  const docReference = shortReference('c', rule.card.id);
  const item = rule.markdown.slice(question.start, question.end).trimEnd();
  const stages: Array<{ title: string; run: () => Promise<string[]> }> = [
    {
      title: serverText(catalogText).decisionStage,
      run: async () => {
        const existing = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === edit.taskCardId);
        if (existing) {
          if (existing.kind !== 'task' || existing.parentId !== rule.card.id) throw new Error(serverText(catalogText).decisionIdTaken(existing));
          return [];
        }
        return createCard(root, { action: 'create-card', cardId: edit.taskCardId, kind: 'task', title: `${decisionMarker} ${questionTitle}`,
          markdown: `${bodyText.fromRule(`[${rule.card.title}](/r/${docReference})`, openQuestionsMarker)}\n\n${item}\n\n${bodyText.answerNote(decidedMarker)}\n`,
          deckId: edit.deckId, trackIds: [], parentId: rule.card.id, owner: rule.member.label, effort: null, priority: null, manifestHash: edit.manifestHash });
      },
    },
    {
      title: serverText(catalogText).memberHandStage,
      run: async () => {
        const fresh = await readProjectCatalog(root);
        const task = fresh.cards.find(candidate => candidate.id === edit.taskCardId);
        if (!task) throw new Error(serverText(catalogText).decisionMissing);
        const bulk = await (await import('./catalog-bulk.ts')).editCatalogBulk(root, { action: 'bulk-edit-cards',
          cards: [{ cardId: task.id, sourceHash: task.sourceHash }], manifestHash: edit.manifestHash, optionsHash: fresh.optionsHash ?? '',
          change: { kind: 'hand', memberId: edit.memberId, mode: 'add' } });
        return bulk.changedPaths;
      },
    },
    {
      title: serverText(catalogText).questionLinkStage,
      run: async () => {
        const fresh = await readCardContent(root, rule.card.id);
        const updated = linkDecisionTask(fresh.markdown, edit.questionIndex, edit.questionText, edit.taskCardId, serverLang(), formatLanguage);
        // The link already exists, so this stage needs neither a write nor the previous sourceHash.
        if (updated === fresh.markdown) return [];
        if (fresh.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
        return writeRuleDoc(root, rule.card, edit.sourceHash, updated, edit.manifestHash);
      },
    },
  ];
  return runDecisionStages(stages, serverText(catalogText).repeatRaiseDecision);
}

/**
 * Move an open question to the resolved section as an answer with author and local date, and accept its Task.
 * A persisted identical answer makes retries no-ops; a changed question conflicts.
 */
async function recordDecisionAnswer(root: string, source: ManifestSource, edit: RecordDecisionEdit): Promise<string[]> {
  if (!Number.isInteger(edit.questionIndex) || edit.questionIndex < 0) throw new Error(serverText(catalogText).questionIndex);
  if (typeof edit.questionText !== 'string' || !edit.questionText.trim()) throw new Error(serverText(catalogText).questionText);
  if (typeof edit.answer !== 'string' || !edit.answer.trim()) throw new Error(serverText(catalogText).answerEmpty);
  const rule = await readRuleCard(root, edit);
  const ruleText = edit.answer.replace(/\s+/gu, ' ').trim();
  const question = parseOpenQuestions(rule.markdown, serverLang()).questions?.[edit.questionIndex];
  // On retries after saving, compare the answer text because the date may have changed.
  const recorded = new RegExp(`^- ${escapedPattern(ruleText)} — ${escapedPattern(rule.member.label)}, \\d{4}-\\d{2}-\\d{2}$`, 'mu');
  if (!question || question.text !== edit.questionText.trim()) {
    if (recorded.test(rule.markdown)) return [];
    throw new Error(serverText(catalogText).questionChanged);
  }
  const taskRef = question.taskRef;
  const formatLanguage = manifestLanguage(source);
  const stages: Array<{ title: string; run: () => Promise<string[]> }> = [
    {
      title: serverText(catalogText).decidedStage,
      run: async () => {
        if (rule.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
        const updated = recordDecision(rule.markdown, edit.questionIndex, edit.questionText, edit.answer, rule.member.label, localIsoDate(), serverLang(), formatLanguage);
        return writeRuleDoc(root, rule.card, edit.sourceHash, updated, edit.manifestHash);
      },
    },
    {
      title: serverText(catalogText).acceptDecisionStage,
      run: async () => {
        if (!taskRef) return [];
        let task: CatalogCard | null = null;
        try { task = resolveReference((await readProjectCatalog(root)).cards, 'c', taskRef, serverLang()); }
        catch { task = null; }
        if (!task) throw new Error(serverText(catalogText).questionTaskMissing(taskRef));
        return setCardAttributes(root, source, { action: 'set-card-state', cardId: task.id, sourceHash: task.sourceHash,
          state: 'done', acceptedBy: rule.member.label, manifestHash: edit.manifestHash });
      },
    },
  ];
  return runDecisionStages(stages, serverText(catalogText).repeatRecordDecision);
}

/** 2026-11-05: one service mutation owns the report, optional state and their single journal entry. */
async function addCardReport(root: string, source: ManifestSource,
  edit: Extract<CatalogEdit, { action: 'add-card-report' }>, actor: string | null): Promise<string[]> {
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  if (!actor || !catalog.members?.some(member => member.id === actor)) throw new Error(serverText(catalogText).memberMissing);
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(catalogText).cardMissing);
  if (card.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const stateEdit: CardStateEdit | null = edit.state === undefined ? null
    : { action: 'set-card-state', cardId: card.id, sourceHash: edit.sourceHash, manifestHash: edit.manifestHash, state: requiredCardState(edit.state) };
  if (stateEdit) validateCardState(catalog, card, stateEdit, actor);
  const report = await appendCardReport(root, card.path, edit, actor, localIsoDate(), () => verifyManifestHash(root, edit.manifestHash));
  if (!stateEdit) return report.paths;
  try {
    const statePaths = await setCardAttributes(root, source, { ...stateEdit, sourceHash: report.sourceHash }, actor);
    return [...new Set([...report.paths, ...statePaths])];
  } catch (error) {
    // 2026-11-05: saved means state succeeded and a later Owner/Hand/date stage failed; preserve that partial result.
    if (error && typeof error === 'object' && 'saved' in error && error.saved === true) throw error;
    try {
      await replaceProjectMarkdown(root, card.path, report.sourceHash, report.previousBytes);
    } catch (rollbackError) {
      // An external edit must never be overwritten by rollback, nor hidden behind an ordinary retryable failure.
      throw Object.assign(new AggregateError([error, rollbackError], serverText(catalogText).reportRollbackFailed), { saved: true });
    }
    throw error;
  }
}

/** Apply a catalog action and return rewritten project files for board rebuilding. */
export async function editProjectCatalog(root: string, edit: CatalogEdit, actorMemberId: string | null = null,
  templateOptions: import('./project-templates.ts').ProjectTemplateOptions = {}): Promise<string[]> {
  if (edit.action === 'bulk-edit-cards') return (await (await import('./catalog-bulk.ts')).editCatalogBulk(root, edit)).changedPaths;
  // 2026-11-05: tags have an independent registry; only tagsHash guards their contents.
  if (edit.action === 'save-project-tag') {
    const plan = await prepareProjectTag(root, edit.tagsHash, edit.tag);
    await plan.publish();
    return plan.changed ? [projectTagsPath] : [];
  }
  const source = await readManifest(root);
  if (edit.action === 'assign-deck' || edit.action === 'set-tracks' || edit.action === 'set-card-links') return editCardLinks(root, source, edit);
  if ((source.bytes ? digest(source.bytes) : '') !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  if (edit.action === 'apply-project-template') return (await import('./project-templates.ts')).applyProjectTemplate(root, edit, actorMemberId, templateOptions);
  if (edit.action === 'import-journey-template') {
    const catalog = await readProjectCatalog(root);
    if (templateOptions.journeysRoot) catalog.journeyTemplates = (await readJourneyTemplates(templateOptions.journeysRoot, root)).templates;
    return (await import('./journey-templates.ts')).importJourneyTemplate(root, catalog, edit);
  }
  if (edit.action === 'add-card-report') return addCardReport(root, source, edit, actorMemberId);
  if (edit.action === 'set-deck-watchers' || edit.action === 'set-deck-guardians') return setDeckParticipants(root, source, edit);
  if (edit.action === 'set-deck-automation') return setDeckAutomation(root, source, edit);
  if (edit.action === 'set-deck-default-order') return setDeckDefaultOrder(root, source, edit);
  if (edit.action === 'set-deck-pile') return setDeckPile(root, source, edit);
  if (edit.action === 'delete-deck') return deleteDeck(root, source, edit);
  if (edit.action === 'set-deck-kind') return setDeckKind(root, source, edit);
  if (edit.action === 'set-card-parent') return setCardParent(root, source, edit);
  if (edit.action === 'reorder-subcards') return reorderSubCards(root, source, edit);
  if (edit.action === 'set-card-state' || edit.action === 'set-card-properties') return setCardAttributes(root, source, edit, actorMemberId);
  if (edit.action === 'reorder-hand') return reorderHand(root, edit);
  if (edit.action === 'bulk-assign-deck' || edit.action === 'bulk-add-track') return bulkMembership(root, source, edit);
  if (edit.action === 'update-card-content') return updateCardContent(root, edit, () => verifyManifestHash(root, edit.manifestHash));
  if (edit.action === 'create-card') return createCard(root, edit, source);
  if (edit.action === 'set-deck-zones') return setDeckZones(root, source, edit);
  if (edit.action === 'move-cards-in-deck') return moveCardsInDeck(root, source, edit);
  if (edit.action === 'set-inbox-deck') return setInboxDeck(root, source, edit);
  if (edit.action === 'raise-decision') return raiseDecision(root, edit, source);
  if (edit.action === 'record-decision') return recordDecisionAnswer(root, source, edit);
  if (edit.action === 'create-journey' || edit.action === 'apply-journey') {
    const catalog = await readProjectCatalog(root);
    if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
    if (edit.action === 'create-journey') await createJourney(root, catalog, edit);
    else await applyJourney(root, catalog, edit);
    return [];
  }
  let asset: StoredCatalogCover | null = null;
  let manifestSaved = false;
  try {
    asset = await applyCatalogEdit(root, source.manifest, edit);
    validateManifest(source.manifest);
    await writeManifest(root, source, edit.manifestHash);
    manifestSaved = true;
  } catch (error) {
    // 2026-11-03: after rename the image is referenced primary data, even if later cleanup fails.
    if (asset && !manifestSaved) {
      try { await asset.remove(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], serverText(catalogText).coverCleanup); }
    }
    throw error;
  }
  return [];
}
async function verifyManifestHash(root: string, expected: string): Promise<void> {
  const fresh = await readManifest(root);
  if ((fresh.bytes ? digest(fresh.bytes) : '') !== expected) throw new Error('CATALOG_CONFLICT');
}
export function renderCatalogManifest(manifest: CatalogManifest): string {
  validateManifest(manifest);
  return `---\n${stringify(manifest, { lineWidth: 0 }).trimEnd()}\n---\n${workspaceHeader(projectFormatLanguage(manifest))}`;
}
