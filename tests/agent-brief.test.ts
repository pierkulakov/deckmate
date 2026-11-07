import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBrief, estimateTokens, readFileLines, selectContextLines, sourceLineRange, sourceLines } from '../server/agent-brief.ts';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';

const roots: string[] = [];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(root).startsWith('deckmate-agent-brief-')) {
      throw new Error('Unexpected agent brief fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-agent-brief-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  return root;
}

// 2026-11-05: fixed line positions cover relevance ranking and superseded rules in a fictional garden game.
// Blank lines stand for unrelated source lines omitted from this portable fixture.
const combatEvidence: Record<number, string> = {
  22: '## Решено',
  27: '- Капля воды летит от лейки к ростку по дуге; полёт занимает 0,25 с. Запас влаги обновляется раньше, чем капля достигает листа. Код: WaterFlow, DropView.',
  29: '- Мир игры «Тихий сад»: росток виден сверху, листья имеют мягкую зелёную обводку; палитра состоит из мятного, песочного и голубого. Садовник носит соломенную шляпу и холщовый фартук, дорожки выложены гладкими камнями, у теплицы стоят корзины, скамейки и цветные горшки. Облака отражаются в пруду, на клумбах появляются бабочки, фонари загораются вечером. Росток показывает полив лёгким движением листа; камера остаётся неподвижной.',
  31: '- Иногда удобрение удваивает урожай: случайный бонус повышает количество плодов. Код: HarvestBonus. **отменено 2026-11-02 (ниже)**',
  32: '- Бонус урожая выбирается по жребию: каждое десятое внесение удобрения даёт двойной сбор. Код: HarvestRules.BonusChance. **отменено 2026-11-02 (ниже)**',
  33: '- Случайного бонуса урожая нет: удобрение добавляет фиксированное количество плодов, сбор показывает обычное число корзин.',
  35: '- Влажность показывает сам росток: сухой лист сворачивается, мокрый расправляется; после полива появляется маленькая иконка воды, которая постепенно исчезает.',
  39: '- Реакция ростка видна в миг, когда капля достигает листа: ближайший росток наклоняется и возвращается обратно за 0,25 с. Наклон получает направление из события полива; соседний росток остаётся неподвижным. Код: PlantState, WaterFlow.',
  56: '- Полив действует только рядом с каплей: ближайший росток получает влагу, соседний остаётся сухим. Радиус лейки меньше радиуса дождевателя; дальность задаётся в GardenRules.',
  65: '## Открыто',
  70: '- Как сделать реакцию каждого ростка отдельной: наклон и восстановление листа должны учитывать расстояние до капли, чтобы соседний росток не двигался вместе с ближайшим?',
};
const combatSlice = [
  '### 2.1 Ближайший к капле росток наклоняется',
  '- **Кто:** садовая команда; вид, после 2.0.',
  '- **Видно:** ближайший к капле росток на миг наклоняется от воды, затем возвращается обратно за 0,25 с; полив виден без HUD.',
  '- **Работа:** реакция в `PlantState` в миг, когда капля достигает листа; направление передаёт `WaterFlow`; наклон и время задаются данными.',
  '- **Готово:** событие полива вызывает реакцию у ближайшего ростка, соседний остаётся неподвижным.',
  '',
].join('\r\n');

it('ranks garden watering and plant reaction evidence ahead of the three harvest-bonus lines', () => {
  const fixture = Array.from({ length: 75 }, (_, index) => combatEvidence[index + 1] ?? '').join('\r\n');
  const lines = sourceLines(Buffer.from(fixture));
  const decisions = selectContextLines(lines.filter(line => line.line >= 22 && line.line <= 61), combatSlice, { limit: 5 });
  const questions = selectContextLines(lines.filter(line => line.line >= 65 && line.line <= 75), combatSlice, { limit: 5 });
  expect(decisions.map(line => line.line)).toContain(39);
  expect(questions.map(line => line.line)).toContain(70);
  expect(decisions.length).toBeLessThanOrEqual(5);
  expect(questions.length).toBeLessThanOrEqual(5);
  for (const excluded of [31, 32, 33]) expect(decisions.map(line => line.line)).not.toContain(excluded);
  for (const line of [...decisions, ...questions]) expect(line.text).toBe(combatEvidence[line.line]);
});

it('maps UTF-8 bytes to real lines and reads CRLF/BOM ranges without inventing a line after the final newline', async () => {
  const root = await fixtureRoot();
  const first = '\uFEFFПервая строка\r\n';
  const second = 'Вторая строка\r\n';
  const third = 'Последняя строка';
  for (const ending of ['', '\r\n']) {
    const bytes = Buffer.from(first + second + third + ending);
    await writeFile(path.join(root, 'features/ranges.md'), bytes);
    const lines = sourceLines(bytes);
    expect(lines.map(line => line.text)).toEqual(['\uFEFFПервая строка', 'Вторая строка', 'Последняя строка']);
    expect(lines.map(line => ({ start: line.start, end: line.end }))).toEqual([
      { start: 0, end: Buffer.byteLength(first) },
      { start: Buffer.byteLength(first), end: Buffer.byteLength(first + second) },
      { start: Buffer.byteLength(first + second), end: bytes.length },
    ]);
    expect(sourceLineRange(bytes, { start: Buffer.byteLength(first), end: bytes.length })).toEqual({ from: 2, to: 3 });
    expect(sourceLineRange(bytes, { start: 0, end: Buffer.byteLength(first) })).toEqual({ from: 1, to: 1 });
    const range = await readFileLines(root, 'features/ranges.md', 2, 3);
    expect(range).toMatchObject({ from: 2, to: 3, totalLines: 3, markdown: second + third + ending, sourceHash: digest(bytes) });
    expect(range.tokens).toBe(estimateTokens(range.markdown));
    expect((await readFileLines(root, 'features/ranges.md', 1, 1)).markdown).toBe(first);
    await expect(readFileLines(root, 'features/ranges.md', 1, 4)).rejects.toBeInstanceOf(RangeError);
    await expect(readFileLines(root, 'features/ranges.md', 0, 1)).rejects.toBeInstanceOf(RangeError);
  }
});

async function briefFixture() {
  const root = await fixtureRoot();
  const prefix = [
    '# Проверка', 'Нейтральное вступление.', '',
    '## Решено', '- Порыв ветра вызывает наклон ростка.', '- Интерфейс показывает номер колоды.', '',
    '## Открыто', '- Порыв ветра и наклон ростка требуют проверки.', '- Цвет обозначения колоды нужно выбрать.', '',
    '## Что есть', '- Событие `GustNearby` доступно движку.', '- Загрузка сцены обновляет интерфейс.', '',
    '## Как сделано', '- `PlantState` передаёт наклон в вид.', '- Файлы пакуются архиватором.', '',
    '## Трек 1 — Наклон', 'Вступление Hero.', '',
  ].join('\r\n') + '\r\n';
  const body = '### 1.0 Порыв ветра\r\n- **Работа:** порыв ветра вызывает наклон ростка в `PlantState`, событие `GustNearby`.\r\n'
    + '- **Готово:** проверить результат.\r\n\r\n';
  const suffix = '### 1.1 Другая задача\r\n- Другая работа.\r\n';
  const bytes = Buffer.from(prefix + body + suffix);
  const card: CatalogCard = {
    id: 'task:features/brief.md#1.0', kind: 'task', path: 'features/brief.md', version: '1.0',
    title: 'Порыв ветра', state: 'not-started', owner: null, markdown: body, sourceHash: digest(bytes),
    range: { start: Buffer.byteLength(prefix), end: Buffer.byteLength(prefix + body) },
    deckId: null, trackIds: [], parentId: null,
  };
  const catalog: CatalogView = { rootIdentity: root, formatLanguage: 'ru', documents: [{ path: card.path, title: 'Проверка', hash: card.sourceHash }],
    cards: [card], spaces: [], decks: [], tracks: [], warnings: [], manifestHash: '', configured: false, indexedAt: '' };
  await writeFile(path.join(root, card.path), bytes);
  return { root, bytes, body, card, catalog };
}

it('keeps the card verbatim, accounts for every context section, and links all omitted source lines', async () => {
  const { root, bytes, body, card, catalog } = await briefFixture();
  const brief = await buildBrief(catalog, root, card);
  expect(brief.markdown).toContain('## Card (verbatim)\n' + body);
  expect(brief.tokens).toBe(estimateTokens(brief.markdown));
  expect(brief.tokens).toBeLessThanOrEqual(1500);
  expect(brief.truncated).toBe(true);
  for (const [title, from, to] of [['Решено', 4, 7], ['Открыто', 8, 11], ['Что есть', 12, 15], ['Как сделано', 16, 19]] as const) {
    expect(brief.markdown).toContain(`${title}: selected 1, skipped 1; whole section ${card.path}:${from}-${to}.`);
    expect(brief.readNext).toEqual(expect.arrayContaining([expect.objectContaining({ title, path: card.path, from, to })]));
  }
  const lines = sourceLines(bytes);
  const cardLines = sourceLineRange(bytes, card.range!);
  for (const line of lines.filter(line => line.line < cardLines.from || line.line > cardLines.to)) {
    expect(brief.readNext.some(reference => reference.path === card.path && reference.from <= line.line && reference.to >= line.line)).toBe(true);
  }
  for (const reference of brief.readNext) {
    const raw = bytes.subarray(lines[reference.from - 1].start, lines[reference.to - 1].end).toString('utf8');
    expect(reference.tokens).toBe(estimateTokens(raw));
    expect(brief.markdown).toContain(`${reference.path}:${reference.from}-${reference.to} ${reference.title} ≈${reference.tokens}`);
  }
});

it('rejects a budget that cannot hold the verbatim card and navigation instead of silently cutting it', async () => {
  const { root, card, catalog } = await briefFixture();
  await expect(buildBrief(catalog, root, card, { budget: 1 })).rejects.toThrow(/too small.*at least/u);
});
