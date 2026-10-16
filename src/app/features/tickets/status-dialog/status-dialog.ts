import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { TICKET_STATUSES, TicketStatus, UpdateTicketStatusRequest } from '../../../core/api/models';

export interface StatusDialogData {
  ticketNumber: string;
  current: TicketStatus | undefined;
}

@Component({
  selector: 'app-status-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './status-dialog.html',
  styles: `
    .status-form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 20rem;
      padding-top: 0.5rem;
    }

    .status-hint {
      margin: 0 0 0.5rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusDialog {
  protected readonly data = inject<StatusDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<StatusDialog, UpdateTicketStatusRequest>);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /**
   * Every status, with the current one excluded.
   *
   * <p>The API rejects a transition to the status a ticket already has, so offering it would be
   * offering a guaranteed 400. Which *other* transitions are legal is the server's business - it
   * knows the workflow and this does not - so the rest are offered and a refusal is reported.
   */
  protected readonly options = TICKET_STATUSES.filter((status) => status !== this.data.current);

  protected readonly form = this.formBuilder.group({
    status: this.formBuilder.control<TicketStatus | null>(null, Validators.required),
    remarks: ['', Validators.maxLength(1000)],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { status, remarks } = this.form.getRawValue();
    this.dialog.close({
      status: status as TicketStatus,
      // Empty remarks are omitted rather than sent as "": the field is optional, and a blank string
      // would be recorded in the history as a remark somebody made.
      remarks: remarks.trim() || undefined,
    });
  }

  protected humanise(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}
