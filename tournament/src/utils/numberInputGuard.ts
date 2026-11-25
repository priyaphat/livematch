let initialized = false;

function isDecimalNumberInput(input: HTMLInputElement): boolean {
  const step = (input.getAttribute('step') || '').trim().toLowerCase();
  return step === 'any' || step.includes('.');
}

function allowNegativeNumberInput(input: HTMLInputElement): boolean {
  const minAttr = input.getAttribute('min');
  if (minAttr !== null && minAttr !== '') {
    const parsed = Number(minAttr);
    if (!Number.isNaN(parsed) && parsed < 0) return true;
  }
  return input.dataset.allowNegative === 'true';
}

function sanitizeNumericString(raw: string, allowDecimal: boolean, allowNegative: boolean): string {
  let out = '';
  let hasDot = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (allowDecimal && ch === '.' && !hasDot) {
      hasDot = true;
      out += ch;
    } else if (allowNegative && ch === '-' && out.length === 0) {
      out += ch;
    }
  }
  return out;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function initNumberInputGuard(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;

  // Ensure mobile devices automatically show numeric keypad on focus
  document.addEventListener(
    'focusin',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
      if (!target.hasAttribute('inputmode')) {
        target.setAttribute('inputmode', isDecimalNumberInput(target) ? 'decimal' : 'numeric');
      }
    },
    true
  );

  // Prevent accidental wheel increment/decrement on focused number inputs
  document.addEventListener(
    'wheel',
    (e) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement &&
        target.type === 'number' &&
        document.activeElement === target
      ) {
        target.blur();
      }
    },
    { passive: true, capture: true }
  );

  // Block non-numeric keys (including e, E, +, -, and . on integer inputs)
  document.addEventListener(
    'keydown',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const allowedControlKeys = [
        'Backspace',
        'Delete',
        'Tab',
        'Escape',
        'Enter',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ];
      if (allowedControlKeys.includes(e.key)) return;

      if (e.key >= '0' && e.key <= '9') return;

      if (e.key === '.' && isDecimalNumberInput(target)) {
        if (!target.value.includes('.')) return;
      }

      if (e.key === '-' && allowNegativeNumberInput(target)) {
        if (!target.value.includes('-')) return;
      }

      e.preventDefault();
    },
    true
  );

  // Block non-digit text insertion via IME, mobile keyboards, or drag-drop
  document.addEventListener(
    'beforeinput',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
      if (!e.data) return;

      const allowDecimal = isDecimalNumberInput(target);
      const allowNegative = allowNegativeNumberInput(target);
      const validPattern = allowDecimal
        ? allowNegative
          ? /^[0-9.-]+$/
          : /^[0-9.]+$/
        : allowNegative
        ? /^[0-9-]+$/
        : /^[0-9]+$/;

      if (!validPattern.test(e.data)) {
        e.preventDefault();
      }
    },
    true
  );

  // Clean pasted content down to digits only (and update React controlled state cleanly)
  document.addEventListener(
    'paste',
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;

      const pasted = e.clipboardData?.getData('text') ?? '';
      const cleaned = sanitizeNumericString(
        pasted,
        isDecimalNumberInput(target),
        allowNegativeNumberInput(target)
      );

      e.preventDefault();
      if (cleaned !== '') {
        setNativeInputValue(target, cleaned);
      }
    },
    true
  );
}
