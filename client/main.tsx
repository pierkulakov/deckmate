import { createRoot } from 'react-dom/client';
// 2026-11-13: Tab intent must be tracked before autofocus and the first application event handler.
import './focus.ts';
import App from './App.tsx';
import './styles.css';
import './motion.css';
import './select.css';
import './surface.css';
import './card-material.css';

createRoot(document.getElementById('root')!).render(<App />);
