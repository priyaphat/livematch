export const POS_UI_SIZE_MIN = 80;
export const POS_UI_SIZE_MAX = 120;
export const POS_UI_SIZE_STEP = 10;

export const normalizePosUISize = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  const stepped = Math.round(numeric / POS_UI_SIZE_STEP) * POS_UI_SIZE_STEP;
  return Math.min(POS_UI_SIZE_MAX, Math.max(POS_UI_SIZE_MIN, stepped));
};

export const posUISizeToRootFontPixels = (size: number): number => 16 * (normalizePosUISize(size) / 100);
