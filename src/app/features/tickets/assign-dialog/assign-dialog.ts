import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';

import { PageQuery } from '../../../core/api/page';
import { Users } from '../../../core/api/users';

export interface AssignDialogData {
  ticketNumber: string;
  currentAssigneeId: number | undefined;
  currentAssigneeName: string | undefined;
}

@Component({
  selector: 'app-assign-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
  ],
  templateUrl: './assign-dialog.html',
  styles: `
    .assign-body {
      min-width: 22rem;
    }

    .assign-hint {
      margin: 0 0 0.75rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .assign-field {
      width: 100%;
    }

    .assign-option small {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .assign-progress {
      height: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignDialog {
  protected readonly data = inject<AssignDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<AssignDialog, number>);
  private readonly users = inject(Users);

  protected readonly filter = signal('');
  protected readonly chosen = signal<number | null>(null);

  // 100 is the API's maximum page size. An internal help desk has far fewer accounts than that, and
  // the filter below narrows what is already loaded rather than issuing a request per keystroke.
  private readonly query = computed<PageQuery>(() => ({ page: 0, size: 100 }));

  private readonly resource = this.users.list(this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  /**
   * Assignable accounts: active ones, minus whoever already holds the ticket.
   *
   * <p>Deactivated users are filtered out because assigning work to a closed account is a dead end
   * nobody would notice - the ticket would simply sit there. The current assignee is excluded for
   * the same reason the current status is: it is a no-op the server would have to reject.
   */
  protected readonly options = computed(() => {
    const term = this.filter().trim().toLowerCase();
    return (this.resource.value() ?? [])
      .filter((user) => user.active !== false && user.id !== this.data.currentAssigneeId)
      .filter(
        (user) =>
          !term ||
          (user.fullName ?? '').toLowerCase().includes(term) ||
          (user.email ?? '').toLowerCase().includes(term),
      );
  });

  protected submit(): void {
    const id = this.chosen();
    if (id !== null) {
      this.dialog.close(id);
    }
  }
}
