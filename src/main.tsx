import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(window.location.search).has('render')) {
  // Headless render target for the dataset builder; see components/three/RenderHarness.tsx.
  void import('./components/three/RenderHarness').then(({ RenderHarness }) => root.render(<RenderHarness />));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
