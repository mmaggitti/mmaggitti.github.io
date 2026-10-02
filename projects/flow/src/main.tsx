import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../ds/ds.css';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
