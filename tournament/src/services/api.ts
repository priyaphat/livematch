import { UserRole } from '../types/tournament';

// Kept for compatibility with older components. Identity and permissions are
// intentionally resolved from the HttpOnly server session, never these values.
export function setApiActor(_role: UserRole, _name: string) {}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function csrfToken() {
  const item = document.cookie.split('; ').find((cookie) => cookie.startsWith('livematch_csrf='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : '';
}

function scopedUrl(url: string) {
  if (!url.startsWith('/api/')) return url;
  if (url.startsWith('/api/auth/') || url.startsWith('/api/tournament/') || url.startsWith('/api/public-tournament/')) return url;
  if (url.startsWith('/api/public/')) {
    const mapped = `/api/public-tournament/${url.slice('/api/public/'.length)}`;
    const token = new URLSearchParams(window.location.search).get('tournament');
    if (!token || mapped.includes('token=')) return mapped;
    return `${mapped}${mapped.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
  if (url.startsWith('/api/director/')) return `/api/auth/tournament/director/${url.slice('/api/director/'.length)}`;
  return `/api/tournament/${url.slice('/api/'.length)}`;
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
	const token = csrfToken();
	const hasBody = options.body !== undefined && !(options.body instanceof FormData);
	const res = await fetch(scopedUrl(url), {
    ...options,
		cache: options.cache ?? 'no-store',
		credentials: 'include',
    headers: {
			...(hasBody ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { 'X-CSRF-Token': token } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  }
  return data as T;
}

export async function stageTournamentFile(url: string, file: Blob, kind: string) {
  const body = new FormData();
  body.append('file', file, `${kind}.jpg`);
  body.append('kind', kind);
  return apiFetch<{ fileId: string; sha256: string; sizeBytes: number }>(url, { method: 'POST', body });
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, encoded] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const bytes = atob(encoded || '');
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

export interface QueuedScoreAction {
  matchId: string;
  eventId: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  expectedVersion?: number;
}

const OFFLINE_QUEUE_KEY = 'lm_tournament_offline_score_queue';
const OFFLINE_DEAD_LETTER_KEY = 'lm_tournament_offline_score_dead_letter';

export function getOfflineScoreQueue(): QueuedScoreAction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function pushOfflineScoreAction(action: QueuedScoreAction) {
  const queue = getOfflineScoreQueue();
  queue.push(action);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export function clearOfflineScoreQueue() {
  localStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export function getOfflineScoreDeadLetters(): Array<QueuedScoreAction & { reason: string; status: number }> {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_DEAD_LETTER_KEY) || '[]');
  } catch {
    return [];
  }
}

export async function flushOfflineScoreQueue(): Promise<number> {
  const queue = getOfflineScoreQueue();
  if (queue.length === 0) return 0;

  const remaining: QueuedScoreAction[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      await apiFetch(`/api/director/matches/${item.matchId}/event`, {
        method: 'POST',
        body: JSON.stringify({
          eventId: item.eventId,
          type: item.type,
          payload: item.payload,
          expectedVersion: item.expectedVersion,
        }),
      });
      flushed += 1;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
				const dead = getOfflineScoreDeadLetters();
				dead.push({ ...item, reason: err.message, status: err.status });
				localStorage.setItem(OFFLINE_DEAD_LETTER_KEY, JSON.stringify(dead.slice(-100)));
				// Keep deterministic failures visible for explicit reconciliation.
        continue;
      }
      remaining.push(item);
    }
  }

  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  return flushed;
}
