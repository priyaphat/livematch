import React, { useState, useEffect } from "react";
import { usePos } from "../context/PosContext";
import { InstallPwaButton } from "./InstallPwaButton";
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
  } = usePos();
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);

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
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-red-600 via-red-500 to-yellow-500 flex items-center justify-center text-white shadow-lg shadow-red-600/30 group-hover:scale-105 transition-transform">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight">
                  {adminName || settings.storeName}
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-red-600/10 to-amber-500/10 hover:from-red-600/20 hover:to-amber-500/20 border border-red-200 dark:border-amber-500/30 text-red-700 dark:text-yellow-400 text-xs font-bold transition-all shadow-xs"
              title="เปิดหน้าต่างจอฝั่งลูกค้า / Front Desktop (แสดงรายการ, ยอดเงิน & QR Code ให้ลูกค้าดู)"
            >
              <Tv className="w-4 h-4 text-red-600 dark:text-yellow-400 animate-pulse" />
            </button>
          </div>

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
              })
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
