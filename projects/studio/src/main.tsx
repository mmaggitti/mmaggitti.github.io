import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../ds/ds.css';
import './studio.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
