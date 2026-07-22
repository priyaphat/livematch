export const themeStorageKey = 'livematch.theme'
export const publicThemeStorageKey = 'livematch.public-booking.theme'

export function normalizeTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light'
}

export function readStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(themeStorageKey))
  } catch {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  }
}

export function persistTheme(theme) {
  const nextTheme = normalizeTheme(theme)
  document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  try {
    localStorage.setItem(themeStorageKey, nextTheme)
  } catch {
    // Theme still applies for the current page when storage is unavailable.
  }
  return nextTheme
}

export function readStoredPublicTheme() {
  try {
    return normalizeTheme(localStorage.getItem(publicThemeStorageKey))
  } catch {
    return 'light'
  }
}

export function persistPublicTheme(theme) {
  const nextTheme = normalizeTheme(theme)
  document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  try {
    localStorage.setItem(publicThemeStorageKey, nextTheme)
  } catch {
    // Public theme still applies when storage is unavailable.
  }
  return nextTheme
}

export function applyStoredTheme() {
  return persistTheme(readStoredTheme())
}
