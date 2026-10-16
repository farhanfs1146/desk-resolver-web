import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  ALLOWED_CONTENT_TYPES,
  Attachments,
  MAX_ATTACHMENT_BYTES,
  saveBlob,
} from '../../../core/api/attachments';
import { ProblemDetail, TicketAttachmentResponse } from '../../../core/api/models';
import { PageQuery, pageFromHeaders } from '../../../core/api/page';
import { Auth } from '../../../core/auth/auth';

@Component({
  selector: 'app-ticket-attachments',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  templateUrl: './ticket-attachments.html',
  styleUrl: './ticket-attachments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketAttachments {
  readonly ticketId = input.required<number>();

  private readonly attachments = inject(Attachments);
  private readonly auth = inject(Auth);

  protected readonly canRead = computed(() => this.auth.has('TICKET_ATTACHMENT_READ'));
  protected readonly canUpload = computed(() => this.auth.has('TICKET_ATTACHMENT_UPLOAD'));

  /** What the file picker offers. A hint, not a control - the server validates the type regardless. */
  protected readonly accept = ALLOWED_CONTENT_TYPES.join(',');

  // Attachments are few per ticket and the API already orders them newest-first, so one page of 100
  // (its maximum) replaces a paginator here. The count below says so if it ever is not enough.
  private readonly query = computed<PageQuery>(() => ({ page: 0, size: 100 }));

  private readonly readableTicketId = computed(() =>
    this.canRead() ? this.ticketId() : undefined,
  );

  private readonly resource = this.attachments.list(this.readableTicketId, this.query);

  protected readonly loading = this.resource.isLoading;
  protected readonly failure = this.resource.error;

  protected readonly page = computed(() =>
    pageFromHeaders(this.resource.headers(), this.resource.value() ?? []),
  );

  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  /** Ids currently being fetched, so each row can show its own spinner rather than one for all. */
  protected readonly downloading = signal<ReadonlySet<number>>(new Set());

  protected isDownloading(id: number | undefined): boolean {
    return id !== undefined && this.downloading().has(id);
  }

  protected pick(input: HTMLInputElement): void {
    const file = input.files?.[0];
    // Reset immediately: without this, choosing the same file twice in a row raises no change event
    // and the second attempt appears to do nothing.
    input.value = '';

    if (!file) {
      return;
    }

    const rejection = this.reject(file);
    if (rejection) {
      this.uploadError.set(rejection);
      return;
    }

    this.upload(file);
  }

  /**
   * Checks what can be checked here, to fail in a readable way rather than after the bytes are sent.
   *
   * <p>Neither check is a control. `file.type` is the browser's guess from the extension - the same
   * client-declared string the server then validates against its own allow-list - and the size limit
   * is enforced there too. The value is that a 12 MB file is refused instantly instead of after a
   * long upload ending in a 400.
   */
  private reject(file: File): string | null {
    if (file.size === 0) {
      return 'That file is empty.';
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return `That file is ${this.size(file.size)}. The limit is ${this.size(MAX_ATTACHMENT_BYTES)}.`;
    }
    if (
      file.type &&
      !ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])
    ) {
      return `${file.type} files are not accepted. Images, PDFs, Office documents, text, CSV and ZIP are.`;
    }
    return null;
  }

  private upload(file: File): void {
    this.uploading.set(true);
    this.uploadError.set(null);

    this.attachments.upload(this.ticketId(), file).subscribe({
      next: () => {
        this.uploading.set(false);
        this.resource.reload();
      },
      error: (error: unknown) => {
        this.uploading.set(false);
        this.uploadError.set(describeUpload(error, file));
      },
    });
  }

  /**
   * Downloads through `HttpClient`, because the endpoint needs an `Authorization` header.
   *
   * <p>A plain `<a href>` would send none and the browser would navigate to a 401 - which is why
   * this is a button rather than a link, despite looking like one.
   */
  protected download(attachment: TicketAttachmentResponse): void {
    const id = attachment.id;
    if (id === undefined || this.isDownloading(id)) {
      return;
    }

    this.downloading.update((current) => new Set(current).add(id));
    this.uploadError.set(null);

    this.attachments.download(this.ticketId(), id, attachment.fileName ?? 'attachment').subscribe({
      next: (file) => {
        saveBlob(file);
        this.finishDownload(id);
      },
      error: () => {
        this.finishDownload(id);
        this.uploadError.set(`${attachment.fileName ?? 'That file'} could not be downloaded.`);
      },
    });
  }

  private finishDownload(id: number): void {
    this.downloading.update((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  protected reload(): void {
    this.resource.reload();
  }

  /** Binary units, because that is what both the server limit and the OS file dialog mean. */
  protected size(bytes: number | undefined): string {
    if (bytes === undefined) {
      return '';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  protected icon(fileType: string | undefined): string {
    if (!fileType) {
      return 'attach_file';
    }
    if (fileType.startsWith('image/')) {
      return 'image';
    }
    if (fileType === 'application/pdf') {
      return 'picture_as_pdf';
    }
    if (fileType === 'application/zip') {
      return 'folder_zip';
    }
    if (fileType.startsWith('text/')) {
      return 'description';
    }
    return 'insert_drive_file';
  }
}

function describeUpload(error: unknown, file: File): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.status === 0) {
    return 'Cannot reach the server.';
  }
  // 413 comes from the servlet container rather than the application, so it has no problem detail.
  if (error.status === 413) {
    return `${file.name} is too large for the server to accept.`;
  }
  const problem = error.error as ProblemDetail | null;
  return problem?.detail ?? `${file.name} could not be uploaded.`;
}
