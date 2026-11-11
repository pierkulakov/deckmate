import { createRoot } from 'react-dom/client';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/motion.css';
import '../../client/journey-catalog.css';
import '../../client/select.css';

createRoot(document.getElementById('root')!).render(<>
  <label className="journey-catalog-role-select"><select id="role"><option>First</option><option>Second</option></select><svg aria-hidden="true" /></label>
  <select id="multiple" multiple><option>First</option></select>
  <select id="list" size={3}><option>First</option></select>
  <div style={{ display: 'flex', gap: 'var(--space-2)', margin: 12 }}>
    <select id="touch-select" className="control-field" aria-label="Исполнитель" style={{ width: 240 }}>
      <option value="first">Первый участник</option><option value="second">Второй участник с длинным именем</option>
    </select>
    <button id="touch-neighbour" className="control" onClick={event => { event.currentTarget.dataset.clicked = 'true'; }}>OK</button>
  </div>
</>);
