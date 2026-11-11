import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MembersEditor } from '../../client/components/MembersEditor.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { useWorkspace } from '../../client/useWorkspace.ts';
import { setLang } from '../../client/i18n.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/select.css';

// 2026-11-10: use the real workspace socket and catalog store so file-watcher races reach the open form.
const params = new URLSearchParams(location.search);
setLang(params.get('lang') === 'ru' ? 'ru' : 'en');
document.documentElement.classList.toggle('dark', params.get('theme') !== 'light');
let source: DataSource = 'sandbox';

function Fixture() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(true);
  source = workspace.source;
  return <div data-connection={workspace.connection}>
    <button type="button" onClick={() => setOpen(true)}>Open members</button>
    {workspace.snapshot && <MembersEditor snapshot={workspace.snapshot} refreshKey={workspace.updatedAt}
      open={open} onOpenChange={setOpen} />}
  </div>;
}

Object.assign(window, { membersStatesTest: {
  setLang,
  state: () => catalogStore(source).getSnapshot(),
  refresh: () => catalogStore(source).refresh(),
  dismissWarning: () => catalogStore(source).dismissWarning(),
} });
createRoot(document.getElementById('root')!).render(<Fixture />);
