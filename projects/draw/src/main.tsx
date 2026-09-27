import '../../../ds/ds.css';
import './app.css';
import { createRoot } from 'react-dom/client';
import { App } from './panels/App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
