import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';

import { environment } from '../../../../environments/environment';
import { PasswordDialog } from './password-dialog';

const PASSWORD_URL = `${environment.apiBaseUrl}/users/me/password`;

interface Bindings {
  form: FormGroup;
  errorMessage: () => string | null;
  submit: () => void;
}

function bindingsOf(fixture: ComponentFixture<PasswordDialog>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

describe('PasswordDialog', () => {
  let backend: HttpTestingController;
  let closedWith: boolean | undefined | 'not closed';
  let fixture: ComponentFixture<PasswordDialog>;

  beforeEach(() => {
    closedWith = 'not closed';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MatDialogRef,
          useValue: {
            close: (value?: boolean) => {
              closedWith = value;
            },
          },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PasswordDialog);
    TestBed.tick();
  });

  function fill(current: string, next: string, again = next) {
    bindingsOf(fixture).form.patchValue({
      currentPassword: current,
      newPassword: next,
      confirmPassword: again,
    });
  }

  it('sends only the two fields the API takes', () => {
    fill('old-password-12', 'new-password-12');
    bindingsOf(fixture).submit();

    const request = backend.expectOne(PASSWORD_URL);
    expect(request.request.method).toBe('PATCH');

    // The confirmation field exists for the typist, not for the server.
    expect(request.request.body).toEqual({
      currentPassword: 'old-password-12',
      newPassword: 'new-password-12',
    });

    request.flush(null);
    expect(closedWith).toBe(true);
  });

  it('will not submit when the two new passwords differ', () => {
    fill('old-password-12', 'new-password-12', 'new-password-13');
    bindingsOf(fixture).submit();

    // Caught here rather than on the next sign-in, when the only person who could fix it is the
    // one locked out.
    backend.expectNone(PASSWORD_URL);
    expect(bindingsOf(fixture).form.hasError('mismatch')).toBe(true);
  });

  it('will not submit a new password shorter than the API accepts', () => {
    fill('old-password-12', 'short');
    bindingsOf(fixture).submit();

    backend.expectNone(PASSWORD_URL);
    expect(bindingsOf(fixture).form.controls['newPassword'].hasError('minlength')).toBe(true);
  });

  it("does not repeat the server's login wording on a wrong current password", () => {
    fill('wrong-password-1', 'new-password-12');
    bindingsOf(fixture).submit();

    backend
      .expectOne(PASSWORD_URL)
      .flush(
        { title: 'Authentication failed', status: 401, detail: 'Invalid email or password.' },
        { status: 401, statusText: 'Unauthorized' },
      );

    // The server's sentence is uniform for the login endpoint, where saying more would make it an
    // account-enumeration oracle. Here the caller is already authenticated and there is no email in
    // the request, so passing it through would send somebody looking for a field that is not on
    // screen.
    expect(bindingsOf(fixture).errorMessage()).toBe('That current password is not correct.');
    expect(bindingsOf(fixture).errorMessage()).not.toContain('email');
    expect(closedWith).toBe('not closed');
  });

  it('shows a field message from the server when there is one', () => {
    fill('old-password-12', 'new-password-12');
    bindingsOf(fixture).submit();

    backend.expectOne(PASSWORD_URL).flush(
      {
        title: 'Invalid request',
        status: 400,
        errors: { newPassword: 'Password must be between 12 and 200 characters' },
      },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(bindingsOf(fixture).errorMessage()).toContain('between 12 and 200');
  });
});
