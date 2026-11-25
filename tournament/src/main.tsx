import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { initNumberInputGuard } from './utils/numberInputGuard';

registerSW({ immediate: true });
initNumberInputGuard();

createRoot(document.getElementById('root')!).render(<App />);
