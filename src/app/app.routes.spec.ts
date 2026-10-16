import { Route } from '@angular/router';

import { routes } from './app.routes';

/** The children of the shell, which is where every signed-in screen lives. */
function shellChildren(): Route[] {
  const shell = routes.find((route) => route.path === '' && route.children);
  return shell?.children ?? [];
}

describe('routes', () => {
  it('matches /tickets/new before /tickets/:id', () => {
    const children = shellChildren();
    const create = children.findIndex((route) => route.path === 'tickets/new');
    const detail = children.findIndex((route) => route.path === 'tickets/:id');

    expect(create).toBeGreaterThanOrEqual(0);
    expect(detail).toBeGreaterThanOrEqual(0);

    // The router takes the first match. Swapped, `/tickets/new` would resolve to the detail screen
    // with the id "new", which parses to NaN and renders "not a valid ticket reference" - a
    // convincing-looking bug produced purely by declaration order, and one nothing else would catch.
    expect(create).toBeLessThan(detail);
  });

  it('keeps the login screen outside the shell', () => {
    // Inside it, the login form would render with a toolbar and navigation built from a session it
    // does not have.
    expect(routes.some((route) => route.path === 'login')).toBe(true);
    expect(shellChildren().some((route) => route.path === 'login')).toBe(false);
  });

  it('guards every screen that needs a permission', () => {
    const unguarded = shellChildren()
      .filter((route) => route.path?.startsWith('tickets'))
      .filter((route) => !route.canActivate?.length);

    // The shell's own authGuard covers "is there a session"; a ticket screen additionally asserts a
    // permission, so one without any guard would be reachable by an account the API refuses.
    expect(unguarded).toEqual([]);
  });
});
