import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Permission } from '../api/models';
import { Auth } from './auth';

/**
 * Requires a session, and remembers where the user was going.
 *
 * <p>`returnUrl` matters more than it looks: without it, somebody opening a link to a specific ticket
 * while signed out lands on their dashboard after logging in and has to find the ticket again.
 *
 * <p>This can trust {@link Auth.isAuthenticated} because the application does not start routing until
 * {@link Auth.restore} has resolved - see `app.config.ts`. Were that not so, every reload would
 * bounce the user to the login screen while a perfectly good refresh token sat in storage.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};

/**
 * The inverse: keeps a signed-in user off the login screen.
 *
 * <p>Reaching it with a live session and submitting the form would open a *second* login family on
 * the server, orphaning the first - its refresh token stays valid for the rest of the window with
 * nothing holding it. Redirecting instead means one browser tab maps to one login.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.isAuthenticated() ? router.createUrlTree(['/']) : true;
};

/**
 * Requires any one of the given permissions on top of a session.
 *
 * <p>Any, not all: permissions across a user's roles are a union, and a screen usually has more than
 * one way to be entitled to it. The ticket list is reachable with `TICKET_READ_OWN` *or*
 * `TICKET_READ_ALL`, and which one the caller holds changes what the server returns, not whether
 * they may ask.
 *
 * <p><strong>This hides screens; it does not protect them.</strong> Every endpoint asserts its own
 * permission and a crafted request gets a 403 whatever the router allowed. The point is that a user
 * is never shown a page that can only fail - and because the permission list arrives in the login
 * response, deciding that costs no extra request.
 */
export function permissionGuard(...permissions: Permission[]): CanActivateFn {
  return (route, state) => {
    const auth = inject(Auth);
    const router = inject(Router);

    const session = authGuard(route, state);
    if (session !== true) {
      return session;
    }

    if (auth.hasAny(...permissions)) {
      return true;
    }

    // Signed in but not entitled. Not the login screen - re-authenticating cannot grant a permission,
    // and sending them there would read as "your session expired", which is a lie.
    return router.createUrlTree(['/forbidden']);
  };
}
