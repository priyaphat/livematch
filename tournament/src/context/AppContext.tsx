import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createInitialSystemState } from '../data/mockData';
import { apiFetch, setApiActor } from '../services/api';
import {
  Language,
  MatchRecord,
  PermissionKey,
  SystemStatePayload,
  ThemeMode,
  UserRole,
} from '../types/tournament';

export type AppPortalMode =
  | 'tournament_system'
  | 'director_portal'
  | 'public_live'
  | 'public_register'
  | 'public_director'
  | 'public_status';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  text: string;
}

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  impactLines?: string[];
  onConfirm: (reason?: string) => Promise<void> | void;
}

interface AppContextValue {
  state: SystemStatePayload;
  loading: boolean;
  error: string | null;
  sseConnected: boolean;
  theme: ThemeMode;
  toggleTheme: () => void;
  lang: Language;
  setLang: (lang: Language) => void;
  portalMode: AppPortalMode;
  setPortalMode: (mode: AppPortalMode) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  selectedTournamentId: string | null;
  setSelectedTournamentId: (id: string | null) => void;
  publicInitialTab: 'center' | 'live' | 'bracket' | 'venue';
  setPublicInitialTab: (tab: 'center' | 'live' | 'bracket' | 'venue') => void;
  publicFocusMatchId: string | null;
  setPublicFocusMatchId: (id: string | null) => void;
  isPublicKiosk: boolean;
  setIsPublicKiosk: (kiosk: boolean) => void;
  publicLookupCode: string;
  setPublicLookupCode: (code: string) => void;
  refreshState: () => Promise<void>;
  switchRole: (role: UserRole, name: string) => Promise<void>;
  hasPermission: (perm: PermissionKey) => boolean;
  notify: (type: ToastMessage['type'], text: string) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  confirmState: ConfirmOptions | null;
  requestConfirm: (opts: ConfirmOptions) => void;
  closeConfirm: () => void;
  applyOptimisticMatch: (match: MatchRecord) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SystemStatePayload>(() => createInitialSystemState());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lm_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });

  const [lang, setLang] = useState<Language>('th');
  const [portalMode, setPortalModeState] = useState<AppPortalMode>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      if (mode === 'umpire' || window.location.pathname === '/umpire') {
        return 'director_portal';
      }
      if (mode === 'public') return 'public_live';
      if (mode === 'public_register') return 'public_register';
      if (mode === 'public_director') return 'public_director';
      if (mode === 'public_status') return 'public_status';
    }
    return 'tournament_system';
  });
  const [selectedTournamentId, setSelectedTournamentIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('tournament') || null;
    }
    return null;
  });
  const setPortalMode = useCallback((mode: AppPortalMode) => {
    setPortalModeState(mode);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const modeParam: Partial<Record<AppPortalMode, string>> = {
      director_portal: 'umpire',
      public_live: 'public',
      public_register: 'public_register',
      public_director: 'public_director',
      public_status: 'public_status',
    };
    const value = modeParam[mode];
    if (value) params.set('mode', value);
    else params.delete('mode');
    const currentTournament = params.get('tournament');
    if (mode === 'public_live') {
      const tournament = state.tournaments.find((item) => item.id === currentTournament || item.publicToken === currentTournament);
      if (tournament?.publicToken) params.set('tournament', tournament.publicToken);
    } else if (mode === 'tournament_system') {
      const tournament = state.tournaments.find((item) => item.publicToken === currentTournament);
      if (tournament) params.set('tournament', tournament.id);
    }
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, [state.tournaments]);
  const setSelectedTournamentId = useCallback((id: string | null) => {
    setSelectedTournamentIdState(id);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (id) {
      params.set('tournament', id);
      if (!params.get('view')) params.set('view', 'home');
    } else {
      params.delete('tournament');
      params.delete('view');
      params.delete('settingSection');
    }
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const [publicInitialTab, setPublicInitialTab] = useState<'center' | 'live' | 'bracket' | 'venue'>(() => {
    if (typeof window !== 'undefined') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab === 'center' || tab === 'live' || tab === 'bracket' || tab === 'venue') return tab;
    }
    return 'center';
  });
  const [publicFocusMatchId, setPublicFocusMatchId] = useState<string | null>(null);
  const [isPublicKiosk, setIsPublicKiosk] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('kiosk') === '1' || params.get('pwa') === '1';
    }
    return false;
  });
  const [publicLookupCode, setPublicLookupCode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('code') || '';
    }
    return '';
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);

  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('lm_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((type: ToastMessage['type'], text: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      setError(null);
      if (portalMode === 'public_live' || portalMode === 'public_register' || portalMode === 'public_director' || portalMode === 'public_status') {
        setLoading(false);
        return;
      }
      const data = await apiFetch<SystemStatePayload>(
        portalMode === 'director_portal' ? '/api/director/bootstrap' : '/api/state'
      );
      setState(data);
      setApiActor(data.activeUserRole, data.activeUserName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setLoading(false);
    }
  }, [portalMode]);

  useEffect(() => {
    // DirectorPortal verifies the HttpOnly session with /director/me first and
    // then requests bootstrap. Avoid two concurrent bootstrap/me requests on F5,
    // which can race with rotating the director session cookie.
    if (portalMode === 'director_portal') {
      setLoading(false);
      return;
    }

    refreshState();

    if (portalMode !== 'tournament_system') {
      return;
    }

    // Staff realtime stream. Public and Director portals use their scoped streams.
    const evtSource = new EventSource('/api/tournament/events', { withCredentials: true });
    evtSource.addEventListener('connected', () => {
      setSseConnected(true);
    });
    evtSource.addEventListener('state_sync', (e) => {
      try {
        const next = JSON.parse((e as MessageEvent).data) as SystemStatePayload;
        setState((prev) => ({
          ...next,
          // Keep current tab's selected role if user switched locally
          activeUserRole: prev.activeUserRole,
          activeUserName: prev.activeUserName,
        }));
      } catch {
        // ignore malformed frame
      }
    });
    evtSource.addEventListener('match_update', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as
          | MatchRecord
          | { match: MatchRecord };
        const updatedMatch = 'match' in payload ? payload.match : payload;
        if (!updatedMatch?.id) return;
        setState((prev) => ({
          ...prev,
          matches: prev.matches.some((m) => m.id === updatedMatch.id)
            ? prev.matches.map((m) => (m.id === updatedMatch.id ? updatedMatch : m))
            : [...prev.matches, updatedMatch],
        }));
      } catch {
        // ignore
      }
    });
    evtSource.addEventListener('draw_published', () => {
      void refreshState();
    });
    evtSource.addEventListener('draw_lock_changed', () => {
      void refreshState();
    });
    evtSource.onerror = () => {
      setSseConnected(false);
    };

    // Instant same-browser tab sync
    if ('BroadcastChannel' in window) {
      bcRef.current = new BroadcastChannel('lm_tournament_sync');
      bcRef.current.onmessage = (ev) => {
        if (ev.data?.type === 'match_update' && ev.data.match) {
          const m = ev.data.match as MatchRecord;
          setState((prev) => ({
            ...prev,
            matches: prev.matches.map((item) => (item.id === m.id ? m : item)),
          }));
        }
      };
    }

    return () => {
      evtSource.close();
      bcRef.current?.close();
    };
  }, [refreshState, portalMode]);

  const switchRole = useCallback(
    async (role: UserRole, name: string) => {
		// Production roles are bound to the authenticated server session.
		notify('warning', `ไม่สามารถสลับเป็น ${name} โดยไม่เข้าสู่ระบบด้วยบัญชีนั้น`);
    },
    [notify]
  );

  const hasPermission = useCallback(
    (perm: PermissionKey) => {
      const rolePerms = state.rolePermissions[state.activeUserRole];
      return Boolean(rolePerms?.[perm]);
    },
    [state.rolePermissions, state.activeUserRole]
  );

  const applyOptimisticMatch = useCallback((match: MatchRecord) => {
    setState((prev) => ({
      ...prev,
      matches: prev.matches.map((m) => (m.id === match.id ? match : m)),
    }));
    bcRef.current?.postMessage({ type: 'match_update', match });
  }, []);

  const requestConfirm = useCallback((opts: ConfirmOptions) => {
    setConfirmState(opts);
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmState(null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        loading,
        error,
        sseConnected,
        theme,
        toggleTheme,
        lang,
        setLang,
        portalMode,
        setPortalMode,
        sidebarOpen,
        toggleSidebar,
        selectedTournamentId,
        setSelectedTournamentId,
        publicInitialTab,
        setPublicInitialTab,
        publicFocusMatchId,
        setPublicFocusMatchId,
        isPublicKiosk,
        setIsPublicKiosk,
        publicLookupCode,
        setPublicLookupCode,
        refreshState,
        switchRole,
        hasPermission,
        notify,
        toasts,
        dismissToast,
        confirmState,
        requestConfirm,
        closeConfirm,
        applyOptimisticMatch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
