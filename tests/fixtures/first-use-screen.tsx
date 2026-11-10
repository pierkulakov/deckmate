import { prepareEntrance } from '../../client/prepared-motion.ts';
import './first-use-screen.css';

export default function Screen() {
  return <section id="prepared-screen" ref={prepareEntrance}>Prepared content</section>;
}
