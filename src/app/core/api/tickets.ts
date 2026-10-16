import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  CreateTicketRequest,
  TicketFilters,
  TicketHistoryResponse,
  TicketResponse,
  UpdateTicketStatusRequest,
} from './models';
import { PageQuery, toParams } from './page';

/** The filters and paging a ticket list asks for, as one value so it can live in a single signal. */
export type TicketQuery = TicketFilters & PageQuery;

const TICKETS = `${environment.apiBaseUrl}/tickets`;

/**
 * `GET|POST /api/tickets` and its sub-resources.
 *
 * <p>The list is exposed as an `httpResource` factory rather than an `Observable`, for two reasons
 * that both come from how this API reports pages. It returns a **plain JSON array** and puts the
 * metadata in `X-Total-*` headers, and `HttpResourceRef` surfaces those headers as a signal - so a
 * table binds to the rows and the row count from one request without an `observe: 'response'`
 * subscription to manage. It also gives loading and error state and a `reload()` for free, which a
 * filterable table needs anyway.
 *
 * <p>Everything else is imperative, because those are things a user does once rather than state a
 * screen watches.
 */
@Injectable({ providedIn: 'root' })
export class Tickets {
  private readonly http = inject(HttpClient);

  /**
   * A live list that refetches whenever the query signal changes.
   *
   * <p>Must be called from an injection context - a component field initialiser is one. The URL
   * function reads the signal, which is what registers the dependency; returning the parameters
   * separately would not.
   *
   * <p><strong>What the caller does not control is who the rows belong to.</strong> A caller holding
   * `TICKET_READ_ALL` gets every ticket; one holding only `TICKET_READ_OWN` has an ownership
   * predicate forced into the query server-side. Same URL, different result set - so a list must
   * never present its contents as "all tickets" on the strength of having asked for them.
   *
   * <p>A query of `undefined` makes no request at all - which is how a caller that is not yet
   * entitled to ask (no session, or no ticket-read permission) stays silent instead of firing a 401
   * it would then have to hide. `httpResource` treats an undefined request that way by design, and
   * it is the same mechanism {@link byId} uses for an unparsed route parameter.
   */
  list(query: Signal<TicketQuery | undefined>) {
    return httpResource<TicketResponse[]>(() => {
      const value = query();
      return value === undefined ? undefined : { url: TICKETS, params: toParams({ ...value }) };
    });
  }

  byId(id: Signal<number | undefined>) {
    return httpResource<TicketResponse>(() => {
      const value = id();
      return value === undefined ? undefined : `${TICKETS}/${value}`;
    });
  }

  history(ticketId: Signal<number | undefined>) {
    return httpResource<TicketHistoryResponse[]>(() => {
      const value = ticketId();
      return value === undefined ? undefined : `${TICKETS}/${value}/history`;
    });
  }

  create(request: CreateTicketRequest): Observable<TicketResponse> {
    return this.http.post<TicketResponse>(TICKETS, request);
  }

  changeStatus(ticketId: number, request: UpdateTicketStatusRequest): Observable<TicketResponse> {
    return this.http.patch<TicketResponse>(`${TICKETS}/${ticketId}/status`, request);
  }

  /** `PUT /api/tickets/{ticketId}/assign/{userId}` - the assignee is in the path, not a body. */
  assign(ticketId: number, userId: number): Observable<TicketResponse> {
    return this.http.put<TicketResponse>(`${TICKETS}/${ticketId}/assign/${userId}`, {});
  }
}
