import { HttpClient, HttpResponse, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { TicketAttachmentResponse } from './models';
import { PageQuery, toParams } from './page';

/** The API's own cap (`APP_ATTACHMENT_MAX_FILE_SIZE`). Checked here only to fail fast and politely. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * What the backend's `allowed-content-types` list accepts. Anything else is refused server-side.
 *
 * <p>Used for the file picker's `accept` attribute and a pre-flight check. Neither is a control -
 * `accept` is a hint a user can defeat in the dialog, and the browser's idea of a file's type is the
 * same client-declared string the server then validates. The point is a clear message now instead of
 * a 400 after a 10 MB upload.
 */
export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/** One downloaded attachment: the bytes, and the name the server said to save them under. */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

@Injectable({ providedIn: 'root' })
export class Attachments {
  private readonly http = inject(HttpClient);

  private url(ticketId: number): string {
    return `${environment.apiBaseUrl}/tickets/${ticketId}/attachments`;
  }

  list(ticketId: Signal<number | undefined>, query: Signal<PageQuery>) {
    return httpResource<TicketAttachmentResponse[]>(() => {
      const id = ticketId();
      return id === undefined ? undefined : { url: this.url(id), params: toParams({ ...query() }) };
    });
  }

  /** Multipart with the part named `file`, which is what `@RequestPart("file")` binds to. */
  upload(ticketId: number, file: File): Observable<TicketAttachmentResponse> {
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header: the browser must set it, because only it knows the multipart boundary.
    return this.http.post<TicketAttachmentResponse>(this.url(ticketId), form);
  }

  /**
   * Fetches an attachment's bytes.
   *
   * <p><strong>This cannot be an `<a href>`.</strong> The endpoint requires `Authorization`, and a
   * plain link sends no headers - the browser would navigate and collect a 401. So the bytes come
   * through `HttpClient` (and therefore through the auth interceptor, including its token renewal)
   * and the caller saves the blob itself.
   *
   * <p>The filename comes from `Content-Disposition` rather than from the list row, because that is
   * the one the server encoded - RFC 5987 `filename*` when the name is not ASCII. It is only readable
   * cross-origin because the backend lists that header in `exposedHeaders`; the row's `fileName` is
   * the fallback when it is not.
   */
  download(
    ticketId: number,
    attachmentId: number,
    fallbackName: string,
  ): Observable<DownloadedFile> {
    return this.http
      .get(`${this.url(ticketId)}/${attachmentId}/content`, {
        observe: 'response',
        responseType: 'blob',
      })
      .pipe(
        map((response: HttpResponse<Blob>) => ({
          blob: response.body ?? new Blob(),
          fileName: fileNameFrom(response.headers.get('Content-Disposition')) ?? fallbackName,
        })),
      );
  }
}

/**
 * Pulls the filename out of a `Content-Disposition` header.
 *
 * <p>`filename*` is preferred and checked first, because when both forms are present the starred one
 * is the accurate one - the plain `filename` is the deliberately lossy ASCII fallback. Decoding can
 * fail on a malformed sequence, so it falls through rather than throwing in the middle of a download.
 */
export function fileNameFrom(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed percent-encoding; fall through to the ASCII form.
    }
  }

  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * Hands a blob to the browser as a download.
 *
 * <p>The object URL is revoked immediately afterwards. Without that, every download holds its bytes
 * in memory for the lifetime of the page - which on a ticket with several large attachments is a leak
 * a user would experience as the tab becoming slow.
 */
export function saveBlob(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
