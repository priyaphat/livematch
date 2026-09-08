import React, { useState, useEffect, useLayoutEffect } from "react";
import { usePos } from "../context/PosContext";
import { InstallPwaButton } from "./InstallPwaButton";
import { POS_UI_SIZE_MAX, POS_UI_SIZE_MIN, POS_UI_SIZE_STEP, normalizePosUISize, posUISizeToRootFontPixels } from "../utils/uiSize";
import {
  Store,
  Clock,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PauseCircle,
  Sun,
  Moon,
  Tv,
  ExternalLink,
  QrCode,
  LogOut,
  Keyboard,
  KeyboardOff,
  LoaderCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface NavbarProps {
  onLogout: () => void | Promise<void>;
  adminName?: string;
  adminNumber?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  onLogout,
  adminName,
  adminNumber,
}) => {
  const {
    settings,
    updateSettings,
    heldOrders,
    setActiveTab,
    activeTab,
    theme,
    toggleTheme,
    openCustomerDisplayWindow,
    customerDisplayStatus,
    setHardwareKeyboardMode,
  } = usePos();
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiZoom, setUiZoom] = useState(() => {
    return normalizePosUISize(window.localStorage.getItem('pos-ui-size') || window.localStorage.getItem('pos-ui-zoom') || 100);
  });

  useLayoutEffect(() => {
    const scale = activeTab === 'customer-display' ? 1 : uiZoom / 100;
    document.documentElement.style.fontSize = `${posUISizeToRootFontPixels(scale * 100)}px`;
    document.documentElement.style.setProperty('--pos-ui-size', String(scale));
    window.localStorage.setItem('pos-ui-size', String(uiZoom));
    window.localStorage.removeItem('pos-ui-zoom');
    return () => {
      document.documentElement.style.fontSize = '';
      document.documentElement.style.removeProperty('--pos-ui-size');
    };
  }, [uiZoom, activeTab]);

  // Helper to open front desktop customer display in a new window/monitor
  const handleOpenCustomerDisplayWindow = () => {
    openCustomerDisplayWindow();
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
      setCurrentDate(
        now.toLocaleDateString("th-TH", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    }
  };

  return (
    <header className="bg-white dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 px-4 sm:px-6 py-2.5 transition-colors shadow-sm dark:shadow-none">
      <div className="w-full flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: Brand / Branch info */}
        <div className="flex items-center gap-3">
          <div
            id="brand-logo"
            onClick={() => setActiveTab("pos")}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-red-600 via-red-500 to-yellow-500 flex items-center justify-center text-white shadow-lg shadow-red-600/30 group-hover:scale-105 transition-transform overflow-hidden">
              {settings.navbarIconData ? <img src={settings.navbarIconData} alt="ไอคอนระบบ" className="h-full w-full object-cover" /> : <Store className="w-5 h-5 text-white" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight">
                  {settings.navbarTitle || adminName || settings.storeName}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  LiveMatch POS
                </span>
                {adminNumber ? (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">
                      •
                    </span>
                    <span className="font-mono">Admin No. {adminNumber}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </div>

        {/* Held Orders Pill Button */}
        {/* {heldOrders.length > 0 && (
          <button
            id="nav-held-orders-btn"
            onClick={() => setActiveTab("bills")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              activeTab === "bills"
                ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/50 shadow-md shadow-yellow-500/20"
                : "bg-yellow-100 dark:bg-yellow-500/10 hover:bg-yellow-200 dark:hover:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/30"
            }`}
            title="ดูรายการที่พักยอดไว้"
          >
            <PauseCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
            <span className="hidden sm:inline">พักยอด</span>
            <span className="w-5 h-5 rounded-full bg-red-600 text-white font-black flex items-center justify-center text-[11px] shadow-xs">
              {heldOrders.length}
            </span>
          </button>
        )} */}

        {/* Right Action Icons & Time */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <InstallPwaButton />
          {/* Customer Display / Front Desktop Button */}
          <div className="flex items-center">
            <button
              id="nav-customer-display-btn"
              onClick={handleOpenCustomerDisplayWindow}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-xs ${customerDisplayStatus === 'connected' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300' : customerDisplayStatus === 'unsupported' ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-gradient-to-r from-red-600/10 to-amber-500/10 hover:from-red-600/20 hover:to-amber-500/20 border-red-200 dark:border-amber-500/30 text-red-700 dark:text-yellow-400'}`}
              title={customerDisplayStatus === 'connected' ? 'จอลูกค้าเชื่อมต่อแล้ว' : customerDisplayStatus === 'connecting' ? 'กำลังเชื่อมต่อจอลูกค้า' : customerDisplayStatus === 'unsupported' ? 'Presentation API ไม่รองรับ — ใช้หน้าต่างสำรอง' : 'เชื่อมต่อจอลูกค้าด้วย Presentation API'}
              aria-label="เชื่อมต่อจอลูกค้า"
            >
              {customerDisplayStatus === 'connecting' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Tv className={`w-4 h-4 ${customerDisplayStatus === 'connected' ? 'text-emerald-600' : 'text-red-600 dark:text-yellow-400'}`} />}
            </button>
          </div>

          <div className="hidden items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 sm:flex" aria-label="ปรับขนาดส่วนประกอบ POS">
            <button type="button" className="p-2 text-slate-600 hover:bg-slate-200 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-700" disabled={uiZoom <= POS_UI_SIZE_MIN} onClick={() => setUiZoom((value) => Math.max(POS_UI_SIZE_MIN, value - POS_UI_SIZE_STEP))} title="ย่อตัวอักษร ปุ่ม และ Card"><ZoomOut className="h-4 w-4" /></button>
            <button type="button" className="min-w-12 border-x border-slate-200 px-1 py-2 text-[10px] font-black text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700" onClick={() => setUiZoom(100)} title="กลับเป็นขนาดมาตรฐาน">{uiZoom}%</button>
            <button type="button" className="p-2 text-slate-600 hover:bg-slate-200 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-700" disabled={uiZoom >= POS_UI_SIZE_MAX} onClick={() => setUiZoom((value) => Math.min(POS_UI_SIZE_MAX, value + POS_UI_SIZE_STEP))} title="ขยายตัวอักษร ปุ่ม และ Card"><ZoomIn className="h-4 w-4" /></button>
          </div>

          <button
            id="nav-hardware-keyboard-toggle-btn"
            onClick={() => setHardwareKeyboardMode(!settings.hardwareKeyboardMode)}
            className={`p-2 rounded-xl border transition-colors ${settings.hardwareKeyboardMode ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}
            title={settings.hardwareKeyboardMode ? 'โหมดคีย์บอร์ด USB เปิดอยู่ — แตะเพื่อเปิดคีย์บอร์ดบนหน้าจอ' : 'แตะเพื่อซ่อนคีย์บอร์ดบนหน้าจอและใช้คีย์บอร์ด USB'}
            aria-label={settings.hardwareKeyboardMode ? 'เปิดคีย์บอร์ดบนหน้าจอ' : 'ใช้คีย์บอร์ด USB'}
            aria-pressed={settings.hardwareKeyboardMode}
          >
            {settings.hardwareKeyboardMode ? <KeyboardOff className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
          </button>

          {/* Theme Mode Toggle Button (White Mode / Dark Mode) */}
          <button
            id="nav-theme-toggle-btn"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-yellow-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all hover:border-yellow-400 shadow-xs"
            title={
              theme === "dark"
                ? "เปลี่ยนเป็น White Mode (โหมดสว่าง)"
                : "เปลี่ยนเป็น Dark Mode (โหมดมืด)"
            }
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-4 h-4 text-yellow-400 animate-spin-slow" />
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-slate-700" />
              </>
            )}
          </button>

          {/* Sound Toggle */}
          <button
            id="nav-sound-toggle-btn"
            onClick={() =>
              updateSettings({
                enableSoundEffects: !settings.enableSoundEffects,
              }, settings.enableSoundEffects ? 'ปิดเสียงเอฟเฟกต์แล้ว' : 'เปิดเสียงเอฟเฟกต์แล้ว', 'local')
            }
            className={`p-2 rounded-xl border transition-colors ${
              settings.enableSoundEffects
                ? "bg-slate-100 dark:bg-slate-800 text-red-600 dark:text-yellow-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                : "bg-slate-100/50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800 hover:bg-slate-100"
            }`}
            title={
              settings.enableSoundEffects
                ? "เปิดเสียงเอฟเฟกต์"
                : "ปิดเสียงเอฟเฟกต์"
            }
          >
            {settings.enableSoundEffects ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </button>

          {/* Fullscreen Toggle */}
          <button
            id="nav-fullscreen-btn"
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors hidden sm:inline-flex"
            title="เต็มจอ"
          >
            {isFullscreen ? (
              <Minimize className="w-4 h-4" />
            ) : (
              <Maximize className="w-4 h-4" />
            )}
          </button>

          <button
            id="nav-logout-btn"
            onClick={onLogout}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-500/10 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="ออกจากระบบ"
          >
            <LogOut className="w-4 h-4" />
          </button>

          {/* Clock Display */}
          <div className="hidden sm:flex flex-col items-end pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1 text-slate-800 dark:text-slate-100 font-mono text-sm font-bold tracking-wider">
              <Clock className="w-3.5 h-3.5 text-red-600 dark:text-yellow-400" />
              <span>{currentTime}</span>
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {currentDate}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
