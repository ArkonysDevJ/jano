import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { installClipboardClearOnExit } from './clipboard';
import './ui/theme.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Fire-and-forget: a no-op on Web (see clear-on-exit.ts), and doesn't
// need to block first paint on the packaged app either -- the window
// close hook only needs to be installed before the user could
// plausibly close the window, not before render.
void installClipboardClearOnExit();
