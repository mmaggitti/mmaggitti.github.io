// Entry: Core & Seams CSS (bundled, so the app works offline), the app's hue, the model, the panel.
import '../../../core-and-seams/generated/core-and-seams.css';
import '../../../core-and-seams/generated/components.css';
import '../../../core-and-seams/generated/hues/blue.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { commands } from './core/app';
import { App } from './panels/App';
import { registerServiceWorker } from './platform';

const root = document.getElementById('app');
if (root) createRoot(root).render(createElement(App));
void commands.boot();
void registerServiceWorker();
