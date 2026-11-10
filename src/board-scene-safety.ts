import type { BoardScene } from './board-contracts.ts';
import { defineText } from './i18n.ts';

export const maximumBoardBytes = 20 * 1024 * 1024;
export const maximumBoardElements = 5000;
export const maximumBoardImageBytes = 5 * 1024 * 1024;
export const boardImageMimeTypes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
const maximumImageLength = Math.ceil(maximumBoardImageBytes / 3) * 4;
// 2026-11-10: reviewed against Excalidraw 0.18.1 element/types; selection is transient,
// magicframe/iframe belong to AI generation, and future types need a security review first.
const elementTypes = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'embeddable']);
const videoHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'm.youtu.be']);

export const boardSafetyText = defineText({
  html: 'The board contained embedded HTML; it was not displayed.',
  unsupported: 'Unsupported board elements were not displayed.',
  links: 'Unsafe board links were removed.',
  embeds: 'Unsupported board embeds were not displayed.',
  files: 'Unsupported board images were not displayed. Only PNG, JPEG and WebP are allowed.',
  generation: 'AI generation data was removed from the board.',
  invalid: 'Invalid Excalidraw scene.',
  limit: 'Board limits exceeded: 20 MiB, 5000 elements, bounded geometry and drawing data.',
  rejected: 'Embedded HTML (iframe) and unsupported element types cannot be saved on a Vision board.',
}, {
  html: 'На доске был встроенный HTML, он не показан.',
  unsupported: 'Неподдерживаемые элементы доски не показаны.',
  links: 'Небезопасные ссылки доски удалены.',
  embeds: 'Неподдерживаемые встраивания доски не показаны.',
  files: 'Неподдерживаемые изображения доски не показаны. Разрешены только PNG, JPEG и WebP.',
  generation: 'Данные ИИ-генерации удалены с доски.',
  invalid: 'Некорректное полотно Excalidraw.',
  limit: 'Превышены ограничения доски: 20 МиБ, 5000 элементов, ограниченные геометрия и данные рисунка.',
  rejected: 'Встроенный HTML (iframe) и неподдерживаемые типы элементов нельзя сохранять на доске Vision.',
});
export type BoardSafetyIssue = 'html' | 'unsupported' | 'links' | 'embeds' | 'files' | 'generation';
export class BoardSceneSafetyError extends Error {
  readonly code: 'invalid' | 'limit' | 'rejected';
  constructor(code: 'invalid' | 'limit' | 'rejected') { super(code); this.code = code; }
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function boardVideoAddress(link: string): string | null {
  try {
    // 2026-11-10: preserve shorthand entry, never upgrade an explicit unsafe scheme.
    const address = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//iu.test(link) ? `https://${link}` : link;
    const url = new URL(address);
    if (url.protocol !== 'https:' || !videoHosts.has(url.hostname) || url.username || url.password || url.port) return null;
    if (/[\s\\\u0000-\u001f\u007f]/u.test(link)) return null;
    const token = /^[a-zA-Z0-9_-]+$/u;
    const parameters = new URLSearchParams();
    if (url.hostname.endsWith('youtu.be')) {
      if (!/^\/[a-zA-Z0-9_-]+$/u.test(url.pathname)) return null;
      url.hostname = 'youtu.be';
    } else {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v') ?? '';
        if (!token.test(id)) return null;
        parameters.set('v', id);
      } else if (url.pathname === '/playlist' || url.pathname === '/embed/videoseries') {
        const id = url.searchParams.get('list') ?? '';
        if (!token.test(id)) return null;
        parameters.set('list', id);
      } else if (!/^\/(?:shorts|embed)\/[a-zA-Z0-9_-]+$/u.test(url.pathname)) return null;
      if (url.hostname === 'm.youtube.com') url.hostname = 'www.youtube.com';
    }
    for (const key of ['t', 'start']) {
      const time = url.searchParams.get(key);
      if (time && /^[0-9hms]+$/u.test(time)) parameters.set(key, time);
    }
    // 2026-11-10: Excalidraw detects several providers by regex across the entire URL;
    // canonical video URLs cannot smuggle a different provider into a query or fragment.
    url.search = parameters.toString();
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function projectEmbedLink(link: string): boolean {
  return /^\/r\/c-[a-z0-9]+(?:\?source=(?:live|sandbox))?$/u.test(link)
    || /^(?:deckmate|freetion):\/\/(?:card|smart)\/[a-zA-Z0-9:_-]+$/u.test(link);
}
export function isSafeBoardEmbed(link: string): boolean {
  return projectEmbedLink(link) || (link.startsWith('https://') && boardVideoAddress(link) === link);
}
export function isSafeBoardLink(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
  if (projectEmbedLink(value)) return true;
  // 2026-11-10: only local routes, not protocol-relative URLs or browser-normalized backslashes.
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (/^#[a-zA-Z0-9=_-]+$/u.test(value)) return true;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function isSafeBoardImage(value: unknown): boolean {
  if (!record(value) || !boardImageMimeTypes.includes(String(value.mimeType)) || typeof value.dataURL !== 'string') return false;
  const prefix = `data:${value.mimeType};base64,`;
  if (!value.dataURL.startsWith(prefix)) return false;
  const payload = value.dataURL.slice(prefix.length);
  return payload.length > 0 && payload.length <= maximumImageLength && payload.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(payload);
}

function safeAppState(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (typeof input.viewBackgroundColor === 'string' && /^(?:#[a-fA-F0-9]{3,8}|[a-zA-Z]{1,24})$/u.test(input.viewBackgroundColor)) result.viewBackgroundColor = input.viewBackgroundColor;
  for (const key of ['gridSize', 'gridStep']) {
    const value = input[key];
    if (value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000)) result[key] = value;
  }
  if (typeof input.gridModeEnabled === 'boolean') result.gridModeEnabled = input.gridModeEnabled;
  for (const key of ['deckmateAccess', 'freetionAccess']) if (['editable', 'readonly', 'locked'].includes(String(input[key]))) result[key] = input[key];
  return result;
}

function checkElementLimits(element: Record<string, unknown>): number {
  for (const key of ['x', 'y', 'width', 'height', 'angle', 'fontSize']) {
    const value = element[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000)) throw new BoardSceneSafetyError('limit');
  }
  for (const key of ['text', 'originalText']) if (typeof element[key] === 'string' && element[key].length > 100_000) throw new BoardSceneSafetyError('limit');
  if (Array.isArray(element.groupIds) && element.groupIds.length > 100) throw new BoardSceneSafetyError('limit');
  if (!Array.isArray(element.points)) return 0;
  if (element.points.length > 100_000) throw new BoardSceneSafetyError('limit');
  for (const point of element.points) {
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000)) throw new BoardSceneSafetyError('limit');
  }
  return element.points.length;
}

export function sanitizeBoardScene(value: unknown, mode: 'read' | 'write' = 'read'): { scene: BoardScene; issues: BoardSafetyIssue[] } {
  if (!record(value) || value.type !== 'excalidraw' || value.version !== 2 || !Array.isArray(value.elements) || !record(value.appState) || !record(value.files)) throw new BoardSceneSafetyError('invalid');
  if (value.elements.length > maximumBoardElements) throw new BoardSceneSafetyError('limit');
  if (new TextEncoder().encode(JSON.stringify(value)).length > maximumBoardBytes) throw new BoardSceneSafetyError('limit');
  const issues = new Set<BoardSafetyIssue>();
  const ids = new Set<string>();
  const elements: BoardScene['elements'] = [];
  let points = 0;
  for (const raw of value.elements) {
    if (!record(raw) || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) throw new BoardSceneSafetyError('invalid');
    ids.add(raw.id);
    if (!elementTypes.has(String(raw.type))) {
      if (mode === 'write') throw new BoardSceneSafetyError('rejected');
      issues.add(raw.type === 'iframe' ? 'html' : 'unsupported');
      continue;
    }
    points += checkElementLimits(raw);
    if (points > 100_000) throw new BoardSceneSafetyError('limit');
    const element = { ...raw };
    if (record(raw.customData) && Object.hasOwn(raw.customData, 'generationData')) {
      const customData = { ...raw.customData };
      delete customData.generationData;
      element.customData = customData;
      issues.add('generation');
    }
    if (element.type === 'embeddable' && typeof element.link === 'string') {
      const video = boardVideoAddress(element.link);
      if (video) element.link = video;
    }
    if (element.link !== undefined && element.link !== null && !isSafeBoardLink(element.link)) {
      element.link = null;
      issues.add('links');
    }
    if (element.type === 'embeddable' && !isSafeBoardEmbed(typeof element.link === 'string' ? element.link : '')) {
      // 2026-11-10: project nodes have custom renderers, but their link must not fall back to an arbitrary iframe.
      issues.add('embeds');
      continue;
    }
    elements.push(element);
  }
  const files: Record<string, unknown> = {};
  for (const [id, file] of Object.entries(value.files)) {
    if (isSafeBoardImage(file)) Object.defineProperty(files, id, { value: file, enumerable: true, configurable: true, writable: true });
    else issues.add('files');
  }
  // 2026-11-10: groups and frames are flat references in Excalidraw, never nested scenes.
  // Remove references to discarded nodes so restore/duplication cannot revive a generated child.
  const kept = new Set(elements.map(element => element.id));
  for (const element of elements) {
    if (typeof element.frameId === 'string' && !kept.has(element.frameId)) element.frameId = null;
    if (Array.isArray(element.boundElements)) element.boundElements = element.boundElements.filter(bound => record(bound) && kept.has(bound.id));
    for (const key of ['containerId', 'startBinding', 'endBinding']) {
      const binding = element[key];
      if ((typeof binding === 'string' && !kept.has(binding)) || (record(binding) && !kept.has(binding.elementId))) element[key] = null;
    }
  }
  return { scene: { type: 'excalidraw', version: 2, elements, appState: safeAppState(value.appState), files }, issues: [...issues] };
}
