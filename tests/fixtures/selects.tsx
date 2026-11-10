import { createRoot } from 'react-dom/client';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/journey-catalog.css';
import '../../client/select.css';

createRoot(document.getElementById('root')!).render(<>
  <label className="journey-catalog-role-select"><select id="role"><option>First</option><option>Second</option></select><svg aria-hidden="true" /></label>
  <select id="multiple" multiple><option>First</option></select>
  <select id="list" size={3}><option>First</option></select>
</>);
