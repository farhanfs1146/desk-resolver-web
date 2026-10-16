import { Routes } from '@angular/router';

import { authGuard, guestGuard, permissionGuard } from './core/auth/auth-guard';

/**
 * Every route is lazy, and everything a signed-in user reaches sits inside the shell.
 *
 * <p>The nesting is what keeps the login screen free of chrome: it is a sibling of the shell rather
 * than a child, so it renders full-page, while the shell's toolbar and navigation exist only where
 * there is a session to build them from.
 *
 * <p>`authGuard` on the shell covers every child, so a child route only declares a guard when it
 * needs a *permission* on top of a session.
 *
 * <p>Each child also carries `data: { heading, icon, parent? }`, which the shell's header reads for
 * its breadcrumb and title. That duplicates part of `title`, deliberately: `title` is one sentence
 * written for the browser tab, while the header needs the pieces separately and without the
 * " - DeskResolver" suffix. Parsing the tab title back apart would couple the two in the one
 * direction that breaks silently the next time a title is reworded.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in - DeskResolver',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'forbidden',
    title: 'No access - DeskResolver',
    loadComponent: () => import('./features/errors/forbidden/forbidden').then((m) => m.Forbidden),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
    children: [
      {
        // The landing screen, which is why the empty-path redirect at the bottom of this list now
        // points here instead of at `tickets`.
        //
        // Guarded by the same pair as the ticket list, because that is what its figures are counts
        // of - `GET /api/tickets/stats` asserts `TICKET_READ_OWN` and applies the same ownership
        // restriction. Keeping the guards identical is what makes the redirect safe: a caller who
        // cannot open the dashboard could not have opened the tickets screen either, so nobody
        // reaches /forbidden who would previously have landed somewhere useful.
        path: 'dashboard',
        title: 'Dashboard - DeskResolver',
        data: { heading: 'Dashboard', icon: 'space_dashboard' },
        canActivate: [permissionGuard('TICKET_READ_OWN', 'TICKET_READ_ALL')],
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'tickets',
        title: 'Tickets - DeskResolver',
        data: { heading: 'Tickets', icon: 'confirmation_number' },
        // Either permission is enough to open the list; which one the caller holds changes what the
        // server returns, not whether they may ask.
        canActivate: [permissionGuard('TICKET_READ_OWN', 'TICKET_READ_ALL')],
        loadComponent: () =>
          import('./features/tickets/ticket-list/ticket-list').then((m) => m.TicketList),
      },
      {
        // **Before `tickets/:id`, and that order is load-bearing.** The router takes the first
        // match, so with these swapped `/tickets/new` would resolve to the detail screen with the
        // id "new" - which parses to NaN and renders "not a valid ticket reference".
        path: 'tickets/new',
        title: 'Raise a ticket - DeskResolver',
        data: { heading: 'Raise a ticket', icon: 'add_circle', parent: 'Tickets' },
        canActivate: [permissionGuard('TICKET_CREATE')],
        loadComponent: () =>
          import('./features/tickets/ticket-create/ticket-create').then((m) => m.TicketCreate),
      },
      {
        path: 'tickets/:id',
        title: 'Ticket - DeskResolver',
        data: { heading: 'Ticket', icon: 'confirmation_number', parent: 'Tickets' },
        canActivate: [permissionGuard('TICKET_READ_OWN', 'TICKET_READ_ALL')],
        loadComponent: () =>
          import('./features/tickets/ticket-detail/ticket-detail').then((m) => m.TicketDetail),
      },
      {
        // `USER_READ`, not `USER_MANAGE`: support staff legitimately need the directory to find an
        // assignee. What they cannot do is add an account or change roles, and the screen hides
        // those controls rather than the whole page.
        path: 'admin/users',
        title: 'People - DeskResolver',
        data: { heading: 'People', icon: 'group', parent: 'Administration' },
        canActivate: [permissionGuard('USER_READ')],
        loadComponent: () => import('./features/admin/user-list/user-list').then((m) => m.UserList),
      },
      {
        // `APPLICATION_READ` is held by everyone, because raising a ticket needs the catalogue. So
        // the guard is loose on purpose and the *navigation* is what is narrow - see Shell.links.
        // Reaching this by URL as a requester shows a read-only table, which is harmless.
        path: 'admin/applications',
        title: 'Applications - DeskResolver',
        data: { heading: 'Applications', icon: 'widgets', parent: 'Administration' },
        canActivate: [permissionGuard('APPLICATION_READ')],
        loadComponent: () =>
          import('./features/admin/application-list/application-list').then(
            (m) => m.ApplicationList,
          ),
      },
      {
        path: 'account',
        title: 'My access - DeskResolver',
        data: { heading: 'My access', icon: 'badge' },
        loadComponent: () => import('./features/account/account').then((m) => m.Account),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  // Unknown paths go to the start rather than a 404 screen: this is an internal tool reached from
  // bookmarks and pasted links, and the guard decides whether "the start" is the app or login.
  { path: '**', redirectTo: '' },
];
