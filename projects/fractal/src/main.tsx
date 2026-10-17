import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../ds/ds.css';
import './styles/fractal.css';
import { Shell } from './ui/Shell.tsx';
import { loadLayout } from './platform/storage.ts';
import { probeLayout } from './core/defaults.ts';

const initial = loadLayout() ?? probeLayout();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell initial={initial} />
  </StrictMode>,
);
