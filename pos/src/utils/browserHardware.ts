export type CustomerDisplayConnectionStatus = 'idle' | 'connecting' | 'connected' | 'unsupported';

export interface PresentationConnectionLike extends EventTarget {
  state?: string;
  send(data: string): void;
  close(): void;
  terminate(): void;
}

export interface PresentationRequestLike {
  getAvailability?: () => Promise<{ value: boolean }>;
  start(): Promise<PresentationConnectionLike>;
}

type PresentationRequestConstructor = new (url: string | string[]) => PresentationRequestLike;

export interface ManagedScreenLike {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
  label?: string;
}

export interface ScreenDetailsLike {
  screens: ManagedScreenLike[];
  currentScreen?: ManagedScreenLike;
}

export function getPresentationRequestConstructor(): PresentationRequestConstructor | null {
  return ((window as unknown as { PresentationRequest?: PresentationRequestConstructor }).PresentationRequest) || null;
}

export function getScreenDetailsFunction(): (() => Promise<ScreenDetailsLike>) | null {
  const candidate = (window as unknown as { getScreenDetails?: () => Promise<ScreenDetailsLike> }).getScreenDetails;
  return typeof candidate === 'function' ? candidate.bind(window) : null;
}

export function findSecondaryScreen(details: ScreenDetailsLike): ManagedScreenLike | null {
  if (!Array.isArray(details.screens) || details.screens.length < 2) return null;
  const current = details.currentScreen;
  const isCurrent = (screen: ManagedScreenLike) => screen === current || Boolean(current
    && screen.availLeft === current.availLeft
    && screen.availTop === current.availTop
    && screen.availWidth === current.availWidth
    && screen.availHeight === current.availHeight);
  return details.screens.find((screen) => !isCurrent(screen) && !screen.isPrimary)
    || details.screens.find((screen) => !isCurrent(screen))
    || null;
}

export function customerDisplayWindowFeatures(screen?: ManagedScreenLike | null): string {
  const parts = ['popup=yes', 'menubar=no', 'toolbar=no', 'location=no', 'status=no', 'resizable=yes'];
  if (screen) {
    parts.push(
      `left=${Math.round(screen.availLeft)}`,
      `top=${Math.round(screen.availTop)}`,
      `width=${Math.max(320, Math.round(screen.availWidth))}`,
      `height=${Math.max(240, Math.round(screen.availHeight))}`,
    );
  } else {
    parts.push('width=1024', 'height=768');
  }
  return parts.join(',');
}

export function isAndroidDevice(): boolean {
  const navigatorWithData = navigator as Navigator & { userAgentData?: { platform?: string } };
  return navigatorWithData.userAgentData?.platform?.toLowerCase() === 'android' || /Android/i.test(navigator.userAgent);
}

const EDITABLE_SELECTOR = [
  'input:not([type])',
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="tel"]',
  'input[type="password"]',
  'input[type="number"]',
  'textarea',
].join(',');

const ORIGINAL_INPUT_MODE = 'data-livematch-original-inputmode';
const MISSING_VALUE = '__missing__';

function suppressInputMode(element: Element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
  if (!element.hasAttribute(ORIGINAL_INPUT_MODE)) {
    element.setAttribute(ORIGINAL_INPUT_MODE, element.getAttribute('inputmode') ?? MISSING_VALUE);
  }
  element.setAttribute('inputmode', 'none');
}

function applyToTree(root: ParentNode) {
  if (root instanceof Element && root.matches(EDITABLE_SELECTOR)) suppressInputMode(root);
  root.querySelectorAll(EDITABLE_SELECTOR).forEach(suppressInputMode);
}

function restoreInputModes() {
  document.querySelectorAll(`[${ORIGINAL_INPUT_MODE}]`).forEach((element) => {
    const original = element.getAttribute(ORIGINAL_INPUT_MODE);
    if (original === MISSING_VALUE) element.removeAttribute('inputmode');
    else if (original !== null) element.setAttribute('inputmode', original);
    element.removeAttribute(ORIGINAL_INPUT_MODE);
  });
}

export function enableHardwareKeyboardMode(): () => void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
  applyToTree(document);

  const applyBeforeFocus = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.matches(EDITABLE_SELECTOR)) suppressInputMode(target);
  };
  document.addEventListener('pointerdown', applyBeforeFocus, true);
  document.addEventListener('focusin', applyBeforeFocus, true);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) applyToTree(node);
    }));
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    document.removeEventListener('pointerdown', applyBeforeFocus, true);
    document.removeEventListener('focusin', applyBeforeFocus, true);
    restoreInputModes();
  };
}
