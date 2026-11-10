import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring } from './browser-layout.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('attachment registry events on the shared socket (browser)', () => {
  const session = createBrowserSession({ attempts: 200, intervalMs: 25 });
  const { evaluate, until } = session;
  let errors: string[] = [];
  async function reset(id?: string) {
    await evaluate(`Object.assign(refreshTest.state, {files:[refreshTest.file],fail:false,holdEdit:false,holdRead:false,actions:[]});refreshTest.render(${JSON.stringify(id)})`);
    await until(`document.querySelector('.attachments-file')?.textContent === 'Original.pdf'`);
  }
  beforeAll(async () => {
    await session.open(browserPath!);
    errors = session.errors;
    await session.navigate('attachments-refresh', `Boolean(window.refreshTest) && document.querySelectorAll('.attachments-row').length === 1`);
  }, 90000);
  afterAll(async () => {
    await session.close();
  }, 20000);

  it.each(['deckmate', 'freetion'])('reloads its own %s-assets registry on the existing socket', async prefix => {
    await reset();
    await evaluate(`refreshTest.state.files=[{...refreshTest.file,name:'External.pdf'}];refreshTest.change(refreshTest.base.replace('deckmate-assets','${prefix}-assets')+'attachments.md')`);
    await until(`document.querySelector('.attachments-file')?.textContent === 'External.pdf'`);
    expect(await evaluate('refreshTest.state.socketCount')).toBe(1);
  });
  it('ignores another card, source and non-registry files', async () => {
    await reset();
    const reads = await evaluate('refreshTest.state.reads');
    await evaluate(`refreshTest.change('tasks/deckmate-assets/cards/another-card/attachments.md');refreshTest.change(refreshTest.base+'attachments.md','live');refreshTest.change(refreshTest.base+'other.md');refreshTest.change('tasks/features/ferry.md')`);
    await expectPageStateDuring(evaluate, `refreshTest.state.reads === ${reads}`, 300);
    expect(await evaluate('refreshTest.state.reads')).toBe(reads);
  });
  it('matches a legacy card even before its first attachment exists', async () => {
    const id = 'task:tasks/legacy.md:123';
    await reset(id);
    const key = 'legacy-' + createHash('sha256').update(id).digest('hex').slice(0, 16);
    await evaluate(`refreshTest.state.files=[];refreshTest.change('tasks/freetion-assets/cards/${key}/attachments.md')`);
    await until(`document.querySelectorAll('.attachments-row').length === 0`);
  });
  it('defers external refresh until removal has finished', async () => {
    await reset();
    const reads = await evaluate('refreshTest.state.reads');
    await evaluate(`refreshTest.state.holdEdit=true;document.querySelector('.attachments-remove').click()`);
    await until(`document.querySelector('.attachments-panel').getAttribute('aria-busy') === 'true'`);
    await evaluate(`refreshTest.state.files=[];refreshTest.change(refreshTest.base+'attachments.md')`);
    await delay(100);
    expect(await evaluate('refreshTest.state.reads')).toBe(reads);
    await evaluate('refreshTest.state.releaseEdit()');
    await until(`document.querySelectorAll('.attachments-row').length === 0 && document.querySelector('.attachments-panel').getAttribute('aria-busy') === 'false'`);
  });
  it('defers external refresh during uploads without interrupting the action', async () => {
    await reset();
    const reads = await evaluate('refreshTest.state.reads');
    await evaluate(`refreshTest.state.holdEdit=true;const input=document.querySelector('input[type=file]');const data=new DataTransfer();data.items.add(new File(['pdf'],'New.pdf',{type:'application/pdf'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))`);
    await until('refreshTest.state.actions.length === 1');
    await evaluate(`refreshTest.state.files=[{...refreshTest.file,name:'Uploaded.pdf'}];refreshTest.change(refreshTest.base+'attachments.md')`);
    await delay(100);
    expect(await evaluate('refreshTest.state.reads')).toBe(reads);
    await evaluate('refreshTest.state.releaseEdit()');
    await until(`document.querySelector('.attachments-file')?.textContent === 'Uploaded.pdf' && document.querySelector('.attachments-panel').getAttribute('aria-busy') === 'false'`);
  });
  it('keeps the confirmed list on a failed refresh and unsubscribes on close', async () => {
    await reset();
    await evaluate(`refreshTest.state.fail=true;refreshTest.change(refreshTest.base+'attachments.md')`);
    await until(`Boolean(document.querySelector('.attachments-message.is-error'))`);
    expect(await evaluate(`document.querySelector('.attachments-file').textContent`)).toBe('Original.pdf');
    await evaluate('refreshTest.render(refreshTest.id,false)');
    await until(`!document.querySelector('.attachments-panel')`);
    const reads = await evaluate('refreshTest.state.reads');
    await evaluate(`refreshTest.change(refreshTest.base+'attachments.md')`);
    await expectPageStateDuring(evaluate, `refreshTest.state.reads === ${reads}`, 200);
    expect(await evaluate('refreshTest.state.reads')).toBe(reads);
    expect(errors).toEqual([]);
  });
  it('does not let a delayed external read overwrite a newer confirmed list', async () => {
    await reset();
    const reads = await evaluate('refreshTest.state.reads');
    await evaluate(`refreshTest.state.holdRead=true;refreshTest.change(refreshTest.base+'attachments.md')`);
    await until(`refreshTest.state.reads === ${reads + 1}`);
    await evaluate(`refreshTest.state.holdRead=false;refreshTest.state.files=[{...refreshTest.file,name:'Latest.pdf'}];refreshTest.change(refreshTest.base+'attachments.md')`);
    await until(`document.querySelector('.attachments-file')?.textContent === 'Latest.pdf'`);
    await evaluate('refreshTest.state.releaseRead()');
    await delay(100);
    expect(await evaluate(`document.querySelector('.attachments-file').textContent`)).toBe('Latest.pdf');
  });
});
