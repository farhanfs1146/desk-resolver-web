import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';

import { ProblemDetail, UpdateTicketStatusRequest } from '../../../core/api/models';
import { Tickets } from '../../../core/api/tickets';
import { Auth } from '../../../core/auth/auth';
import { AssignDialog, AssignDialogData } from '../assign-dialog/assign-dialog';
import { StatusDialog, StatusDialogData } from '../status-dialog/status-dialog';
import { TicketAttachments } from '../ticket-attachments/ticket-attachments';
import { TicketComments } from '../ticket-comments/ticket-comments';
import { TicketHistory } from '../ticket-history/ticket-history';

@Component({
  selector: 'app-ticket-detail',
  imports: [
    DatePipe,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    RouterLink,
    TicketAttachments,
    TicketComments,
    TicketHistory,
  ],
  templateUrl: './ticket-detail.html',
  styleUrl: './ticket-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketDetail {
  /**
   * The `:id` route parameter, bound by `withComponentInputBinding`.
   *
   * <p>A string, because that is what a URL segment is. Nobody downstream should have to remember
   * that, which is what {@link ticketId} is for.
   */
  readonly id = input.required<string>();

  private readonly tickets = inject(Tickets);
  private readonly auth = inject(Auth);
  private readonly dialogs = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly historyPanel = viewChild(TicketHistory);

  /** `undefined` for a non-numeric id, which suppresses the request rather than asking for `/NaN`. */
  protected readonly ticketId = computed(() => {
    const parsed = Number(this.id());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  });

  private readonly resource = this.tickets.byId(this.ticketId);

  protected readonly ticket = computed(() => this.resource.value());
  protected readonly loading = this.resource.isLoading;

  protected readonly canChangeStatus = computed(() => this.auth.has('TICKET_STATUS_CHANGE'));

  /**
   * Assigning needs two permissions, not one.
   *
   * <p>`TICKET_ASSIGN` allows the change; `USER_READ` is what makes it possible to *choose* an
   * assignee, since the picker is a list of users. A role with the first and not the second could
   * open a dialog with nothing in it, so the button stays hidden instead.
   */
  protected readonly canAssign = computed(
    () => this.auth.has('TICKET_ASSIGN') && this.auth.has('USER_READ'),
  );

  protected readonly working = signal(false);

  /**
   * What went wrong, said in terms the reader can act on.
   *
   * <p>404 and 403 mean genuinely different things here and must not share a message. The API
   * answers 404 for a ticket that exists but is not yours - deliberately, so the list of ticket
   * numbers cannot be probed - so "not found" is the honest wording for both of its causes, while a
   * 403 is about the account rather than the ticket.
   */
  protected readonly failure = computed(() => {
    const error = this.resource.error();
    if (!error) {
      return null;
    }
    if (this.ticketId() === undefined) {
      return { icon: 'link_off', text: 'That is not a valid ticket reference.' };
    }
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return {
          icon: 'search_off',
          text: 'This ticket does not exist, or it is not one you are involved in.',
        };
      }
      if (error.status === 403) {
        return { icon: 'lock', text: 'Your account is not allowed to read this ticket.' };
      }
      if (error.status === 0) {
        return { icon: 'cloud_off', text: 'Cannot reach the server.' };
      }
    }
    return { icon: 'error', text: 'This ticket could not be loaded.' };
  });

  /** An expected-by date in the past, on a ticket nobody has resolved. Worth saying out loud. */
  protected readonly overdue = computed(() => {
    const ticket = this.ticket();
    if (!ticket?.expectedBy || ticket.resolvedAt) {
      return false;
    }
    return new Date(ticket.expectedBy).getTime() < Date.now();
  });

  protected reload(): void {
    this.resource.reload();
  }

  protected changeStatus(): void {
    const ticket = this.ticket();
    const id = this.ticketId();
    if (!ticket || id === undefined) {
      return;
    }

    const data: StatusDialogData = {
      ticketNumber: ticket.ticketNumber ?? `#${id}`,
      current: ticket.status,
    };

    this.dialogs
      .open(StatusDialog, { data })
      .afterClosed()
      .subscribe((request: UpdateTicketStatusRequest | undefined) => {
        if (request) {
          this.apply(this.tickets.changeStatus(id, request), 'Status changed.');
        }
      });
  }

  protected assign(): void {
    const ticket = this.ticket();
    const id = this.ticketId();
    if (!ticket || id === undefined) {
      return;
    }

    const data: AssignDialogData = {
      ticketNumber: ticket.ticketNumber ?? `#${id}`,
      currentAssigneeId: ticket.assignedToId,
      currentAssigneeName: ticket.assignedTo,
    };

    this.dialogs
      .open(AssignDialog, { data })
      .afterClosed()
      .subscribe((userId: number | undefined) => {
        if (userId !== undefined) {
          this.apply(this.tickets.assign(id, userId), 'Ticket assigned.');
        }
      });
  }

  /**
   * Runs an action, then refreshes what it changed.
   *
   * <p>Both actions return the updated ticket, but the history panel also has a new entry and its
   * own request has not changed - so nothing there would refetch on its own. Reloading the ticket
   * rather than trusting the response body keeps one source of truth on screen.
   */
  private apply(action: Observable<unknown>, success: string): void {
    this.working.set(true);
    action.subscribe({
      next: () => {
        this.working.set(false);
        this.resource.reload();
        this.historyPanel()?.reload();
        this.snackBar.open(success, undefined, { duration: 3000 });
      },
      error: (error: unknown) => {
        this.working.set(false);
        this.snackBar.open(describeAction(error), 'Dismiss', { duration: 8000 });
      },
    });
  }

  protected tone(value: string | undefined): string {
    return (value ?? 'unknown').toLowerCase();
  }

  protected humanise(value: string | undefined): string {
    if (!value) {
      return '—';
    }
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}

function describeAction(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.status === 0) {
    return 'Cannot reach the server.';
  }
  const problem = error.error as ProblemDetail | null;
  // The API explains refused transitions in `detail`; it knows the workflow and this screen does not.
  return problem?.detail ?? 'That change was refused.';
}
