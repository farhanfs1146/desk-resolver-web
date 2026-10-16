import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { AuthenticationResponse } from './models';
import { Attachments, fileNameFrom } from './attachments';
import { Auth } from '../auth/auth';
import { authInterceptor } from '../auth/auth-interceptor';

const LOGIN_URL = `${environment.apiBaseUrl}/auth/login`;
const CONTENT_URL = `${environment.apiBaseUrl}/tickets/7/attachments/3/content`;
const UPLOAD_URL = `${environment.apiBaseUrl}/tickets/7/attachments`;

describe('fileNameFrom', () => {
  it('reads a plain filename', () => {
    expect(fileNameFrom('attachment; filename="report.pdf"')).toBe('report.pdf');
  });

  it('reads one without quotes', () => {
    expect(fileNameFrom('attachment; filename=report.pdf')).toBe('report.pdf');
  });

  it('prefers the RFC 5987 form, which is the accurate one', () => {
    // The backend builds this header with Spring's ContentDisposition, which emits both forms when
    // the name is not ASCII. The plain `filename` is the deliberately lossy fallback, so taking it
    // when `filename*` is present would mangle exactly the names the starred form exists to carry.
    const header =
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'%D8%B1%D9%88%D8%AF%D8%A7%D8%AF.pdf';
    expect(fileNameFrom(header)).toBe('روداد.pdf');
  });

  it('decodes spaces and reserved characters', () => {
    expect(fileNameFrom("attachment; filename*=UTF-8''my%20report%20%282026%29.pdf")).toBe(
      'my report (2026).pdf',
    );
  });

  it('falls back to the ASCII form when the encoding is malformed', () => {
    // A lone % is not valid percent-encoding and decodeURIComponent throws on it. Throwing in the
    // middle of a download would lose the file over a header detail.
    const header = 'attachment; filename="safe.pdf"; filename*=UTF-8\'\'bad%ZZname.pdf';
    expect(fileNameFrom(header)).toBe('safe.pdf');
  });

  it('returns null when there is nothing to read', () => {
    expect(fileNameFrom(null)).toBeNull();
    expect(fileNameFrom('attachment')).toBeNull();
  });
});

describe('Attachments', () => {
  let attachments: Attachments;
  let backend: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    attachments = TestBed.inject(Attachments);
    backend = TestBed.inject(HttpTestingController);

    const auth = TestBed.inject(Auth);
    auth.login({ email: 'farhan@example.com', password: 'secret' }).subscribe();
    const response: AuthenticationResponse = {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      userId: 42,
      fullName: 'Farhan Ali',
      roles: ['IT_SUPPORT'],
      permissions: ['TICKET_ATTACHMENT_READ', 'TICKET_ATTACHMENT_UPLOAD'],
    };
    backend.expectOne(LOGIN_URL).flush(response);
  });

  afterEach(() => {
    backend.verify();
    sessionStorage.clear();
  });

  describe('download', () => {
    it('fetches the bytes with the access token attached', () => {
      attachments.download(7, 3, 'fallback.pdf').subscribe();

      const request = backend.expectOne(CONTENT_URL);

      // The reason this is a button and not an <a href>: a link sends no headers, so the browser
      // would navigate straight into a 401.
      expect(request.request.headers.get('Authorization')).toBe('Bearer access-one');
      expect(request.request.responseType).toBe('blob');

      request.flush(new Blob(['x']));
    });

    it('names the file from Content-Disposition rather than from the list row', () => {
      let saved: string | undefined;
      attachments.download(7, 3, 'fallback.pdf').subscribe((file) => (saved = file.fileName));

      backend.expectOne(CONTENT_URL).flush(new Blob(['x']), {
        headers: { 'Content-Disposition': 'attachment; filename="server-chosen.pdf"' },
      });

      expect(saved).toBe('server-chosen.pdf');
    });

    it('falls back to the row filename when the header cannot be read', () => {
      // Which is what happens cross-origin if Content-Disposition is ever dropped from the
      // backend's exposedHeaders: the bytes arrive and the name does not.
      let saved: string | undefined;
      attachments.download(7, 3, 'fallback.pdf').subscribe((file) => (saved = file.fileName));

      backend.expectOne(CONTENT_URL).flush(new Blob(['x']));

      expect(saved).toBe('fallback.pdf');
    });
  });

  describe('upload', () => {
    it('sends multipart with the part named "file" and lets the browser set the type', () => {
      const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
      attachments.upload(7, file).subscribe();

      const request = backend.expectOne(UPLOAD_URL);
      const body = request.request.body as FormData;

      // `@RequestPart("file")` binds by this name; anything else is a 400.
      expect(body.get('file')).toBeInstanceOf(File);
      expect((body.get('file') as File).name).toBe('notes.txt');

      // Setting Content-Type by hand would omit the multipart boundary, which only the browser
      // knows, and the server would fail to parse the body.
      expect(request.request.headers.has('Content-Type')).toBe(false);

      request.flush({ id: 1, fileName: 'notes.txt' });
    });
  });
});
