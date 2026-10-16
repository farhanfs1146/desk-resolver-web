import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth-interceptor';
import { Auth } from './core/auth/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    /**
     * Every `<mat-icon>` renders from Material Symbols Rounded rather than the legacy Material Icons
     * font, which `index.html` is what actually loads.
     *
     * <p>Set once here rather than as a `fontSet` on each icon, because the two fonts do not share an
     * icon set and a mixture is visibly inconsistent - different stroke weights and corner radii
     * side by side. It also means a missing glyph is missing everywhere rather than only on the
     * icons somebody remembered to annotate.
     *
     * <p><strong>The names are not interchangeable.</strong> Material Symbols dropped the legacy
     * `_outline` suffix in favour of a variable `FILL` axis, so the old outline names have no glyph
     * in this font and would render as their own ligature text instead - a literal
     * "chat_bubble_outline" in the middle of a thread. Four icons were renamed to their Symbols
     * equivalents when this changed; `styles.scss` is where the axis itself is set.
     */
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-rounded' },
    },

    // withComponentInputBinding lets a route param arrive as a component input(), so a detail
    // component declares `id = input.required<number>()` instead of reading ActivatedRoute itself.
    provideRouter(routes, withComponentInputBinding()),

    provideHttpClient(withInterceptors([authInterceptor])),

    /**
     * Spend the stored refresh token before the first route renders.
     *
     * <p>Blocking startup on this is the point. The access token lives only in memory, so after a
     * reload the application holds nothing - and `authGuard` would send a user with a perfectly good
     * refresh token in storage to the login screen. Resolving this first means routing begins with
     * the session either rebuilt or known to be gone.
     *
     * <p>It costs one request on a cold load, and only when a refresh token is actually stored.
     * `Auth.restore` never rejects, so a dead session delays startup rather than breaking it.
     */
    provideAppInitializer(() => firstValueFrom(inject(Auth).restore())),
  ],
};
