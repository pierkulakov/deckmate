import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
const { composeDraft, splitDraft } = await import('../client/components/CardEditForm.tsx');
afterAll(() => vi.unstubAllGlobals());

describe('card editor title-only edits', () => {
  it('preserves leading body blank lines when only the title changes', () => {
    const markdown = '\n\nBody\r\n';
    const edited = composeDraft('Before', markdown).replace(/^Before/u, 'After');
    expect(splitDraft(edited)).toEqual({ title: 'After', markdown });
  });
  it.each(['', '\n', '\r\n', '\n\nBody\r\n', '\r\n\r\nBody\r\n', ' \t\n\nBody\n', '\uFEFFBody\r\n'])('round-trips body bytes: %j', markdown => {
    expect(splitDraft(composeDraft('Title', markdown))).toEqual({ title: 'Title', markdown });
  });
  it('accepts a CRLF title separator without consuming body whitespace', () => {
    expect(splitDraft('# Title\r\n\r\n \t\r\n\r\nBody')).toEqual({ title: 'Title', markdown: ' \t\r\n\r\nBody' });
  });
  it('accepts a body immediately after the title', () => {
    expect(splitDraft('Title\nBody\n')).toEqual({ title: 'Title', markdown: 'Body\n' });
  });
  it('preserves CRLF after the browser normalizes textarea input during a title edit', () => {
    const markdown = '\r\n \t\r\n\uFEFFBody\r\n';
    const edited = composeDraft('After', markdown).replace(/\r\n/gu, '\n');
    expect(splitDraft(edited, markdown)).toEqual({ title: 'After', markdown });
    expect(splitDraft(edited.replace('Body', 'Changed'), markdown).markdown).toContain('Changed');
  });
});
