import '../../../ds/ds.css';
import './app.css';
import { createRoot } from 'react-dom/client';
import { App } from './panels/App.tsx';
import { readPref } from './platform/prefs.ts';

// A theme chosen in Files goes on <html> before React draws anything (App keeps it after), so a
// load never paints the app in the system's theme first.
const theme = readPref('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')!).render(<App />);
