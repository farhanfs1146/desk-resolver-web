import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { Applications } from '../../../core/api/applications';
import {
  ApplicationResponse,
  CreateApplicationRequest,
  ProblemDetail,
} from '../../../core/api/models';

const APP_NAME_MAX = 150;
const MODULE_NAME_MAX = 100;

export type ApplicationDialogData =
  { mode: 'create' } | { mode: 'edit'; application: ApplicationResponse };

@Component({
  selector: 'app-application-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './application-dialog.html',
  styles: `
    .app-form {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding-top: 0.5rem;
    }

    .app-check {
      margin: 0.25rem 0;
    }

    .app-hint {
      margin: 0 0 0.25rem;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }

    .app-error {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      min-height: 1.25rem;
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);

      mat-icon {
        flex: 0 0 auto;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
      }
    }

    .app-progress {
      height: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationDialog {
  protected readonly data = inject<ApplicationDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<ApplicationDialog, ApplicationResponse>);
  private readonly applications = inject(Applications);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly appNameMax = APP_NAME_MAX;
  protected readonly moduleNameMax = MODULE_NAME_MAX;

  protected readonly editing = computed(() => this.data.mode === 'edit');

  private readonly existing = this.data.mode === 'edit' ? this.data.application : null;

  protected readonly form = this.formBuilder.group({
    appName: [
      this.existing?.appName ?? '',
      [Validators.required, Validators.maxLength(APP_NAME_MAX)],
    ],
    moduleName: [
      this.existing?.moduleName ?? '',
      [Validators.required, Validators.maxLength(MODULE_NAME_MAX)],
    ],
    active: [this.existing?.active ?? true],
  });

  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    // `PUT` takes the same shape as `POST` and replaces the row wholesale, so every field is sent
    // on an edit - including `active`, which is why this dialog is also the way back from inactive.
    const request: CreateApplicationRequest = {
      appName: value.appName.trim(),
      moduleName: value.moduleName.trim(),
      active: value.active,
    };

    this.saving.set(true);
    this.errorMessage.set(null);

    const call =
      this.existing?.id !== undefined
        ? this.applications.update(this.existing.id, request)
        : this.applications.create(request);

    call.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.dialog.close(saved);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(this.applyServerErrors(error));
      },
    });
  }

  private applyServerErrors(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Something went wrong. Please try again.';
    }
    if (error.status === 0) {
      return 'Cannot reach the server.';
    }

    const problem = error.error as ProblemDetail | null;
    let attached = false;

    for (const [field, message] of Object.entries(problem?.errors ?? {})) {
      const control = this.form.get(field);
      if (control) {
        control.setErrors({ ...(control.errors ?? {}), server: message });
        control.markAsTouched();
        attached = true;
      }
    }

    if (attached) {
      return 'Some details need fixing.';
    }
    // A duplicate application/module pair comes back as a 409 explaining itself.
    return problem?.detail ?? 'This application could not be saved.';
  }

  protected serverError(field: string): string | null {
    return (this.form.get(field)?.errors?.['server'] as string | undefined) ?? null;
  }
}
