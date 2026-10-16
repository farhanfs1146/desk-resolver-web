import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

/** What the user chose, which is not the same as what is on screen - `system` resolves to either. */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'deskresolver.theme';
const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/**
 * The light/dark preference, and the one line of DOM it drives.
 *
 * <p>All it does is write `data-theme` onto `<html>`. Every colour in the application is emitted by
 * `mat.theme()` as a `light-dark()` pair, so the stylesheet's `color-scheme` rules for that attribute
 * are what actually repaint - there is no second palette to load and nothing to recompute. That is
 * also why this holds a *mode* rather than a resolved colour: in `system` the browser decides, and
 * follows the operating system changing under us without this service hearing about it.
 *
 * <p><strong>`localStorage`, unlike the refresh token.</strong> The session is deliberately scoped to
 * the tab (see `core/auth/auth.ts`); a theme is a per-device convenience with nothing sensitive in
 * it, and resetting it every time a tab opens would be a defect rather than a safeguard.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);

  private readonly modeSignal = signal<ThemeMode>(readStored());

  readonly mode = this.modeSignal.asReadonly();

  /** The icon and label for the control that cycles the mode - the header reads both. */
  readonly appearance = computed(() => {
    switch (this.modeSignal()) {
      case 'light':
        return { icon: 'light_mode', label: 'Light theme' };
      case 'dark':
        return { icon: 'dark_mode', label: 'Dark theme' };
      default:
        return { icon: 'contrast', label: 'Matching your system' };
    }
  });

  constructor() {
    // An effect rather than a write inside `set`, so the attribute is also correct on the first
    // paint - the stored mode is read in the field initialiser above, before any caller asks.
    effect(() => {
      this.document.documentElement.dataset['theme'] = this.modeSignal();
    });
  }

  set(mode: ThemeMode): void {
    this.modeSignal.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private browsing, or storage denied. The theme still applies for this page; it simply will
      // not be remembered, which is not worth failing a click over.
    }
  }

  /** light -> dark -> system -> light. The header's single button, rather than three. */
  cycle(): void {
    const next = MODES[(MODES.indexOf(this.modeSignal()) + 1) % MODES.length];
    this.set(next);
  }
}

/**
 * Defaults to `system`, which is the honest answer before anybody has expressed a preference.
 *
 * <p>Wrapped because reading storage *throws* rather than returning null when site data is blocked,
 * and an unreadable preference should start the application, not break it.
 */
function readStored(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}
