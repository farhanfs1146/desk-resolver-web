import { httpResource } from '@angular/common/http';
import { Injectable, Signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { TicketStatsResponse } from './models';

const STATS = `${environment.apiBaseUrl}/tickets/stats`;

/**
 * `GET /api/tickets/stats` - the one request the dashboard's figures come from.
 *
 * <p><strong>Why a server endpoint rather than counting here.</strong> Every number on the dashboard
 * was obtainable from the ticket list already: one request per status, one per priority, three more
 * for the scalars, reading `X-Total-Count` off each. That is fourteen round trips to draw one screen,
 * and the fourteen answers are not a snapshot of anything - a ticket resolved between the third and
 * the ninth makes the headline figure disagree with the chart beside it. The server answers all of it
 * from three queries in one transaction.
 *
 * <p>An `httpResource` rather than an observable, for the same reasons `Tickets.list` is one: loading
 * and error state as signals, and a `reload()` the screen's refresh button can call. There is no
 * query to vary, so the only input is whether to ask at all.
 */
@Injectable({ providedIn: 'root' })
export class Stats {
  /**
   * The dashboard's counts.
   *
   * <p>`enabled` exists for the same reason `Tickets.list` takes an optional query: a resource whose
   * request function returns `undefined` makes no request. A caller that is not yet entitled to ask -
   * no session, or no ticket-read permission - therefore stays silent instead of firing a 401 that
   * the interceptor would spend a refresh token on.
   */
  summary(enabled: Signal<boolean>) {
    return httpResource<TicketStatsResponse>(() => (enabled() ? STATS : undefined));
  }
}
