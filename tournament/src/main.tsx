import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { initNumberInputGuard } from './utils/numberInputGuard';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if ('serviceWorker' in navigator) {
  // The localhost Docker service is a Vite development server. Keeping an old
  // PWA worker here can serve a stale app shell after a backend/frontend rebuild
  // and make Draw counts disagree with the live API. Production still registers
  // the PWA normally.
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister()))
  );
}
initNumberInputGuard();

createRoot(document.getElementById('root')!).render(<App />);
