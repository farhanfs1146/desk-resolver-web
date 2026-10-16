import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

import { PRIORITIES, TICKET_STATUSES, TicketStatus } from '../../core/api/models';
import { Stats } from '../../core/api/stats';
import { TicketQuery, Tickets } from '../../core/api/tickets';
import { Auth } from '../../core/auth/auth';

/** One figure in the row under the heading. The hero number is not one of these - see the template. */
interface Tile {
  key: string;
  label: string;
  value: number;
  icon: string;
  hint: string;
  /** Draws it in the error tone. Only ever true for a figure that means somebody must act. */
  alert: boolean;
}

/** One row of a breakdown panel: a labelled bar whose length is its count. */
interface Bar {
  key: string;
  label: string;
  count: number;
  /** Width as a percentage of the largest bar in the same panel - see {@link Dashboard.scale}. */
  percent: number;
  /** Drawn in the de-emphasis tone rather than the accent. Finished work is context, not the point. */
  muted: boolean;
  tooltip: string;
}

/**
 * The landing screen: where the queue stands, and what changed most recently.
 *
 * <p><strong>Every figure here comes from the server, in one request.</strong> The numbers were all
 * obtainable from `GET /api/tickets` already - by asking fourteen times and reading `X-Total-Count`
 * off each answer - and that is the version this replaces rather than an option it rejects: fourteen
 * requests are fourteen moments, so the headline figure and the chart beside it would describe
 * different states of the database whenever anything changed mid-load. `GET /api/tickets/stats`
 * answers all of it from one transaction.
 *
 * <p><strong>What the numbers cover is the server's decision, not this screen's.</strong> A caller
 * holding `TICKET_READ_ALL` gets counts over every ticket; everybody else gets counts over the
 * tickets they raised or are assigned to, because a count is information about rows and an
 * unrestricted one would tell a requester how many tickets exist. The response says which happened in
 * `scopedToMe`, and every heading on this screen is worded from that flag rather than from the
 * permission list - the two agree today, but only one of them is the thing that actually shaped the
 * result.
 *
 * <p><strong>Why the breakdowns are bars and not a pie.</strong> Eight statuses is past the point
 * where colour can carry identity - adjacent hues stop being tellable apart, under colour-vision
 * deficiency especially - so identity is carried by the status pill on each row, which is the same
 * component the ticket list and ticket detail use, and the bar carries only magnitude. That leaves
 * the bar free to say one thing: open work is in the accent tone, finished work in the de-emphasis
 * grey. Nothing on this screen is readable by colour alone.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    RouterLink,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly auth = inject(Auth);
  private readonly statsApi = inject(Stats);
  private readonly tickets = inject(Tickets);

  /**
   * Whether this caller may ask for any of it.
   *
   * <p>Redundant with the route's own guard, and kept anyway: an `httpResource` whose request
   * function returns `undefined` issues no request, and that is the mechanism by which a screen that
   * is torn down mid-navigation, or rendered for a moment before the session settles, stays silent
   * rather than firing a 401 the interceptor would then spend a refresh token answering.
   */
  private readonly entitled = computed(
    () => this.auth.isAuthenticated() && this.auth.hasAny('TICKET_READ_OWN', 'TICKET_READ_ALL'),
  );

  private readonly stats = this.statsApi.summary(this.entitled);

  /**
   * The newest few tickets, from the ordinary list endpoint.
   *
   * <p>No new endpoint for this: the list already pages and sorts, and it already applies the same
   * ownership restriction the statistics do, so six rows of it are six rows this caller may see.
   * `createdAt,desc` is in the API's sortable set - asking for anything outside it is a 400.
   */
  private readonly recentQuery = computed<TicketQuery | undefined>(() =>
    this.entitled() ? { page: 0, size: 6, sort: 'createdAt,desc' } : undefined,
  );

  private readonly recentResource = this.tickets.list(this.recentQuery);

  protected readonly loading = computed(
    () => this.stats.isLoading() || this.recentResource.isLoading(),
  );

  protected readonly failure = this.stats.error;

  protected readonly recent = computed(() => this.recentResource.value() ?? []);
  protected readonly recentFailed = this.recentResource.error;

  protected readonly canCreate = computed(() => this.auth.has('TICKET_CREATE'));

  /**
   * True until the server says otherwise.
   *
   * <p>The direction of that default is the point. Before the response lands this screen does not
   * know whether its figures cover everything, and the honest thing to assume in the meantime is the
   * narrower reading - so a heading never says "across every application" and then correct itself.
   */
  protected readonly scopedToMe = computed(() => this.stats.value()?.scopedToMe ?? true);

  protected readonly openCount = computed(() => this.stats.value()?.open ?? 0);
  protected readonly totalCount = computed(() => this.stats.value()?.total ?? 0);

  /** The line under the hero figure, and the one place the two totals are stated together. */
  protected readonly openNote = computed(() => {
    const total = this.totalCount();
    const reach = this.scopedToMe()
      ? 'you raised or were assigned'
      : 'across every application';
    return `of ${total} ticket${total === 1 ? '' : 's'} ${reach}`;
  });

  protected readonly lede = computed(() =>
    this.scopedToMe()
      ? 'Where your own requests and assignments stand right now.'
      : 'Where the support queue stands right now, across every application.',
  );

  /**
   * The figures beside the hero number.
   *
   * <p>"Unassigned" is omitted for a caller whose counts are restricted to their own involvement,
   * and that is not tidiness: a ticket they raised is visible to them whether or not anybody has
   * picked it up, so the number would be a count of their own waiting requests under a heading that
   * means "nobody has triaged these". It is a triage figure, and it only means that with
   * `TICKET_READ_ALL`.
   */
  protected readonly tiles = computed<Tile[]>(() => {
    const value = this.stats.value();
    const tiles: Tile[] = [
      {
        key: 'overdue',
        label: 'Overdue',
        value: value?.overdue ?? 0,
        icon: 'schedule',
        hint: 'Past the date the requester asked for, and still open',
        alert: (value?.overdue ?? 0) > 0,
      },
    ];

    if (!this.scopedToMe()) {
      tiles.push({
        key: 'unassigned',
        label: 'Unassigned',
        value: value?.unassigned ?? 0,
        icon: 'person_off',
        hint: 'Open work nobody owns yet',
        alert: (value?.unassigned ?? 0) > 0,
      });
    }

    tiles.push(
      {
        key: 'assignedToMe',
        label: 'Assigned to me',
        value: value?.assignedToMe ?? 0,
        icon: 'assignment_ind',
        hint: 'Open tickets in your own queue',
        alert: false,
      },
      {
        key: 'raisedByMe',
        label: 'Raised by me',
        value: value?.raisedByMe ?? 0,
        icon: 'outbox',
        // Worth saying out loud: this is the one figure that keeps settled work, so it does not
        // drop when a request is resolved.
        hint: 'Every request you have raised, resolved ones included',
        alert: false,
      },
    );

    return tiles;
  });

  protected readonly statusBars = computed<Bar[]>(() => {
    const counts = this.stats.value()?.byStatus ?? {};
    const total = this.totalCount();

    return this.scale(
      TICKET_STATUSES.map((status) => ({
        key: status,
        count: counts[status] ?? 0,
        muted: SETTLED.has(status),
      })),
      total,
      'ticket',
    );
  });

  /**
   * Priority, over open work only.
   *
   * <p>The server restricts this one and not the status breakdown, which is worth knowing when
   * reading the two panels side by side: priority describes how urgent outstanding work is, and a
   * year of closed criticals would dominate the panel while saying nothing about today. So these
   * bars sum to the open count, not the total, and the panel's subheading says so.
   */
  protected readonly priorityBars = computed<Bar[]>(() => {
    const counts = this.stats.value()?.byPriority ?? {};

    return this.scale(
      PRIORITIES.map((priority) => ({
        key: priority,
        count: counts[priority] ?? 0,
        muted: false,
      })),
      this.openCount(),
      'open ticket',
    );
  });

  protected readonly hasAnyTicket = computed(() => this.totalCount() > 0);

  protected reload(): void {
    this.stats.reload();
    this.recentResource.reload();
  }

  /** Lower-cased for a CSS class, so the palette stays in the stylesheet. Matches the ticket list. */
  protected tone(value: string | undefined): string {
    return (value ?? 'unknown').toLowerCase();
  }

  protected humanise(value: string | undefined): string {
    return humanise(value);
  }

  /**
   * Turns raw counts into bar rows.
   *
   * <p><strong>Bars are scaled against the largest of them, not against the total.</strong> Scaling
   * to the total is the instinct and it wastes the panel: with eight statuses the longest bar would
   * sit at a third of the width and the small ones would be invisible slivers, so the shape of the
   * queue - which is the only thing a reader is here for - would be unreadable. The exact value is
   * printed at the end of every row regardless, so nothing depends on comparing lengths by eye.
   *
   * <p>`denominator` is used for the percentage in the tooltip only, which is why it is passed
   * separately: the bar's length answers "how does this compare with the others", and the percentage
   * answers "how much of the whole is it". Those are different questions and a bar cannot carry both.
   */
  private scale(
    rows: { key: string; count: number; muted: boolean }[],
    denominator: number,
    noun: string,
  ): Bar[] {
    // At least 1, so an all-zero panel divides by something and every bar renders at zero width
    // rather than NaN.
    const largest = Math.max(1, ...rows.map((row) => row.count));

    return rows.map((row) => {
      const share = denominator > 0 ? Math.round((row.count / denominator) * 100) : 0;
      const label = humanise(row.key);

      return {
        key: row.key,
        label,
        count: row.count,
        percent: (row.count / largest) * 100,
        muted: row.muted,
        tooltip:
          row.count === 0
            ? `No ${noun}s are ${label.toLowerCase()}`
            : `${label}: ${row.count} ${noun}${row.count === 1 ? '' : 's'} (${share}%)`,
      };
    });
  }
}

/**
 * The statuses that mean finished work, matching `TicketStatus.settled()` on the server.
 *
 * <p>A second copy of a definition the API already holds, and it is here rather than inferred
 * because there is nothing to infer it from: the response reports counts per status and says nothing
 * about which of them are terminal. This decides a bar's tone and nothing else - get it wrong and a
 * bar is the wrong shade of grey - so it is not load-bearing the way the server's copy is, which
 * decides what "open" and "overdue" actually count.
 */
const SETTLED = new Set<TicketStatus>(['RESOLVED', 'CLOSED']);

/**
 * `UNDER_REVIEW` is not something to put in front of a person.
 *
 * <p>A seventh copy of this formatter. Six components already carry their own, and extracting them
 * all into one helper is a change to six files that this screen does not need to make - so it
 * follows the convention that exists rather than half-replacing it.
 */
function humanise(value: string | undefined): string {
  if (!value) {
    return '—';
  }
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
