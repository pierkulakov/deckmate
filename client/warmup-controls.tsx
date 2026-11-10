import type { DataSource } from '../src/workspace-contracts.ts';
import { catalogStore } from './catalog-store.ts';
import { CardEditForm, composeDraft } from './components/CardEditForm.tsx';
import { QuickSettingsList } from './components/QuickSettingsList.tsx';
import { warmMount } from './warmup-mount.tsx';

export async function warmCardControls(source: DataSource, signal: AbortSignal) {
  const catalog = catalogStore(source).getSnapshot().catalog;
  if (!catalog || signal.aborted) return;
  const card = catalog.cards.find(card => !card.deleted && !card.archived);
  if (!card) return;
  const noop = () => {};
  // 2026-11-10: omit cardId/path so the disabled warm editor cannot request attachments or create a file baseline.
  await warmMount(<CardEditForm draft={composeDraft(card.title, card.markdown)} catalog={catalog} source={source}
    writable={false} busy={false} onDraftChange={noop} onSave={noop} onCancel={noop} />, signal);
  if (signal.aborted) return;
  await warmMount(<QuickSettingsList title="" choices={(catalog.members ?? []).map(member => ({ key: member.id, label: member.label }))}
    current="" disabled onChoose={noop} />, signal);
}
