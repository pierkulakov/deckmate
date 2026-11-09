import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Dialog from '@radix-ui/react-dialog';
import { CardHeroPromotionConfirmationContent } from '../client/components/CardDragPresentation.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function renderConfirmation(): string {
  return renderToStaticMarkup(<Dialog.Root open><CardHeroPromotionConfirmationContent deckTitle="Art" busy={false} onConfirm={() => {}} onCancel={() => {}} /></Dialog.Root>);
}

it('renders the Hero promotion confirmation in English and Russian', () => {
  const english = renderConfirmation();
  expect(english).toContain('Make Hero?');
  expect(english).toContain('The card will become a Hero in “Art”. Its text, ID and links will be preserved; its Task state will be removed.');
  expect(english).toContain('Make Hero</button>');
  expect(english).toContain('Cancel</button>');

  setLang('ru');
  const russian = renderConfirmation();
  expect(russian).toContain('Сделать Hero?');
  expect(russian).toContain('Карточка станет Hero в колоде «Art». Её текст, ID и ссылки сохранятся; состояние задачи будет убрано.');
  expect(russian).toContain('Сделать Hero</button>');
  expect(russian).toContain('Отмена</button>');
});
