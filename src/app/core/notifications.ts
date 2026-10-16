import { Injectable, computed, inject } from '@angular/core';

import { NotificationQuery, Notifications as NotificationsApi } from './api/notifications';
import { NotificationResponse } from './api/models';
import { Auth } from './auth/auth';

/** How urgent a line is, which is all the panel needs to colour it. */
export type NotificationTone = 'error' | 'warning' | 'info' | 'success' | 'neutral';

/** One rendered line in the notification panel. */
export interface NotificationLine {
  id: number;
  icon: string;
  tone: NotificationTone;
  title: string;
  detail: string;
  /** Where clicking goes. Null when there is no single ticket to open. */
  ticketId: number | null;
  unread: boolean;
  at: string | undefined;
}

/** One page is what a panel shows. Older than twenty, and somebody is reading a list, not a bell. */
const PAGE_SIZE = 20;

/**
 * The header's notification bell.
 *
 * <p><strong>This is where the wording lives.</strong> The API stores the type and the values and no
 * sentence - deliberately, because a sentence written into a row could never be reworded, corrected
 * or translated afterwards. So every line a reader sees is built in {@link render} below, and
 * changing how a notification reads is a change to this file and nothing else.
 *
 * <p>It replaced a version of this service that derived the panel from a page of recently updated
 * tickets, because the API had no notifications endpoint. That version was honest but it was a view
 * rather than an inbox: it had no read state, so a line disappeared when its ticket stopped matching
 * rather than when somebody had seen it, and there was nothing to mark as read. `V22` gave it real
 * rows and this service now reads them.
 *
 * <p><strong>Two requests, both eager.</strong> The list and the unread count are separate endpoints
 * answering different questions - how many notifications exist, and how many are unread - and the
 * second is served from a partial index over unread rows alone. Both are fetched when the shell
 * loads rather than when the panel opens, which costs two cheap requests and buys two things: the
 * badge is correct before anybody clicks, and it can turn red for an unread overdue ticket, which it
 * could not if the list were still unfetched.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCentre {
  private readonly auth = inject(Auth);
  private readonly api = inject(NotificationsApi);

  /**
   * Suppressed until there is a session.
   *
   * <p>Not merely empty - no request at all. The bell is part of the shell, which only renders for a
   * signed-in user, but this service is a root singleton and the login screen is in the same
   * application: without the guard it would fire a 401 that the interceptor would then spend a
   * refresh token answering.
   */
  private readonly enabled = computed(() => this.auth.identity() !== null);

  private readonly query = computed<NotificationQuery | undefined>(() =>
    this.enabled() ? { page: 0, size: PAGE_SIZE } : undefined,
  );

  private readonly inbox = this.api.list(this.query);
  private readonly unread = this.api.unreadCount(this.enabled);

  readonly loading = computed(() => this.inbox.isLoading() || this.unread.isLoading());

  /** True when the inbox could not be read, so the panel can say so rather than look empty. */
  readonly failed = computed(() => this.inbox.error() !== undefined);

  /**
   * The panel's lines.
   *
   * <p><strong>The error check is not defensive tidiness - `value()` throws.</strong> An
   * `HttpResourceRef` in an error state rethrows the failure when read rather than returning
   * undefined, so `value() ?? []` is not a fallback: without the guard above it, one failed request
   * takes down the header for every screen, because {@link urgent} reads this to colour the badge
   * and the badge is rendered whether or not the panel is open.
   */
  readonly list = computed<NotificationLine[]>(() => {
    if (this.failed()) {
      return [];
    }
    return (this.inbox.value() ?? []).map((notification) => render(notification));
  });

  /**
   * The badge.
   *
   * <p>From the dedicated endpoint, not from counting unread lines in {@link list} - that would
   * report "unread on this page", which reads as a total and is not one.
   *
   * <p>Guarded like {@link list}, and for the same reason: a failed count must read as "no badge"
   * rather than throw out of a template.
   */
  readonly count = computed(() => {
    if (this.unread.error() !== undefined) {
      return 0;
    }
    return this.unread.value()?.unread ?? 0;
  });

  /** Turns the badge red rather than merely numbered. Only an unread one is worth escalating. */
  readonly urgent = computed(() =>
    this.list().some((line) => line.tone === 'error' && line.unread),
  );

  readonly hasUnread = computed(() => this.count() > 0);

  /** Refetched when the panel opens, so the bell is accurate when looked at and idle otherwise. */
  refresh(): void {
    this.inbox.reload();
    this.unread.reload();
  }

  /**
   * Marks one read.
   *
   * <p>Fire and forget, then refetch. The server is idempotent about this, so a double click is
   * harmless, and a failure leaves the notification unread - which is the honest outcome and visible
   * on the next refresh. Nothing is updated optimistically: the badge count comes from the server,
   * and guessing it here would mean two sources of truth for the one number a user actually watches.
   */
  markRead(notificationId: number): void {
    this.api.markRead(notificationId).subscribe({
      next: () => this.refresh(),
      error: () => this.refresh(),
    });
  }

  markAllRead(): void {
    this.api.markAllRead().subscribe({
      next: () => this.refresh(),
      error: () => this.refresh(),
    });
  }
}

/**
 * Turns one stored notification into the line a person reads.
 *
 * <p>Every branch names its own type rather than falling through to a generic sentence, which is the
 * point of the API reporting a recipient-specific type: "assigned to you" and "assigned to Ali" are
 * different news, and nothing here has to compare names to tell them apart.
 *
 * <p>The ticket number leads each title because it is what somebody scanning the panel recognises,
 * and the title follows as the detail - the number identifies, the title reminds.
 */
function render(notification: NotificationResponse): NotificationLine {
  const number = notification.ticketNumber ?? 'A ticket';
  const subject = notification.ticketTitle ?? 'Untitled';
  const actor = notification.actorFullName ?? 'Somebody';

  const base = {
    id: notification.id ?? 0,
    ticketId: notification.ticketId ?? null,
    unread: !notification.readAt,
    at: notification.createdAt,
    detail: subject,
  };

  switch (notification.type) {
    case 'TICKET_OVERDUE':
      return {
        ...base,
        icon: 'schedule',
        tone: 'error',
        title: `${number} is past its deadline`,
      };

    case 'TICKET_AWAITING_ASSIGNMENT':
      return {
        ...base,
        icon: 'inbox',
        tone: 'warning',
        title: `${number} is waiting to be assigned`,
        detail: `${subject} - raised by ${actor}`,
      };

    case 'TICKET_ASSIGNED_TO_YOU':
      return {
        ...base,
        icon: 'assignment_ind',
        tone: 'info',
        title: `${number} is yours to work`,
      };

    case 'TICKET_NOW_ASSIGNED':
      return {
        ...base,
        icon: 'how_to_reg',
        tone: 'info',
        title: `${number} was assigned to ${notification.newValue ?? 'somebody'}`,
      };

    case 'TICKET_TAKEN_FROM_YOU':
      return {
        ...base,
        icon: 'person_remove',
        tone: 'neutral',
        title: `${number} was reassigned`,
        detail: notification.newValue ? `Now with ${notification.newValue}` : subject,
      };

    case 'TICKET_STATUS_CHANGED':
      return {
        ...base,
        icon: 'swap_horiz',
        // Resolved and closed are good news; everything else is only news. Worth distinguishing,
        // because "your ticket is fixed" is the one line in this panel somebody is waiting for.
        tone: settled(notification.newValue) ? 'success' : 'info',
        title: `${number} is now ${humanise(notification.newValue)}`,
      };

    case 'TICKET_COMMENTED':
      return {
        ...base,
        icon: 'chat_bubble',
        tone: 'info',
        title: `${actor} commented on ${number}`,
      };

    default:
      // A type this build does not know about - the API gained one and this client has not caught
      // up. Rendered as plainly as possible rather than dropped: the reader still learns that
      // something happened to a ticket they are on, which is more use than a silently shorter list.
      return {
        ...base,
        icon: 'notifications',
        tone: 'neutral',
        title: `${number} was updated`,
      };
  }
}

function settled(status: string | undefined): boolean {
  return status === 'RESOLVED' || status === 'CLOSED';
}

/** `UNDER_REVIEW` is not something to put in front of a person. */
function humanise(value: string | undefined): string {
  if (!value) {
    return 'updated';
  }
  return (value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')).toLowerCase();
}
