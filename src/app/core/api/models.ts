/**
 * The API's wire types, transcribed from the backend's OpenAPI document at
 * `GET /v3/api-docs` (DeskResolver, 26 endpoints / 17 schemas).
 *
 * <p><strong>Why these are written down rather than imported.</strong> The front end lives in its own
 * repository, so a change to a backend DTO cannot break this build - it breaks at runtime instead, as
 * an `undefined` somewhere in a template. These declarations are the only place that drift can be
 * caught, which makes keeping them honest a maintenance obligation rather than a nicety. Regenerate
 * them against a running backend rather than editing by hand; see README.md.
 *
 * <p>Fields are optional where the schema does not list them as required. That is not pedantry: the
 * response DTOs are Java records serialised by Jackson, and every one of their fields can be null.
 */

// -------------------------------------------------------------------------------------------------
// Enumerations
// -------------------------------------------------------------------------------------------------

/**
 * Every permission the backend defines (`security/Permission.java`), in its order.
 *
 * <p>These drive what the UI offers. The server enforces them regardless - hiding a button is a
 * courtesy to the user, never a control - but showing a button that returns 403 is a defect.
 */
export const PERMISSIONS = [
  'TICKET_CREATE',
  'TICKET_READ_OWN',
  'TICKET_READ_ALL',
  'TICKET_STATUS_CHANGE',
  'TICKET_ASSIGN',
  'USER_READ',
  'USER_MANAGE',
  'APPLICATION_READ',
  'APPLICATION_MANAGE',
  'TICKET_COMMENT_READ',
  'TICKET_COMMENT_CREATE',
  'TICKET_ATTACHMENT_READ',
  'TICKET_ATTACHMENT_UPLOAD',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The seven seeded roles (`V17__create_auth_schema.sql`). A user may hold several; access is a union. */
export const ROLES = [
  'EMPLOYEE',
  'MANAGER',
  'HOD',
  'DIRECTOR',
  'IT_SUPPORT',
  'DEVELOPER',
  'ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'PENDING',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type Priority = (typeof PRIORITIES)[number];

/**
 * How far a ticket's problem reaches - **scope, not urgency**. How soon it needs fixing is
 * `Priority`; together they are the impact-and-urgency pair a support desk triages on.
 *
 * <p>In this order, ascending, from one person to everybody. The order is meaningful here in the way
 * `PRIORITIES` is and `TICKET_STATUSES` deliberately is not, so a drop-down should render it as
 * written rather than alphabetically.
 *
 * <p>This was 50 characters of free text until the API's `V23`. Four tickets existed at the time and
 * they said the same thing two ways - `Organization-Level` and `Organization Level` - which is the
 * whole argument for the change. Those spellings are now **400s**, and so is the right constant in
 * the wrong case: the API matches these names exactly.
 */
export const BUSINESS_IMPACTS = [
  'SINGLE_USER',
  'TEAM',
  'DEPARTMENT',
  'MULTIPLE_DEPARTMENTS',
  'COMPANY_WIDE',
] as const;

export type BusinessImpact = (typeof BUSINESS_IMPACTS)[number];

export const ISSUE_TYPES = [
  'BUG',
  'FEATURE_REQUEST',
  'CHANGE_REQUEST',
  'ACCESS_ISSUE',
  'DATA_CORRECTION',
  'PERFORMANCE_ISSUE',
  'REPORT_ISSUE',
  'HOTFIX',
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

// -------------------------------------------------------------------------------------------------
// Authentication
// -------------------------------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

/**
 * Returned by both `POST /api/auth/login` and `POST /api/auth/refresh` - deliberately the same shape,
 * so a client builds the same state from either.
 *
 * <p>`expiresIn` and `refreshExpiresIn` are **seconds**. The second counts down across the working
 * day rather than resetting, because the refresh window is absolute: it is measured from the original
 * login and rotating does not extend it.
 */
export interface AuthenticationResponse {
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  userId?: number;
  fullName?: string;
  roles?: Role[];
  permissions?: Permission[];
}

// -------------------------------------------------------------------------------------------------
// Tickets
// -------------------------------------------------------------------------------------------------

/**
 * All four timestamps are ISO-8601 instants with a `Z` offset, not wall-clock strings - the backend
 * moved these columns to `TIMESTAMPTZ` in V20 precisely so a client could render them in the reader's
 * own zone. Parse with `new Date(...)` and format for display; never slice the string.
 */
export interface TicketResponse {
  id?: number;
  ticketNumber?: string;
  title?: string;
  description?: string;
  issueType?: IssueType;
  priority?: Priority;
  status?: TicketStatus;
  /** Absent when the requester did not say, which is not the same as `SINGLE_USER`. */
  businessImpact?: BusinessImpact;
  expectedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  /** Display name. Not unique - `auth.users.full_name` has no unique constraint. Key on the id. */
  raisedBy?: string;
  raisedById?: number;
  assignedTo?: string;
  assignedToId?: number;
  /** Also not unique; `applications.app_name` is explicitly allowed to repeat across modules. */
  applicationName?: string;
  applicationId?: number;
  moduleName?: string;
}

/**
 * `expectedBy` **must** carry an offset or `Z`. A bare `2026-10-20T17:00:00` is rejected with a 400
 * naming the field: the API refuses to guess which zone a deadline was typed in. Send
 * `new Date(...).toISOString()`.
 */
export interface CreateTicketRequest {
  title: string;
  description: string;
  issueType: IssueType;
  priority: Priority;
  /** Optional. Omit it rather than sending `''`, which the API rejects as an unknown constant. */
  businessImpact?: BusinessImpact;
  expectedBy?: string;
  applicationId: number;
  moduleName: string;
}

export interface UpdateTicketStatusRequest {
  status: TicketStatus;
  remarks?: string;
}

/**
 * Filters for `GET /api/tickets`. `assignedTo` and `raisedBy` take user ids, not names.
 *
 * <p>`q` is a case-insensitive substring match over ticket number, title and description. It is
 * ANDed with the rest, so it narrows them, and it is matched as literal text - `%` and `_` mean
 * those characters rather than wildcards. Sending it blank is the same as not sending it: `toParams`
 * drops empty strings, and the API normalises a whitespace-only one to no filter regardless.
 *
 * <p><strong>It does not widen what the caller may see.</strong> As with the rest of the list, the
 * ownership restriction is applied server-side and ANDed with this, so a search cannot reach a ticket
 * the user could not already open. Worth stating because a search box invites the opposite
 * assumption - that it looks everywhere.
 */
export interface TicketFilters {
  status?: TicketStatus;
  priority?: Priority;
  assignedTo?: number;
  raisedBy?: number;
  q?: string;
}

/**
 * `GET /api/tickets/stats` - aggregate counts for the dashboard.
 *
 * <p>Every field is scoped to what the caller may see, exactly as `GET /api/tickets` restricts its
 * rows, and `scopedToMe` says which of the two happened. **Word headings from that flag, never from
 * the permission list**: the two agree today, but the server decides, and a screen that calls a
 * restricted count "all tickets" is stating something untrue rather than merely imprecise.
 *
 * <p>The two maps carry an entry for every constant the API defines, zero included, so a breakdown
 * renders the same number of rows whatever the data - the server fills the gaps that `group by`
 * leaves. Typed as `Partial<Record<...>>` all the same: these are keys the server chose, and a
 * client that indexes them as guaranteed-present would be trusting a response shape it cannot check.
 */
export interface TicketStatsResponse {
  total?: number;
  open?: number;
  overdue?: number;
  unassigned?: number;
  assignedToMe?: number;
  raisedByMe?: number;
  byStatus?: Partial<Record<TicketStatus, number>>;
  byPriority?: Partial<Record<Priority, number>>;
  scopedToMe?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Comments, attachments, history
// -------------------------------------------------------------------------------------------------

/** Reports its author by name only - there is no `commentedById`. See README.md, "Known gaps". */
export interface TicketCommentResponse {
  id?: number;
  comment?: string;
  commentedBy?: string;
  createdAt?: string;
}

export interface CreateTicketCommentRequest {
  comment: string;
}

/** Metadata only. The bytes come from `GET .../attachments/{id}/content` as a blob. */
export interface TicketAttachmentResponse {
  id?: number;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface TicketHistoryResponse {
  id?: number;
  actionType?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  changedBy?: string;
  remarks?: string;
  changedAt?: string;
}

// -------------------------------------------------------------------------------------------------
// Users, roles, applications
// -------------------------------------------------------------------------------------------------

export interface UserResponse {
  id?: number;
  employeeCode?: number;
  fullName?: string;
  email?: string;
  departmentId?: number;
  designationId?: number;
  roles?: Role[];
  active?: boolean;
}

export interface CreateUserRequest {
  employeeCode: number;
  fullName: string;
  email: string;
  departmentId?: number;
  designationId?: number;
  password: string;
  roles: Role[];
  active: boolean;
}

/** Replaces the user's roles wholesale - it is not additive. Send the complete intended set. */
export interface ReplaceUserRolesRequest {
  roles: Role[];
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface RoleResponse {
  id?: number;
  code?: Role;
  name?: string;
  description?: string;
  active?: boolean;
  permissions?: Permission[];
}

export interface ApplicationResponse {
  id?: number;
  appName?: string;
  moduleName?: string;
  active?: boolean;
}

export interface CreateApplicationRequest {
  appName: string;
  moduleName: string;
  active: boolean;
}

// -------------------------------------------------------------------------------------------------
// Notifications
// -------------------------------------------------------------------------------------------------

/**
 * What a notification is about, in the backend's order (`enums/NotificationType.java`).
 *
 * <p><strong>These are written from the recipient's point of view, not the actor's.</strong> One
 * assignment produces three of them, which is why there is no single `TICKET_ASSIGNED`: the client
 * would otherwise have to work out which side of it the reader is on, and the only thing it could
 * compare is `actorFullName` against the reader's own name. Names are not unique in this API, so two
 * colleagues sharing one would each read the other's assignment as their own.
 */
export const NOTIFICATION_TYPES = [
  'TICKET_AWAITING_ASSIGNMENT',
  'TICKET_ASSIGNED_TO_YOU',
  'TICKET_NOW_ASSIGNED',
  'TICKET_TAKEN_FROM_YOU',
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENTED',
  'TICKET_OVERDUE',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * One notification in the caller's own inbox.
 *
 * <p><strong>There is no rendered message.</strong> The type and the values are reported; the
 * sentence is this client's to write - see `core/notifications.ts`. A sentence stored in a row could
 * not be reworded or corrected afterwards, and every row already written would keep the old text.
 *
 * <p>`ticketNumber` and `ticketTitle` are a **snapshot** taken when the notification was raised,
 * not a join. Neither can be edited through this API so they cannot drift, and the copy is what
 * keeps a notification readable by somebody since reassigned away from the ticket - whose link will
 * still answer 404 for them, which is correct.
 *
 * <p>`actorId` is reported as well as `actorFullName`, unlike `TicketCommentResponse` and
 * `TicketHistoryResponse`, which identify a person by name alone. The difference is what each is
 * for: a client reading this may need to know whether the actor is the reader, and comparing names
 * cannot answer that. Both are null for `TICKET_OVERDUE` - nobody causes a deadline to pass.
 */
export interface NotificationResponse {
  id?: number;
  type?: NotificationType;
  ticketId?: number;
  ticketNumber?: string;
  ticketTitle?: string;
  /** The previous status, or the previous assignee's name. Null where the type carries its own meaning. */
  oldValue?: string;
  newValue?: string;
  actorId?: number;
  actorFullName?: string;
  createdAt?: string;
  /** Null while unread. "When", not "whether". */
  readAt?: string;
}

/** `GET /api/notifications/unread-count`. An object rather than a bare number, so it can grow. */
export interface UnreadCountResponse {
  unread?: number;
}

/** `POST /api/notifications/read-all` - how many were unread until now. */
export interface MarkAllReadResponse {
  markedRead?: number;
}

// -------------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------------

/**
 * RFC 7807 problem detail, which is what every failure from this API looks like.
 *
 * <p>`errors` is the backend's addition for bean-validation failures: field name to message. It is
 * absent on everything else.
 */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string>;
}
