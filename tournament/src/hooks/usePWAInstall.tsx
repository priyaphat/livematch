import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC<{ compact?: boolean; appName?: string }> = ({ compact, appName = 'LiveMatch Umpire' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`min-h-[38px] px-3 py-1.5 rounded-lg bg-[#EAB308] hover:bg-[#CA8A04] text-[#142642] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
          compact ? '' : 'shadow-sm'
        }`}
      >
        <Download className="w-3.5 h-3.5" />
        <span>ติดตั้งแอปลงมือถือ</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#EAB308] text-[#142642] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Share className="w-3.5 h-3.5" />
          <span>ติดตั้งบน iPhone</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-bold">ติดตั้ง {appName} บน iPhone / iPad</h3>
                <button onClick={() => setShowIOSGuide(false)} className="p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-[#525C6B] dark:text-[#9AA8BC] space-y-1.5 list-decimal list-inside">
                <li>กดปุ่ม <strong>แชร์ (Share)</strong> ที่แถบด้านล่างของ Safari</li>
                <li>เลือกเมนู <strong>เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)</strong></li>
                <li>เปิดจากไอคอนหน้าจอโฮมเพื่อใช้งานแบบเต็มจอ (Standalone PWA)</li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[42px] rounded-xl bg-[#156143] text-white text-xs font-bold"
              >
                เข้าใจแล้ว
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowManualHint(true)}
        className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-white/25 bg-white/10 text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        <span>ติดตั้ง PWA</span>
      </button>

      {showManualHint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#131E2E] border border-[#E2DFD5] dark:border-[#25354C] p-5 space-y-3 text-sm text-[#141D2B] dark:text-[#F3F5F8]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">ติดตั้งแอป {appName} (PWA)</h3>
              <button onClick={() => setShowManualHint(false)} className="p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#525C6B] dark:text-[#9AA8BC]">
              เปิดลิงก์นี้บน Chrome / Edge หรือ Safari แล้วกดไอคอนติดตั้งแอปที่แถบที่อยู่ (หรือเมนูเบราว์เซอร์ → Add to Home Screen) เพื่อใช้งานเต็มจอโดยไม่มีแถบเว็บหลัก
            </p>
            <button
              onClick={() => setShowManualHint(false)}
              className="w-full min-h-[42px] rounded-xl bg-[#156143] text-white text-xs font-bold"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </>
  );
};
