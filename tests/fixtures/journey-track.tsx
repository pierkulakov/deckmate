import { createRoot } from 'react-dom/client';
import { JourneyTrack } from '../../client/components/JourneyTrack.tsx';
import { JourneyStepNote } from '../../client/components/JourneyStepNote.tsx';
import { setLang, type Lang } from '../../client/i18n.ts';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/card-preview.css';
import '../../client/card-properties.css';

const root = createRoot(document.getElementById('root')!);
type Props = Omit<Parameters<typeof JourneyTrack>[0], 'cardsById' | 'onOpen' | 'onOpenJourney'> & {
  dependencies?: CatalogCard[]; lang?: Lang; onOpenJourney?: boolean;
};
type NoteProps = Omit<Parameters<typeof JourneyStepNote>[0], 'cardsById' | 'onOpen'> & {
  dependencies?: CatalogCard[]; lang?: Lang;
};
const fixture = {
  opened: [] as string[],
  journeyOpened: 0,
  render({ dependencies = [], lang = 'en', onOpenJourney = false, ...props }: Props) {
    fixture.opened = [];
    fixture.journeyOpened = 0;
    setLang(lang);
    root.render(<><button id="before">Before</button><JourneyTrack {...props}
      cardsById={new Map([...dependencies, ...props.cards].map(card => [card.id, card]))}
      onOpen={card => fixture.opened.push(card.id)}
      onOpenJourney={onOpenJourney ? () => { fixture.journeyOpened++; } : undefined} /><button id="after">After</button></>);
  },
  renderNote({ dependencies = [], lang = 'en', ...props }: NoteProps) {
    fixture.opened = [];
    setLang(lang);
    root.render(<><button id="before">Before</button><JourneyStepNote {...props}
      cardsById={new Map([...dependencies, ...props.cards].map(card => [card.id, card]))}
      onOpen={card => fixture.opened.push(card.id)} /><button id="after">After</button></>);
  },
};
Object.assign(window, { journeyTrackTest: fixture });
