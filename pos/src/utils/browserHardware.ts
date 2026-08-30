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

export function getPresentationRequestConstructor(): PresentationRequestConstructor | null {
  return ((window as unknown as { PresentationRequest?: PresentationRequestConstructor }).PresentationRequest) || null;
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
