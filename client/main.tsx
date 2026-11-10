import { createRoot } from 'react-dom/client';
// Starts tracking keyboard and pointer input before the first render, for the focus ring of script focus (client/focus.ts).
import './focus.ts';
import App from './App.tsx';
import './styles.css';
import './motion.css';
import './select.css';
import './surface.css';
import './card-material.css';

createRoot(document.getElementById('root')!).render(<App />);
