import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { environment } from '../../../../environments/environment';
import { Permission, Role, RoleResponse, UserResponse } from '../../../core/api/models';
import { RolesDialog, RolesDialogData } from './roles-dialog';

const ROLES_URL = `${environment.apiBaseUrl}/roles`;
const userRolesUrl = (id: number) => `${environment.apiBaseUrl}/users/${id}/roles`;

/** A trimmed copy of the seeded catalogue, with the permissions that matter to these tests. */
const CATALOGUE: RoleResponse[] = [
  {
    id: 1,
    code: 'EMPLOYEE',
    name: 'Employee',
    active: true,
    permissions: ['TICKET_CREATE', 'TICKET_READ_OWN', 'APPLICATION_READ'],
  },
  {
    id: 5,
    code: 'IT_SUPPORT',
    name: 'IT Support',
    active: true,
    permissions: ['TICKET_READ_ALL', 'TICKET_ASSIGN', 'USER_READ', 'TICKET_CREATE'],
  },
  {
    id: 7,
    code: 'ADMIN',
    name: 'Administrator',
    active: true,
    permissions: ['USER_MANAGE', 'USER_READ', 'APPLICATION_MANAGE', 'TICKET_READ_ALL'],
  },
];

interface Bindings {
  chosen: { (): Role[]; set: (value: Role[]) => void };
  resultingPermissions: () => Permission[];
  losingOwnAdmin: () => boolean;
  unchanged: () => boolean;
  errorMessage: () => string | null;
  submit: () => void;
}

function bindingsOf(fixture: ComponentFixture<RolesDialog>): Bindings {
  return fixture.componentInstance as unknown as Bindings;
}

describe('RolesDialog', () => {
  let backend: HttpTestingController;
  let closedWith: UserResponse | undefined | 'not closed';

  function setUp(data: RolesDialogData): ComponentFixture<RolesDialog> {
    closedWith = 'not closed';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: MatDialogRef,
          useValue: {
            close: (value?: UserResponse) => {
              closedWith = value;
            },
          },
        },
      ],
    });
    backend = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(RolesDialog);
    TestBed.tick();
    backend.expectOne(ROLES_URL).flush(CATALOGUE);
    return fixture;
  }

  async function settle(fixture: ComponentFixture<RolesDialog>) {
    await fixture.whenStable();
  }

  const someoneElse: RolesDialogData = {
    userId: 4,
    fullName: 'Zain',
    current: ['EMPLOYEE'],
    isSelf: false,
  };

  it('starts from the roles the account already holds', async () => {
    const fixture = setUp(someoneElse);
    await settle(fixture);

    // The endpoint replaces rather than adds, so starting from empty would turn "add a role" into
    // "remove every other one" for anybody who did not notice.
    expect(bindingsOf(fixture).chosen()).toEqual(['EMPLOYEE']);
    expect(bindingsOf(fixture).unchanged()).toBe(true);
  });

  it('sends the complete set, not a difference', async () => {
    const fixture = setUp(someoneElse);
    await settle(fixture);

    bindingsOf(fixture).chosen.set(['EMPLOYEE', 'IT_SUPPORT']);
    bindingsOf(fixture).submit();

    const request = backend.expectOne(userRolesUrl(4));
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ roles: ['EMPLOYEE', 'IT_SUPPORT'] });

    request.flush({ id: 4, roles: ['EMPLOYEE', 'IT_SUPPORT'] });
    await settle(fixture);
    expect(closedWith).toEqual({ id: 4, roles: ['EMPLOYEE', 'IT_SUPPORT'] });
  });

  it('refuses to submit an empty set rather than letting the server do it', async () => {
    const fixture = setUp(someoneElse);
    await settle(fixture);

    bindingsOf(fixture).chosen.set([]);
    bindingsOf(fixture).submit();

    backend.expectNone(userRolesUrl(4));
    expect(bindingsOf(fixture).errorMessage()).toContain('at least one role');
  });

  describe('the permission union', () => {
    it('adds up the permissions of every chosen role, without repeats', async () => {
      const fixture = setUp(someoneElse);
      await settle(fixture);

      bindingsOf(fixture).chosen.set(['EMPLOYEE', 'IT_SUPPORT']);
      const union = bindingsOf(fixture).resultingPermissions();

      // TICKET_CREATE is on both roles and must appear once. Derived from the catalogue rather than
      // from a rule restated here, so it agrees with the server by construction.
      expect(union.filter((p) => p === 'TICKET_CREATE').length).toBe(1);
      expect(union).toContain('TICKET_READ_OWN');
      expect(union).toContain('TICKET_ASSIGN');
      expect(union).not.toContain('USER_MANAGE');
    });

    it('only ever widens: adding a role never removes a permission', async () => {
      const fixture = setUp(someoneElse);
      await settle(fixture);

      bindingsOf(fixture).chosen.set(['EMPLOYEE']);
      const narrow = bindingsOf(fixture).resultingPermissions();

      bindingsOf(fixture).chosen.set(['EMPLOYEE', 'ADMIN']);
      const wide = bindingsOf(fixture).resultingPermissions();

      for (const permission of narrow) {
        expect(wide).toContain(permission);
      }
      expect(wide.length).toBeGreaterThan(narrow.length);
    });
  });

  describe('the self-lockout warning', () => {
    const self: RolesDialogData = {
      userId: 3,
      fullName: 'Farhan Ali',
      current: ['ADMIN'],
      isSelf: true,
    };

    it('warns when an administrator drops their own administrative role', async () => {
      const fixture = setUp(self);
      await settle(fixture);

      bindingsOf(fixture).chosen.set(['EMPLOYEE']);

      expect(bindingsOf(fixture).losingOwnAdmin()).toBe(true);
    });

    it('stays quiet while USER_MANAGE survives through another role', async () => {
      const fixture = setUp(self);
      await settle(fixture);

      bindingsOf(fixture).chosen.set(['ADMIN', 'IT_SUPPORT']);

      expect(bindingsOf(fixture).losingOwnAdmin()).toBe(false);
    });

    it("does not warn about someone else, whose lockout is not the editor's problem", async () => {
      const fixture = setUp({ ...someoneElse, current: ['ADMIN'] });
      await settle(fixture);

      bindingsOf(fixture).chosen.set(['EMPLOYEE']);

      // The server still guards the last administrator; this warning is specifically about the
      // editor removing their own ability to undo the change.
      expect(bindingsOf(fixture).losingOwnAdmin()).toBe(false);
    });
  });

  it("shows the lockout refusal in the server's own words", async () => {
    const fixture = setUp(someoneElse);
    await settle(fixture);

    bindingsOf(fixture).chosen.set(['IT_SUPPORT']);
    bindingsOf(fixture).submit();

    const detail =
      'Refused: this would leave no active account able to manage users. Grant USER_MANAGE to ' +
      'another active account first.';
    backend
      .expectOne(userRolesUrl(4))
      .flush(
        { title: 'Change refused', status: 409, detail },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);

    // The backend lets this one through in full on purpose - there is nothing to conceal and the
    // caller needs to be told what to do instead - so paraphrasing it here would lose the only
    // part that helps.
    expect(bindingsOf(fixture).errorMessage()).toBe(detail);
    expect(closedWith).toBe('not closed');
  });
});
