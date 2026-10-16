import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { Comments } from '../../../core/api/comments';
import { ProblemDetail } from '../../../core/api/models';
import { PageQuery, pageFromHeaders } from '../../../core/api/page';
import { Auth } from '../../../core/auth/auth';

/**
 * A ticket's discussion thread, oldest first.
 *
 * <p>Oldest first is the API's own default and the right order for a conversation, but it has a
 * consequence for paging: the newest comment sits on the *last* page. So posting one jumps there -
 * otherwise somebody on page 1 of a long thread would write a comment and watch nothing appear.
 */
@Component({
  selector: 'app-ticket-comments',
  imports: [
    DatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './ticket-comments.html',
  styleUrl: './ticket-comments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketComments {
  readonly ticketId = input.required<number>();

  private readonly comments = inject(Comments);
  private readonly auth = inject(Auth);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly canRead = computed(() => this.auth.has('TICKET_COMMENT_READ'));
  protected readonly canWrite = computed(() => this.auth.has('TICKET_COMMENT_CREATE'));

  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(25);

  // No `sort`: the API already orders a thread oldest-first, and its sortable set here is only
  // `createdAt` and `id`, so there is nothing to gain by restating the default.
  private readonly query = computed<PageQuery>(() => ({
    page: this.pageIndex(),
    size: this.pageSize(),
  }));

  /**
   * Undefined suppresses the request entirely when the user cannot read threads.
   *
   * <p>Letting it fire and showing the 403 would be worse than not asking: the panel is already
   * hidden, so the only thing the request produces is a logged authorisation failure for something
   * nobody attempted.
   */
  private readonly readableTicketId = computed(() =>
    this.canRead() ? this.ticketId() : undefined,
  );

  private readonly resource = this.comments.list(this.readableTicketId, this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  protected readonly page = computed(() =>
    pageFromHeaders(this.resource.headers(), this.resource.value() ?? []),
  );

  protected readonly form = this.formBuilder.group({
    comment: ['', [Validators.required, Validators.maxLength(4000)]],
  });

  protected readonly posting = signal(false);
  protected readonly postError = signal<string | null>(null);

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  protected post(): void {
    if (this.form.invalid || this.posting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.posting.set(true);
    this.postError.set(null);

    this.comments.add(this.ticketId(), this.form.getRawValue()).subscribe({
      next: () => {
        this.posting.set(false);
        this.form.reset();

        // Land where the new comment is. `totalCount` is one behind - it describes the thread before
        // this comment - so dividing it by the page size gives the index that now holds it.
        const { totalCount, pageSize } = this.page();
        const landing = Math.floor(totalCount / Math.max(pageSize, 1));
        if (landing === this.pageIndex()) {
          // Same page, so the query signal does not change and nothing would refetch on its own.
          this.resource.reload();
        } else {
          this.pageIndex.set(landing);
        }
      },
      error: (error: unknown) => {
        this.posting.set(false);
        this.postError.set(describe(error));
      },
    });
  }

  protected reload(): void {
    this.resource.reload();
  }

  /** Initials for the author avatar. The API gives a name, and never an image to load. */
  protected initials(name: string | undefined): string {
    if (!name?.trim()) {
      return '?';
    }
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
}

function describe(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.status === 0) {
    return 'Cannot reach the server.';
  }
  const problem = error.error as ProblemDetail | null;
  // Bean-validation failures arrive as a field-to-message map, and there is only one field here.
  return problem?.errors?.['comment'] ?? problem?.detail ?? 'This comment could not be posted.';
}
