import { defaultLang, defineText, type Lang } from './i18n.ts';

const text = defineText({
  svgSize: 'SVG must contain up to 16 KB of text.',
  svgUnsupported: 'SVG does not support entities, comments or XML instructions.',
  invalidSvg: 'Invalid SVG.',
  vectorsOnly: 'SVG icons support vector shapes only.',
  invalidNesting: 'Invalid SVG nesting.',
  basicShapesOnly: 'SVG allows basic shapes and groups only.',
  invalidStructure: 'Invalid SVG structure.',
  invalidAttribute: 'Invalid SVG attribute.',
  forbiddenAttribute: (key: string) => `SVG: attribute ${key} is not allowed.`,
  incompleteSvg: 'Incomplete SVG.',
  propertiesRequired: 'Tag properties are required.',
  invalidName: 'The tag name must be a nonempty string of up to 80 characters.',
  invalidColor: 'The tag color must use #RRGGBB.',
  invalidEmoji: 'The tag emoji must be one grapheme of up to 16 characters.',
  invalidCard: 'The tag Card must be a catalog Card ID.',
  singleIcon: 'A tag has one icon: emoji or SVG.',
}, {
  svgSize: 'SVG должен содержать до 16 КБ текста.',
  svgUnsupported: 'SVG не поддерживает entities, комментарии или XML-инструкции.',
  invalidSvg: 'Некорректный SVG.',
  vectorsOnly: 'SVG иконки поддерживает только векторные фигуры.',
  invalidNesting: 'Нарушена вложенность SVG.',
  basicShapesOnly: 'SVG: разрешены только базовые фигуры и группы.',
  invalidStructure: 'Некорректная структура SVG.',
  invalidAttribute: 'Некорректный атрибут SVG.',
  forbiddenAttribute: (key: string) => `SVG: запрещён атрибут ${key}.`,
  incompleteSvg: 'Незавершённый SVG.',
  propertiesRequired: 'Нужны свойства тега.',
  invalidName: 'Название тега — непустая строка до 80 символов.',
  invalidColor: 'Цвет тега — #RRGGBB.',
  invalidEmoji: 'Эмодзи тега — одна графема до 16 символов.',
  invalidCard: 'Карточка тега — ID карточки каталога.',
  singleIcon: 'У тега один значок: эмодзи или SVG.',
});

export interface ProjectTag {
  /** Exact existing card.tags string; changing appearance never renames assignments. */
  name: string;
  color: string;
  emoji?: string;
  iconSvg?: string;
  /** Catalog card describing the tag (e.g. a faction side card); the link is advisory, a missing card is only a warning. */
  cardId?: string;
}

export const defaultTagColor = '#687e9c';

/** A tag shows nothing, a color dot, or a glyph before the card title; never both a dot and a glyph.
 *  The registry always stores a color, so the default color means None. An emoji or SVG icon takes
 *  precedence over the color dot; SVG icons use the color as their tint. */
export type TagDecoration = 'none' | 'color' | 'emoji' | 'icon';
export function tagDecoration(tag: Pick<ProjectTag, 'color' | 'emoji' | 'iconSvg'>): TagDecoration {
  if (tag.emoji) return 'emoji';
  if (tag.iconSvg) return 'icon';
  return tag.color.toLowerCase() === defaultTagColor ? 'none' : 'color';
}
export const maxTagIconLength = 16384;

export function validTagName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validTagCardId(value: unknown): value is string {
  // Same bounds as card option IDs: `card:<uuid>`, `task:<path>#<slice>` and friends.
  return typeof value === 'string' && value.length > 0 && value.length <= 1000
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function validTagEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 16) return false;
  const segments = Array.from(graphemeSegmenter.segment(value));
  return segments.length === 1;
}

const shapes = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const numericAttributes = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity']);
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const numberList = /^[\d\s.,eE+-]+$/u;

function allowedAttribute(name: string, value: string, root: boolean): boolean {
  if (name === 'xmlns') return root && value === 'http://www.w3.org/2000/svg';
  if (numericAttributes.has(name)) return number.test(value) && Number.isFinite(Number(value));
  if (name === 'viewBox') return root && value.trim().split(/[\s,]+/u).length === 4 && value.trim().split(/[\s,]+/u).every(part => number.test(part) && Number.isFinite(Number(part)));
  if (name === 'fill' || name === 'stroke') return /^(?:none|currentColor|black|white|#[0-9a-f]{3}(?:[0-9a-f]|[0-9a-f]{3}(?:[0-9a-f]{2})?)?)$/iu.test(value);
  if (name === 'fill-rule' || name === 'clip-rule') return /^(?:nonzero|evenodd)$/u.test(value);
  if (name === 'stroke-linecap') return /^(?:butt|round|square)$/u.test(value);
  if (name === 'stroke-linejoin') return /^(?:miter|round|bevel)$/u.test(value);
  if (name === 'd') return value.length > 0 && /^[MmZzLlHhVvCcSsQqTtAa\d\s.,eE+-]+$/u.test(value);
  if (name === 'points') return value.length > 0 && numberList.test(value);
  if (name === 'transform') return /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,eE+-]+\)\s*)+$/u.test(value);
  return false;
}

/** 2026-11-04: accept a small SVG grammar, never browser HTML/XML recovery or external resources. */
export function sanitizeTagSvg(value: unknown, lang: Lang = defaultLang): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxTagIconLength) throw new Error(text[lang].svgSize);
  const svg = value.trim();
  if (/[&\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(svg) || /<\s*[!?]/u.test(svg)) throw new Error(text[lang].svgUnsupported);
  const stack: string[] = [];
  const output: string[] = [];
  let position = 0;
  let elements = 0;
  let complete = false;
  const tokens = /<[^<>]*>|[^<]+/gu;
  for (const token of svg.matchAll(tokens)) {
    if (token.index !== position) throw new Error(text[lang].invalidSvg);
    position += token[0].length;
    if (!token[0].startsWith('<')) {
      if (token[0].trim()) throw new Error(text[lang].vectorsOnly);
      continue;
    }
    const closing = /^<\/([a-zA-Z]+)\s*>$/u.exec(token[0]);
    if (closing) {
      if (stack.pop() !== closing[1]) throw new Error(text[lang].invalidNesting);
      output.push(`</${closing[1]}>`);
      if (!stack.length) complete = true;
      continue;
    }
    const opening = /^<([a-zA-Z]+)([\s\S]*?)(\/?)>$/u.exec(token[0]);
    if (!opening || complete || !shapes.has(opening[1]) || ++elements > 256 || stack.length > 16) throw new Error(text[lang].basicShapesOnly);
    const name = opening[1];
    const root = !stack.length;
    if ((root && name !== 'svg') || (!root && name === 'svg') || (stack.length && !['svg', 'g'].includes(stack[stack.length - 1]))) throw new Error(text[lang].invalidStructure);
    let attributes = opening[2];
    const seen = new Set<string>();
    const rendered: string[] = [];
    while (attributes.trim()) {
      const attribute = /^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/u.exec(attributes);
      if (!attribute) throw new Error(text[lang].invalidAttribute);
      const key = attribute[1];
      const content = attribute[2] ?? attribute[3];
      if (seen.has(key) || !allowedAttribute(key, content, root)) throw new Error(text[lang].forbiddenAttribute(key));
      seen.add(key);
      rendered.push(`${key}="${content}"`);
      attributes = attributes.slice(attribute[0].length);
    }
    if (root && !seen.has('xmlns')) rendered.unshift('xmlns="http://www.w3.org/2000/svg"');
    output.push('<' + name + (rendered.length ? ' ' + rendered.join(' ') : '') + (opening[3] ? '/>' : '>'));
    if (opening[3]) { if (root) complete = true; }
    else stack.push(name);
  }
  if (position !== svg.length || stack.length || !complete) throw new Error(text[lang].incompleteSvg);
  return output.join('');
}

export function validateProjectTag(value: unknown, lang: Lang = defaultLang): ProjectTag {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(text[lang].propertiesRequired);
  const tag = value as Record<string, unknown>;
  if (Object.keys(tag).some(key => !['name', 'color', 'emoji', 'iconSvg', 'cardId'].includes(key)) || !validTagName(tag.name)) throw new Error(text[lang].invalidName);
  if (typeof tag.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(tag.color)) throw new Error(text[lang].invalidColor);
  if (tag.emoji !== undefined && tag.emoji !== null && !validTagEmoji(tag.emoji)) throw new Error(text[lang].invalidEmoji);
  if (tag.cardId !== undefined && tag.cardId !== null && !validTagCardId(tag.cardId)) throw new Error(text[lang].invalidCard);
  if (tag.emoji != null && tag.iconSvg != null) throw new Error(text[lang].singleIcon);
  return { name: tag.name, color: tag.color.toLowerCase(),
    ...(tag.emoji === undefined || tag.emoji === null ? {} : { emoji: tag.emoji }),
    ...(tag.iconSvg === undefined || tag.iconSvg === null ? {} : { iconSvg: sanitizeTagSvg(tag.iconSvg, lang) }),
    ...(tag.cardId === undefined || tag.cardId === null ? {} : { cardId: tag.cardId }) };
}

export function tagIconDataUrl(tag: ProjectTag): string | undefined {
  if (!tag.iconSvg) return undefined;
  try {
    const validated = validateProjectTag(tag);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(validated.iconSvg!.replace(/currentColor/giu, validated.color));
  } catch { return undefined; }
}

export function collectProjectTags(cards: readonly { tags?: readonly string[] }[], definitions: readonly ProjectTag[] = []): ProjectTag[] {
  const tags = new Map(definitions.map(tag => [tag.name, tag]));
  for (const card of cards) for (const name of card.tags ?? []) if (!tags.has(name)) tags.set(name, { name, color: defaultTagColor });
  return [...tags.values()].sort((left, right) => left.name.localeCompare(right.name));
}
