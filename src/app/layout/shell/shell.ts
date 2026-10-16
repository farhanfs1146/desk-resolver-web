import { BreakpointObserver } from '@angular/cdk/layout';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { NotificationCentre, NotificationLine } from '../../core/notifications';
import { Auth } from '../../core/auth/auth';
import { Theme } from '../../core/theme';
import {
  CommandPalette,
  CommandPaletteData,
  PaletteChoice,
} from '../command-palette/command-palette';
import { SearchTrigger } from '../command-palette/search-trigger';

/** One navigation destination. `exact` exists only for `/tickets`, for the reason noted below. */
interface NavLink {
  path: string;
  label: string;
  icon: string;
  exact: boolean;
}

/** A labelled group of links. A group the user may follow nothing in is dropped, not emptied. */
interface NavSection {
  label: string;
  links: NavLink[];
}

const RAIL_COLLAPSED_KEY = 'deskresolver.railCollapsed';

/**
 * The frame around every signed-in screen: a navigation rail, a header, and an outlet.
 *
 * <p>It wraps the authenticated routes rather than the whole application, because the sign-in screen
 * is full-page and must not render chrome around itself - and because the navigation is built from
 * permissions, which the sign-in screen by definition has none of.
 *
 * <p>The rail has three states, not two, and they are driven by different things. On a wide viewport
 * it is either full or collapsed to icons, which is the user's choice and is remembered. Below
 * 1024px it is neither: it becomes an overlay drawer that starts closed, because a persistent rail
 * at that width leaves a ticket table too narrow to read. The stored collapse preference is
 * deliberately not consulted there - it answers a question the narrow layout does not ask.
 */
@Component({
  selector: 'app-shell',
  imports: [
    DatePipe,
    MatBadgeModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SearchTrigger,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly dialogs = inject(MatDialog);

  protected readonly theme = inject(Theme);
  protected readonly notifications = inject(NotificationCentre);

  protected readonly identity = this.auth.identity;

  /**
   * True below 1024px. `requireSync` because `BreakpointObserver` emits the current state on
   * subscribe, so there is no first frame at the wrong width to flash through.
   */
  protected readonly compact = toSignal(
    this.breakpoints.observe('(max-width: 1023px)').pipe(map((state) => state.matches)),
    { requireSync: true },
  );

  private readonly collapsedPreference = signal(readCollapsed());

  /** Icons only. Never true on a compact viewport, where the drawer is the answer instead. */
  protected readonly collapsed = computed(() => !this.compact() && this.collapsedPreference());

  protected readonly drawerOpen = signal(false);

  /**
   * Which screen is open, for the header's title and breadcrumb.
   *
   * <p>Reading `routerState.snapshot` is not reactive, so the navigation signal is read first and is
   * what re-runs this. The snapshot is then current by definition, because `NavigationEnd` is the
   * event that makes it so.
   */
  private readonly navigated = toSignal(
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    { initialValue: null },
  );

  protected readonly crumb = computed(() => {
    this.navigated();

    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }

    return {
      heading: (route.data['heading'] as string | undefined) ?? 'DeskResolver',
      icon: (route.data['icon'] as string | undefined) ?? 'dashboard',
      parent: route.data['parent'] as string | undefined,
    };
  });

  /**
   * The links this user may follow, grouped.
   *
   * <p>Derived from permissions rather than listed statically, so a link never leads somewhere that
   * answers 403. Only screens that exist appear here; a link to an unbuilt feature is worse than no
   * link, because the dead end reads as a fault in the application.
   */
  protected readonly sections = computed<NavSection[]>(() => {
    const workspace: NavLink[] = [];
    const administration: NavLink[] = [];

    if (this.auth.hasAny('TICKET_READ_OWN', 'TICKET_READ_ALL')) {
      // First, because it is where the empty path now lands. Gated on the ticket-read pair rather
      // than listed unconditionally: the whole screen is counts of tickets, so a caller who may read
      // none of them has nothing to be shown there.
      workspace.push({
        path: '/dashboard',
        label: 'Dashboard',
        icon: 'space_dashboard',
        exact: false,
      });

      // `exact`, uniquely. Every other ticket route is a child of this path, so without it the list
      // would stay highlighted while the detail screen is open and two items would look selected.
      workspace.push({
        path: '/tickets',
        label: 'Tickets',
        icon: 'confirmation_number',
        exact: true,
      });
    }

    if (this.auth.has('TICKET_CREATE')) {
      workspace.push({
        path: '/tickets/new',
        label: 'Raise a ticket',
        icon: 'add_circle',
        exact: false,
      });
    }

    if (this.auth.has('USER_READ')) {
      administration.push({ path: '/admin/users', label: 'People', icon: 'group', exact: false });
    }

    // Narrower than the route's own guard, deliberately. `APPLICATION_READ` is held by everyone,
    // because raising a ticket needs the catalogue - so gating the link on it would put an
    // administration screen in front of every requester, who reaches the same list through the
    // ticket form anyway. These two are the roles with a reason to open it directly.
    if (this.auth.hasAny('APPLICATION_MANAGE', 'TICKET_READ_ALL')) {
      administration.push({
        path: '/admin/applications',
        label: 'Applications',
        icon: 'widgets',
        exact: false,
      });
    }

    return [
      { label: 'Workspace', links: workspace },
      { label: 'Administration', links: administration },
    ].filter((section) => section.links.length > 0);
  });

  /** First letter of each of the first two names - enough for an avatar, and never an image to load. */
  protected readonly initials = computed(() => {
    const name = this.identity()?.fullName?.trim();
    if (!name) {
      return '?';
    }
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  // --------------------------------------------------------------------------- the command palette

  /**
   * The open palette, or null. Held only so that a second Ctrl+K cannot stack a dialog on the first.
   *
   * <p>A plain field rather than a signal: nothing renders from it, and the template has no reason
   * to know whether the palette is open - the dialog is its own overlay.
   */
  private paletteRef: MatDialogRef<CommandPalette, PaletteChoice> | null = null;

  /**
   * Whether the palette should offer to search tickets, as opposed to only going places.
   *
   * <p>The same pair the Tickets link is gated on. Offering a search that can only answer 403 would
   * be an invitation to a dead end.
   */
  protected readonly canSearchTickets = computed(() =>
    this.auth.hasAny('TICKET_READ_OWN', 'TICKET_READ_ALL'),
  );

  constructor() {
    // Close the drawer whenever the route changes. Without this, following a link on a phone leaves
    // the new screen behind an open overlay, which reads as the tap not having worked.
    effect(() => {
      this.navigated();
      this.drawerOpen.set(false);
    });
  }

  /**
   * Ctrl+K, or Cmd+K, from anywhere inside the shell.
   *
   * <p>On `document` rather than on the host element, because the shortcut has to work wherever the
   * focus happens to be - including inside a text field, which is the normal case while somebody is
   * part-way through filling in a ticket.
   *
   * <p>`preventDefault` is not optional here. Ctrl+K is Firefox's shortcut for focusing its own
   * search bar and Chrome's for putting the address bar into search mode, so without it the browser
   * takes the keystroke and the palette opens behind a focused address bar.
   */
  @HostListener('document:keydown', ['$event'])
  protected onShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
      return;
    }

    event.preventDefault();
    this.openPalette();
  }

  /**
   * Opens the palette on the destinations the rail has already decided this user may reach.
   *
   * <p>`sections()` is reused rather than a second list being written here, and that is the point:
   * what a user may open is decided once. A palette with its own copy would be a second answer to
   * the same question, and the half that was wrong would be the one nobody looks at.
   */
  protected openPalette(): void {
    if (this.paletteRef) {
      return;
    }

    const data: CommandPaletteData = {
      destinations: this.sections().flatMap((section) =>
        section.links.map((link) => ({
          path: link.path,
          label: link.label,
          icon: link.icon,
          group: section.label,
        })),
      ),
      canSearchTickets: this.canSearchTickets(),
    };

    this.paletteRef = this.dialogs.open<CommandPalette, CommandPaletteData, PaletteChoice>(
      CommandPalette,
      {
        data,
        width: '34rem',
        maxWidth: '92vw',
        // High on the screen rather than centred. A dialog that grows and shrinks as its list
        // filters would otherwise walk up and down the viewport while being typed into.
        position: { top: '12vh' },
        panelClass: 'palette-panel',
        autoFocus: 'first-tabbable',
      },
    );

    this.paletteRef.afterClosed().subscribe((choice) => {
      this.paletteRef = null;
      if (choice) {
        this.act(choice);
      }
    });
  }

  /**
   * Carries out whatever the palette was closed with.
   *
   * <p>Here rather than inside the palette, which returns a choice and acts on nothing. That keeps
   * the dialog testable without a router, and it keeps the two kinds of choice beside each other
   * where the difference between them is visible.
   */
  private act(choice: PaletteChoice): void {
    if (choice.kind === 'navigate') {
      void this.router.navigateByUrl(choice.path);
      return;
    }

    // No `replaceUrl`. A palette search is one deliberate act rather than a keystroke, so there is
    // no history to spam - and Back should return the reader to wherever they searched from.
    void this.router.navigate(['/tickets'], { queryParams: { q: choice.term } });
  }

  protected toggleRail(): void {
    if (this.compact()) {
      this.drawerOpen.update((open) => !open);
      return;
    }

    const next = !this.collapsedPreference();
    this.collapsedPreference.set(next);
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
    } catch {
      // Storage blocked. The rail still collapses for this page; it just will not be remembered,
      // which is not worth failing a click over.
    }
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  /**
   * Opens a notification: marks it read, then goes to the ticket.
   *
   * <p>In that order, and both unconditionally. Marking read first means the badge is already
   * falling as the navigation starts, and the server is idempotent about it, so a second click on a
   * notification already read is harmless.
   *
   * <p>The navigation is not conditional on the mark succeeding. They are independent - one is
   * bookkeeping about what the reader has seen, the other is what they actually asked for - and
   * refusing to open a ticket because a PATCH failed would be the wrong way round.
   */
  protected openNotification(line: NotificationLine): void {
    if (line.unread) {
      this.notifications.markRead(line.id);
    }
    void this.router.navigate(line.ticketId === null ? ['/tickets'] : ['/tickets', line.ticketId]);
  }

  protected signOut(): void {
    this.auth.logout().subscribe(() => {
      void this.router.navigateByUrl('/login');
    });
  }
}

/** Defaults to expanded. Wrapped because reading storage throws outright when site data is blocked. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}
