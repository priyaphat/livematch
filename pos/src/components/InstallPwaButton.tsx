import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const isStandalone = () =>
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
  Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

export const InstallPwaButton: React.FC = () => {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  if (installed || (!prompt && !isIos)) return null;

  const install = async () => {
    if (!prompt) {
      window.alert('บน iPhone/iPad ให้แตะปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”');
      return;
    }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };

  return (
    <button
      id="nav-install-pwa-btn"
      onClick={install}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs font-bold transition-all"
      title="ติดตั้ง LiveMatch POS บนอุปกรณ์นี้"
      type="button"
    >
      <Download className="w-4 h-4" />
      <span className="hidden lg:inline">ติดตั้งแอป</span>
    </button>
  );
};
