import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';

import { Applications } from '../../../core/api/applications';
import {
  ApplicationResponse,
  BUSINESS_IMPACTS,
  BusinessImpact,
  CreateTicketRequest,
  ISSUE_TYPES,
  IssueType,
  PRIORITIES,
  Priority,
  ProblemDetail,
} from '../../../core/api/models';
import { PageQuery } from '../../../core/api/page';
import { Tickets } from '../../../core/api/tickets';
import { Auth } from '../../../core/auth/auth';

/** The API's own limits, mirrored so the form says so before the server has to. */
const TITLE_MAX = 100;

@Component({
  selector: 'app-ticket-create',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './ticket-create.html',
  styleUrl: './ticket-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketCreate {
  private readonly applications = inject(Applications);
  private readonly tickets = inject(Tickets);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly issueTypes = ISSUE_TYPES;
  protected readonly priorities = PRIORITIES;
  protected readonly titleMax = TITLE_MAX;
  protected readonly businessImpacts = BUSINESS_IMPACTS;

  /**
   * The picker needs the catalogue, which needs `APPLICATION_READ`.
   *
   * <p>Every seeded role that can raise a ticket also holds it - the permission exists so a
   * requester can say what the ticket is about - but the form cannot assume that, because a role is
   * data an administrator edits. Without it the page says so rather than showing an empty select.
   */
  protected readonly canChooseApplication = computed(() => this.auth.has('APPLICATION_READ'));

  // 100 is the API's maximum page size; an internal catalogue is far smaller. If it ever is not,
  // this becomes a searchable picker rather than a longer page.
  //
  // Undefined without the permission, which suppresses the request rather than firing it to show
  // its own 403 - the same rule the comment, attachment and history panels follow.
  private readonly query = computed<PageQuery | undefined>(() =>
    this.canChooseApplication() ? { page: 0, size: 100 } : undefined,
  );

  private readonly catalogue = this.applications.listActive(this.query);

  protected readonly loadingCatalogue = this.catalogue.isLoading;
  protected readonly catalogueFailed = this.catalogue.error;
  protected readonly options = computed<ApplicationResponse[]>(() => this.catalogue.value() ?? []);

  protected readonly form = this.formBuilder.group({
    applicationId: this.formBuilder.control<number | null>(null, Validators.required),
    title: ['', [Validators.required, Validators.maxLength(TITLE_MAX)]],
    description: ['', [Validators.required]],
    issueType: this.formBuilder.control<IssueType | null>(null, Validators.required),
    priority: this.formBuilder.control<Priority | null>(null, Validators.required),
    // A drop-down, and still optional - so `null` is a legitimate value rather than an unfilled
    // one, and there is no `Validators.required` to go with it. It used to be a text box with a
    // 50-character limit and a placeholder reading "e.g. Department-level"; see BUSINESS_IMPACTS for
    // what that produced in practice.
    businessImpact: this.formBuilder.control<BusinessImpact | null>(null),
    // A `datetime-local` value: "2026-10-20T17:00", with no zone. Converted on submit.
    expectedBy: [''],
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Whether the deadline typed is already in the past.
   *
   * <p>A hint, not a validation error. The API accepts it, and "this was needed yesterday" is a
   * real thing somebody raises a ticket to say - so blocking it would be this form inventing a rule
   * the system does not have.
   */
  protected readonly expectedByInPast = signal(false);

  protected onExpectedByChange(value: string): void {
    this.expectedByInPast.set(value !== '' && new Date(value).getTime() < Date.now());
  }

  /**
   * The selected application id, as a signal.
   *
   * <p>Reactive forms expose their value as a plain property, not a signal, so a `computed()` that
   * read `controls.applicationId.value` directly would be computed once and then cached forever -
   * it registers no dependency to invalidate it. Bridging `valueChanges` is what makes anything
   * derived from the selection actually track it.
   */
  private readonly selectedApplicationId = toSignal(this.form.controls.applicationId.valueChanges, {
    initialValue: this.form.controls.applicationId.value,
  });

  /** What the chosen row's module is. Shown because the user never types it - see {@link submit}. */
  protected readonly chosenModule = computed(() => {
    const id = this.selectedApplicationId();
    return this.options().find((option) => option.id === id)?.moduleName ?? null;
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const application = this.options().find((option) => option.id === value.applicationId);
    if (!application?.id || !application.moduleName) {
      this.errorMessage.set('Choose an application before submitting.');
      return;
    }

    const request: CreateTicketRequest = {
      applicationId: application.id,
      // Sent, but never asked for. The API requires `moduleName` alongside `applicationId` and
      // then rejects anything that is not that application's own module, case-insensitively - so it
      // is a confirmation field, not a choice. A text box here could only ever produce 400s.
      moduleName: application.moduleName,
      title: value.title.trim(),
      description: value.description.trim(),
      issueType: value.issueType as IssueType,
      priority: value.priority as Priority,
      // `undefined`, never `null` or `''`: the API treats an absent field as "not stated" and an
      // empty string as a constant it does not have, which is a 400.
      businessImpact: value.businessImpact ?? undefined,
      expectedBy: toInstant(value.expectedBy),
    };

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.tickets.create(request).subscribe({
      next: (ticket) => {
        this.submitting.set(false);
        // Straight to the ticket, which is what somebody who just raised one wants to see - and it
        // also proves to them that it exists.
        void this.router.navigateByUrl(ticket.id ? `/tickets/${ticket.id}` : '/tickets');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(this.applyServerErrors(error));
      },
    });
  }

  /**
   * Puts field-level server errors back on the controls that caused them.
   *
   * <p>The API answers a validation failure with a field-to-message map, and those field names match
   * these control names. Dropping them into one banner would make the reader hunt for which input is
   * wrong; this marks the input and returns whatever is left over for the banner.
   */
  private applyServerErrors(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) {
      return 'Something went wrong. Please try again.';
    }
    if (error.status === 0) {
      return 'Cannot reach the server. Check that the API is running.';
    }

    const problem = error.error as ProblemDetail | null;
    const fieldErrors = problem?.errors;
    let attached = false;

    if (fieldErrors) {
      for (const [field, message] of Object.entries(fieldErrors)) {
        const control = this.form.get(field);
        if (control) {
          control.setErrors({ ...(control.errors ?? {}), server: message });
          control.markAsTouched();
          attached = true;
        }
      }
    }

    if (attached) {
      return 'Some details need fixing.';
    }
    // An invalid or inactive application reaches here rather than as a field error, because the
    // backend reports it as an invalid reference with the explanation in `detail`.
    return problem?.detail ?? 'This ticket could not be raised.';
  }

  protected serverError(field: string): string | null {
    const errors = this.form.get(field)?.errors;
    return (errors?.['server'] as string | undefined) ?? null;
  }

  protected humanise(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  protected reloadCatalogue(): void {
    this.catalogue.reload();
  }
}

/**
 * Turns a `datetime-local` value into the instant the API demands.
 *
 * <p>The input gives `"2026-10-20T17:00"` with no zone, and `new Date()` parses that *date-time*
 * form as local time - so `toISOString()` yields the instant the person actually meant, in their own
 * zone, which is the only zone anyone can correctly assume. This is exactly what the API's refusal of
 * offset-less datetimes is for: it will not guess, and the browser does not have to.
 */
function toInstant(localValue: string): string | undefined {
  if (!localValue) {
    return undefined;
  }
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
