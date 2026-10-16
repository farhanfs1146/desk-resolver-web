import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface ConfirmDialogData {
  title: string;
  /** What will happen, in terms of consequence rather than mechanism. */
  message: string;
  /** The verb on the button that does it, e.g. "Deactivate". Never "OK". */
  confirmLabel: string;
  /** True for anything destructive, which colours the button as a warning. */
  destructive?: boolean;
}

/**
 * A yes/no step in front of something the user cannot straightforwardly undo.
 *
 * <p>Generic on purpose: the alternative is a bespoke dialog per action, and those drift. The caller
 * supplies the wording, because only it knows the consequence - a dialog that says "Are you sure?"
 * tells the reader nothing they did not already know when they clicked.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './confirm-dialog.html',
  styles: `
    .confirm-message {
      margin: 0;
      max-width: 28rem;
      font: var(--mat-sys-body-medium);
    }

    // Destructive actions get the error colour rather than the primary one, so the button that does
    // the damage does not look like the safe default.
    .confirm-danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
