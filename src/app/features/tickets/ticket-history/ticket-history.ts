import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { TicketHistoryResponse } from '../../../core/api/models';
import { Tickets } from '../../../core/api/tickets';
import { Auth } from '../../../core/auth/auth';

/**
 * What has happened to this ticket, newest first.
 *
 * <p>Gated on `TICKET_READ_OWN` specifically, which is what `GET /{id}/history` asserts - not on the
 * pair the detail route accepts. A role holding only `TICKET_READ_ALL` can open the ticket and would
 * get a 403 here, so the panel has to make its own decision rather than inherit the route's.
 */
@Component({
  selector: 'app-ticket-history',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './ticket-history.html',
  styleUrl: './ticket-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketHistory {
  readonly ticketId = input.required<number>();

  private readonly tickets = inject(Tickets);
  private readonly auth = inject(Auth);

  protected readonly canRead = computed(() => this.auth.has('TICKET_READ_OWN'));

  private readonly readableTicketId = computed(() =>
    this.canRead() ? this.ticketId() : undefined,
  );

  private readonly resource = this.tickets.history(this.readableTicketId);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  // This endpoint returns a plain list rather than a page - there is no paging on it to honour.
  protected readonly entries = computed(() => this.resource.value() ?? []);

  /**
   * Public because the detail page calls it: a status change or a reassignment adds an entry
   * here, and the request this panel makes does not change, so nothing would refetch on its own.
   */
  reload(): void {
    this.resource.reload();
  }

  /**
   * One line describing a change.
   *
   * <p>Built here rather than in the template because the useful sentence depends on which fields
   * the row actually carries: a field change has an old and a new value, while a creation or an
   * assignment may have neither.
   */
  protected describe(entry: TicketHistoryResponse): string {
    const field = entry.fieldName ? humanise(entry.fieldName) : null;
    const from = entry.oldValue ? humanise(entry.oldValue) : null;
    const to = entry.newValue ? humanise(entry.newValue) : null;

    if (field && from && to) {
      return `${field}: ${from} → ${to}`;
    }
    if (field && to) {
      return `${field} set to ${to}`;
    }
    if (field) {
      return `${field} changed`;
    }
    return humanise(entry.actionType ?? 'Updated');
  }

  protected icon(actionType: string | undefined): string {
    switch ((actionType ?? '').toUpperCase()) {
      case 'CREATED':
        return 'add_circle';
      case 'ASSIGNED':
      case 'REASSIGNED':
        return 'person_add';
      case 'STATUS_CHANGED':
        return 'swap_horiz';
      case 'COMMENTED':
        return 'chat_bubble';
      default:
        return 'edit';
    }
  }
}

/** `UNDER_REVIEW` and `expectedBy` are not things to put in front of a person. */
function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
