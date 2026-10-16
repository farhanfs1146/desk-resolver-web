import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { PRIORITIES, Priority, TICKET_STATUSES, TicketStatus } from '../../../core/api/models';
import { pageFromHeaders } from '../../../core/api/page';
import { TicketQuery, Tickets } from '../../../core/api/tickets';
import { Auth } from '../../../core/auth/auth';

/**
 * Which rows to ask for - not the same question as which rows the server will return.
 *
 * <p>`involved` sends no ownership parameter at all, which is the API's own default. For somebody
 * holding only `TICKET_READ_OWN` that *is* everything they can see; for support staff it is
 * genuinely every ticket. Hence the label is chosen per permission rather than fixed - calling it
 * "all tickets" for everyone would be untrue for most users.
 */
type Scope = 'involved' | 'raised' | 'assigned';

/** Only what `TicketPageRequests.SORTABLE` accepts. Anything else is a 400 from the API. */
const SORTABLE = new Set(['createdAt', 'updatedAt', 'priority', 'status', 'ticketNumber', 'id']);

@Component({
  selector: 'app-ticket-list',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
  ],
  templateUrl: './ticket-list.html',
  styleUrl: './ticket-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketList {
  private readonly tickets = inject(Tickets);
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = PRIORITIES;

  protected readonly status = signal<TicketStatus | null>(null);
  protected readonly priority = signal<Priority | null>(null);
  protected readonly scope = signal<Scope>('involved');

  /**
   * The search term, read from `?q=` rather than held in a signal of its own.
   *
   * <p>Every other filter here is component state, and that is still right for them: they are how
   * one person is looking through a queue at this moment. The search is different in two ways. It is
   * typed into the header, which is outside this component - and a set of results is the kind of
   * thing people paste to each other. The URL answers both at once, so neither needs a service
   * between the two components.
   *
   * <p>`requireSync` because `queryParamMap` emits the current parameters on subscribe. Without it
   * the first render would be an unfiltered request for a URL that *does* have a term, and somebody
   * following a link to a search would watch the whole queue flash past before their results
   * arrived.
   *
   * <p>Stripped here as well as on the server. The same URL has to produce the same request, and
   * `?q=%20` would otherwise be a different signal value from `?q=` while meaning the same thing.
   */
  protected readonly search = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('q')?.trim() ?? '')),
    { requireSync: true },
  );

  /**
   * Zero-based, and reset to the first page whenever the search changes.
   *
   * <p>A `linkedSignal` rather than an effect, because that is the shape of this exactly: the page
   * number is *derived* from the search - a new one starts at the beginning - and then written over
   * by the paginator. Without the reset, paging through one term and then searching another would
   * ask for page 4 of a result set with one page in it; the API answers that with an empty body, and
   * an empty body reads as "no tickets" rather than as "wrong page".
   */
  protected readonly pageIndex = linkedSignal<string, number>({
    source: this.search,
    computation: () => 0,
  });
  // 25 rather than the API's default of 20, and capped at the API's maximum of 100 in the template.
  protected readonly pageSize = signal(25);
  protected readonly sort = signal<Sort>({ active: 'createdAt', direction: 'desc' });

  /** True when this user sees other people's tickets, which decides both columns and wording. */
  protected readonly seesEveryTicket = computed(() => this.auth.has('TICKET_READ_ALL'));

  protected readonly canCreate = computed(() => this.auth.has('TICKET_CREATE'));

  protected readonly scopeLabel = computed(() =>
    this.seesEveryTicket() ? 'All tickets' : 'Everything I can see',
  );

  protected readonly query = computed<TicketQuery>(() => {
    const userId = this.auth.identity()?.userId;
    const scope = this.scope();
    const { active, direction } = this.sort();

    return {
      status: this.status() ?? undefined,
      priority: this.priority() ?? undefined,
      raisedBy: scope === 'raised' ? userId : undefined,
      assignedTo: scope === 'assigned' ? userId : undefined,
      // Empty means absent. `toParams` would drop it anyway; saying so here keeps the query value
      // itself honest, so two screens with no search produce the same object rather than two that
      // differ in a field that does nothing.
      q: this.search() || undefined,
      page: this.pageIndex(),
      size: this.pageSize(),
      // Only a sort the API accepts, and only when a direction is set: clicking a sort header a
      // third time clears it, and `sort=createdAt,` would be a 400 rather than a reset to default.
      sort: direction && SORTABLE.has(active) ? `${active},${direction}` : undefined,
    };
  });

  private readonly resource = this.tickets.list(this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  protected readonly page = computed(() =>
    pageFromHeaders(this.resource.headers(), this.resource.value() ?? []),
  );

  /**
   * The line under the title: how many rows there are, and whose.
   *
   * <p>The count is `X-Total-Count`, not the rows on screen, so it describes the result set rather
   * than the page. The reach is worded from the permission for the reason {@link Scope} gives -
   * "across every application" is a claim only `TICKET_READ_ALL` makes true.
   *
   * <p>The headers check is not redundant with `loading()`: a reload keeps the previous count, and
   * only a first load has nothing to state. Without it the line would read "0 tickets" for the
   * length of the opening request.
   */
  protected readonly scopeNote = computed(() => {
    const reach = this.seesEveryTicket()
      ? 'across every application'
      : 'you raised or were assigned';

    if (this.resource.headers() === undefined) {
      return `Tickets ${reach}`;
    }

    const total = this.page().totalCount;
    const matching = this.filtersApplied() ? ' matching these filters' : '';
    return `${total} ticket${total === 1 ? '' : 's'}${matching} ${reach}`;
  });

  protected readonly columns = computed(() => {
    const shown = ['ticketNumber', 'title', 'status', 'priority', 'application'];
    // "Raised by" shown to somebody who only sees their own tickets would be a column of their own
    // name repeated down the page.
    if (this.seesEveryTicket()) {
      shown.push('raisedBy');
    }
    return [...shown, 'assignedTo', 'createdAt'];
  });

  protected readonly filtersApplied = computed(
    () =>
      this.status() !== null ||
      this.priority() !== null ||
      this.scope() !== 'involved' ||
      this.search() !== '',
  );

  protected onSortChange(sort: Sort): void {
    this.sort.set(sort);
    this.pageIndex.set(0);
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  /** Any filter change returns to page one - page 4 of a narrower result set is usually empty. */
  protected onFilterChange(): void {
    this.pageIndex.set(0);
  }

  protected clearFilters(): void {
    this.status.set(null);
    this.priority.set(null);
    this.scope.set('involved');
    this.pageIndex.set(0);
    this.clearSearch();
  }

  /**
   * Drops `?q=` from the URL, which empties the header's box too - it reads the same parameter, so
   * there is no second piece of state to keep in step.
   *
   * <p>`replaceUrl` because abandoning a search is not a place to come back to: Back from here should
   * lead wherever the reader was before the list, not into the search they just dismissed.
   */
  protected clearSearch(): void {
    if (this.search() === '') {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  protected reload(): void {
    this.resource.reload();
  }

  /** Lower-cased for a CSS class, so the palette lives in the stylesheet rather than in here. */
  protected tone(value: string | undefined): string {
    return (value ?? 'unknown').toLowerCase();
  }

  /** `UNDER_REVIEW` is not something to put in front of a person. */
  protected humanise(value: string | undefined): string {
    if (!value) {
      return '—';
    }
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
