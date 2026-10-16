# DeskResolver — front end

The browser client for the DeskResolver help-desk API. Angular 21, standalone components, signals,
zoneless change detection, Angular Material 21 on a generated indigo M3 palette, with a collapsible
navigation rail and a light/dark theme.

The API lives in a **separate repository** (`desk-resolver`, Spring Boot 4.1.1 / Java 25). That split
is deliberate — the two are worked on by different people — and it has one consequence worth knowing
before changing anything here: **nothing in this repository can break when the API changes.** The
build stays green and the failure appears at runtime instead, usually as an `undefined` in a
template. Everything under [Keeping up with the API](#keeping-up-with-the-api) exists to narrow that
window.

## Running it

```bash
npm install
npm start          # http://localhost:4200
```

The API must be running on **`http://localhost:9211`** with a user account to sign in as.

Nothing needs a proxy: the backend's `APP_CORS_ORIGINS` already defaults to `http://localhost:4200`,
and `SecurityConfig` exposes the response headers a browser client has to read. If requests start
failing as "status 0" with no response, that pairing is the first thing to check — a CORS rejection
reaches JavaScript indistinguishably from the server being down.

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on :4200, watching for changes |
| `npm run build` | Production bundle into `dist/` |
| `npm test` | Unit tests (Vitest), one pass |
| `npx ng test` | Unit tests in watch mode |

## How a session works

The API issues **two** credentials, and they are stored differently on purpose.

| | Lifetime | Where it is kept |
| --- | --- | --- |
| Access token (JWT) | 30 minutes | **Memory only** — a signal in `Auth`, nowhere else |
| Refresh token | 8 hours, absolute | `sessionStorage` |

`src/app/core/auth/auth.ts` holds all of it. Four things about it are load-bearing:

**The access token is never persisted.** It does not survive a reload, which is fine, because the
refresh token exists to rebuild it. Anything able to read storage could read that variable too, so
persisting it would buy nothing and cost the guarantee that closing the tab ends the session.

**`sessionStorage`, not `localStorage`.** Scoped to the tab and gone when it closes. `localStorage`
would outlive the machine being walked away from. An `HttpOnly` cookie is stronger on paper and was
rejected for reasons recorded in the backend's `docs/DECISIONS.md` under *Token storage in the
browser* — chiefly that it would make the credential ambient, which is the single property that
API's security model is built on not having.

**Refreshes are single-flighted, and this is not optional.** The server treats a second presentation
of the same refresh token as evidence it was copied and **revokes the entire login**. Several
requests meeting a 401 together is the normal case, so `Auth.refreshOnce()` keeps one exchange in
flight and every other caller joins it. Firing one per request would sign people out for opening a
page with more than one widget on it.

**The refresh window does not slide.** `refreshExpiresIn` counts *down* across the day, because the
cap is measured from the original login. After eight hours a password is required again whatever
happened in between.

`src/app/core/auth/auth-interceptor.ts` attaches the token and, on a 401, renews once and replays the
request — which is what makes a 30-minute token invisible to the user. It has two deliberate
exclusions and one short-circuit:

- `/auth/login` and `/auth/refresh` never trigger a renewal. A 401 from the refresh call itself means
  the stored token is spent; retrying it is both pointless and harmful, and without this exclusion a
  dead session becomes an infinite retry loop.
- A request that 401s carrying a *stale* token — because something else renewed while it was in
  flight — is replayed with the current token and spends no refresh token at all.

`src/app/core/auth/auth.spec.ts` covers all of it, and is the file to read first if any of this needs
changing.

## Permissions

The login and refresh responses carry the user's `roles` and `permissions`, so gating a screen costs
no extra request. `permissionGuard('TICKET_READ_ALL', ...)` keeps a route out of reach and
`Auth.has(...)` / `Auth.hasAny(...)` decide whether to render a control.

**This hides screens; it does not protect them.** Every endpoint asserts its own permission and a
crafted request gets a 403 whatever the router allowed. The point is that nobody is shown a page or
button that can only fail.

Being *signed in but not entitled* sends the user to `/forbidden`, not to the login screen —
re-authenticating cannot grant a permission, and bouncing them to a password field would read as
"your session expired", which is untrue.

## Keeping up with the API

The wire types live in one file, `src/app/core/api/models.ts`, transcribed from the backend's OpenAPI
document. **Regenerate them against a running API rather than editing by hand:**

```bash
curl -s http://localhost:9211/v3/api-docs > api-docs.json
```

and reconcile. That document enumerates every endpoint, its parameters, and the permission each one
asserts, so it is also the answer to "what can this screen actually call".

Three properties of this API shape the client, and all three are easy to get wrong:

**Timestamps are instants.** Every ticket timestamp is ISO-8601 with a `Z` offset — the backend moved
these columns to `TIMESTAMPTZ` in migration V20 precisely so the client could render them in the
reader's own zone. Parse with `new Date(...)`; never slice the string.

**`expectedBy` must carry an offset.** A bare `2026-10-20T17:00:00` is rejected with a 400 naming the
field: the API refuses to guess which zone a deadline was typed in. Send
`new Date(...).toISOString()`.

**Lists are plain arrays; paging is in headers.** `X-Total-Count`, `X-Total-Pages`, `X-Page-Number`,
`X-Page-Size`, `X-Has-Next`. So a list call needs `{ observe: 'response' }` and `toPage()` from
`src/app/core/api/page.ts` — `HttpClient.get<T[]>()` cannot see the count. These headers are readable
cross-origin only because the backend lists them in `exposedHeaders`; if they read as `null` in the
browser but appear in curl, that list is where to look.

**One endpoint is an aggregate, not a collection.** `GET /api/tickets/stats` answers every figure
on the dashboard from a single request. The same numbers were obtainable from `/api/tickets` by
asking once per status, once per priority and three more times for the scalars, reading
`X-Total-Count` off each — but fourteen requests are fourteen moments, so the headline figure and the
chart beside it would describe different states of the database whenever anything changed mid-load.
Its counts respect the caller's visibility exactly as the list does, and `scopedToMe` says which of
the two happened — **word headings from that flag, not from the permission list**.

Also worth knowing: display names are **not unique**. Neither `auth.users.full_name` nor
`applications.app_name` has a unique constraint, so always key on the ids — `raisedById`,
`assignedToId`, `applicationId` — and treat the name strings as presentation only.

## Layout

```
src/
├── styles.scss         the Material theme, the design tokens, the page chrome, Material overrides
├── styles/
│   ├── _theme-colors.scss  generated M3 palettes — see Look and feel
│   ├── _page.scss          .page / .surface / .state-block / .avatar / .search-chip, global
│   └── _status-pills.scss  status and priority colours, a mixin
└── app/
    ├── core/
    │   ├── api/        models.ts (the wire contract), page.ts (header paging),
    │   │               tickets.ts, comments.ts, attachments.ts, users.ts,
    │   │               notifications.ts
    │   ├── auth/       auth.ts, auth-interceptor.ts, auth-guard.ts
    │   ├── theme.ts    the light/dark preference
    │   └── notifications.ts  what the header's bell shows, and how each line reads
    ├── layout/shell/   the rail and header around every signed-in screen
    ├── layout/command-palette/  Ctrl+K: every screen the user may open, in one list,
    │                            plus the header search box that opens it
    ├── features/       one folder per screen, each lazily loaded
    └── app.config.ts   providers; also where the session is restored before routing starts
```

The shell wraps the authenticated routes rather than the whole application, because the login screen
is full-page and must not render chrome around itself — and because the navigation is built from
permissions, which the login screen by definition has none of.

Every route is lazy. At this size that buys little; the pattern is the point, since an `EMPLOYEE`
should not download the user-administration screens in order to never open them.

`app.config.ts` blocks startup on `Auth.restore()`, which spends the stored refresh token before the
first route renders. Without it every reload would bounce the user to the login screen while a
perfectly good refresh token sat in storage.

## Conventions

Angular's own current guidance. The ones that come up most:

- Standalone components; never `standalone: true` (it is the default) and never `NgModule`.
- `inject()`, not constructor injection. `input()` / `output()`, not the decorators.
- Signals for state, `computed()` for anything derived.
- `ChangeDetectionStrategy.OnPush` on every component — the app is zoneless, so change detection
  follows signals, and a component without it relies on something that is not there.
- Native control flow (`@if`, `@for`, `@switch`), reactive forms, `class`/`style` bindings rather
  than `ngClass`/`ngStyle`.
- Filenames follow the 2025 style guide (`login.ts`, not `login.component.ts`), which is what
  `ng generate` produces here.

Accessibility is a requirement, not a polish step: WCAG AA contrast, focus management and ARIA, which
is most of why the UI is Material rather than hand-rolled.

## Look and feel

A dark navigation rail beside a light content canvas, indigo accents, Inter and Material Symbols
Rounded. Five things about how that is built are worth knowing before changing any of it.

**The palette is generated, not hand-picked.** `styles/_theme-colors.scss` came from
`ng generate @angular/material:m3-theme` seeded with `#4f46e5`, and carries the full set of M3 tones
including a blue-tinted neutral. **Regenerate it rather than editing tones by hand** — the file says
so at the top, and the tones are related to one another by the algorithm that produced them:

```bash
npx ng generate @angular/material:m3-theme --primary-color="#4f46e5" \
  --secondary-color="#7c3aed" --tertiary-color="#8b5cf6" --neutral-color="#1a1d2e" \
  --directory="src/styles/" --is-scss=true --defaults --interactive=false
```

**Dark mode is one CSS property.** `mat.theme()` emits every colour as `light-dark(…)`, so
`core/theme.ts` writes `data-theme` onto `<html>` and the stylesheet's three `color-scheme` rules do
the rest. There is no second palette to load and nothing to recompute, which is why the toggle is
instant. `system` is a third state rather than the absence of the other two — it has to re-expose
both palettes with `color-scheme: light dark`, which an unset attribute cannot.

**The rail stays dark in both themes, deliberately.** It is the one surface that should read as the
product's frame rather than as part of the page. Its own tokens are `--app-rail-*`; everything the
chrome needs that Material has no role for — the canvas, the shadows, the radii, the brand gradient,
and `success`/`warning`, which M3 does not define — is an `--app-*` token in `styles.scss`.

**Motion is four durations and two curves, and nothing declares its own.** `--app-dur-fast` /
`-base` / `-slow` with `--app-ease` and `--app-ease-inout` live in `styles.scss`. The scale is by
**distance, not importance**: a colour changing under the cursor has nowhere to travel, so `fast` is
as long as it should take, while the overlay drawer crosses its own width and is the one `slow` in
the shell. `--app-dur-draw` is a fourth duration and deliberately outside that scale — it times a
chart revealing itself, which nobody is waiting on because the value is printed beside every bar.

Two shared pieces carry almost all of it, both in `styles/_page.scss`: `.page` animates on arrival,
so every screen enters the same way from one declaration, and `.stagger` on a container brings its
children in sequence (35 ms apart, capped at ten). The rail and the header deliberately do **not**
move on navigation — they are the frame, and a frame that re-enters reads as a full page load.

**Reduced motion is one switch**, not a guard per animation. `styles.scss` has a single
`prefers-reduced-motion` block, because per-declaration guards make every future animation opt-in
and the one somebody forgets is invisible to everybody who does not need it. It sets `1ms` rather
than `none` on purpose: several Material components finish their work in a `transitionend` or
`animationend` handler, and removing the transition outright means the event never fires and the
component is left mid-state.

**Icon names are not interchangeable with the old font.** Material Symbols replaced the `_outline`
suffix with a variable `FILL` axis, so `error_outline` and friends have **no glyph** and render as
their own ligature text. `app.config.ts` sets the font set once via `MAT_ICON_DEFAULT_OPTIONS`;
`styles.scss` sets the axes, and `.icon-filled` is the filled variant. If an icon ever renders as a
word, that name is a legacy one.

Six screens share one layout vocabulary from `styles/_page.scss` — `.page`, `.page-head`,
`.surface`, `.state-block`, `.avatar` — and it is **global rather than a mixin**, unlike
`_status-pills.scss` beside it. Pills are two components' semantic colours; this is the application's
layout, and as a mixin it was duplicated into every screen and pushed four of them past the
per-component CSS budget. Each screen still sets its own `--page-max`.

**Two components warn against the 4 kB per-component CSS budget** on a production build:
`layout/shell/shell.scss` (~6.6 kB) and `features/dashboard/dashboard.scss` (~6.6 kB). Both are
expected rather than regressions — the rail has three states (full, collapsed, overlay drawer), and
the dashboard is the widest screen here, carrying a figure row, two breakdown panels and an activity
list. Roughly 1.6 kB of each is the `_status-pills.scss` mixin, which is duplicated by design into
every component that renders a ticket. Raise the budget in `angular.json` if the warning is unwanted
— but only two components are over it, which is the signal worth keeping.

The 8 kB figure in that budget is an **error**, not a warning, and the shell has run into it twice.
A search field built into `shell.scss` took it to 8.06 kB and the build failed outright. The second
time was closer and quieter: the search box that replaced that field took it to 7.69 kB, which passes
with 310 bytes to spare — not a margin to leave the frame of the whole application sitting on. Both
are why `SearchTrigger` is a component rather than markup in `shell.html`: its styles are its own, and
the shell is back to 6.6 kB. If a third rule ever needs to go in there, that is the signal to split
the header out, not to raise the budget.

## Notifications

Backed by the API's own `/api/notifications` since the backend's `V22`. The bell has real rows and
real read state: `core/api/notifications.ts` is the service, `core/notifications.ts` is what the
header reads.

**This replaced a derived version.** Before `V22` there was no notifications endpoint, so the panel
was computed from a page of recently updated tickets — honest, but a view rather than an inbox: it
had no read state, so a line disappeared when its ticket stopped matching rather than when somebody
had seen it, and there was nothing to mark as read. That service is gone.

**The wording lives in this client, not in the database.** The API stores the type and the values and
no sentence, deliberately — a sentence written into a row could never be reworded, corrected or
translated afterwards. So every line a reader sees is built in `render()` in
`core/notifications.ts`, and changing how a notification reads is a change to that one function.

**The type is recipient-specific, and that is why nothing compares names.** One assignment produces
three notifications — `TICKET_ASSIGNED_TO_YOU`, `TICKET_NOW_ASSIGNED`, `TICKET_TAKEN_FROM_YOU` —
rather than one `TICKET_ASSIGNED` the client has to interpret. The only thing it could interpret is a
full name, and names are not unique in this API, so two colleagues sharing one would each read the
other's assignment as their own.

**Two requests, both on load.** The list and `unread-count` answer different questions — how many
notifications exist, and how many are unread — and the second is served from an index over unread
rows alone. Both are fetched when the shell loads rather than when the panel opens, which costs two
cheap requests and buys a badge that is correct before anybody clicks, and one that can turn red for
an unread overdue ticket. Both are suppressed entirely without a session, otherwise the bell would
401 on the login screen and the interceptor would spend a refresh token answering it.

**Nothing is updated optimistically.** Opening a notification marks it read and then refetches; the
badge count is always the server's number. Guessing it here would make two sources of truth for the
one figure a user actually watches. A failed `PATCH` still refetches, so the row stays visibly unread
rather than looking read.

One trap worth knowing before touching this file: **`httpResource.value()` throws when the resource
is in an error state** — it rethrows the failure rather than returning `undefined`, so `value() ?? []`
is not a fallback. `list()` and `count()` check `error()` first. Without that guard a single failed
request takes down the header on every screen, because the badge reads `list()` to decide its colour
and renders whether or not the panel is open.

Not built: no push and no email — the API records notifications but delivers nothing, and adding
delivery is a backend change (see its README). No per-user preferences, and no digest for managers.

## Screens

| Route | Needs | Notes |
| --- | --- | --- |
| `/login` | — | Full-page, outside the shell |
| `/dashboard` | `TICKET_READ_OWN` or `TICKET_READ_ALL` | **The landing route** — `''` redirects here |
| `/tickets` | `TICKET_READ_OWN` or `TICKET_READ_ALL` | Filters, search (`?q=`), sorting, paging |
| Ctrl+K | a session | The command palette — not a route; a dialog over whatever is open |
| `/tickets/new` | `TICKET_CREATE` (+ `APPLICATION_READ` to pick) | Raise a ticket |
| `/tickets/:id` | the same pair | Detail, discussion, attachments, history |
| `/admin/users` | `USER_READ` (`USER_MANAGE` to change anything) | Accounts and their roles |
| `/admin/applications` | `APPLICATION_READ` (`APPLICATION_MANAGE` to change) | The catalogue |
| `/account` | a session | Own roles and permissions; change own password |
| `/forbidden` | a session | Where `permissionGuard` sends the unentitled |

Six things in the ticket screens are worth knowing before changing them.

**The search lives in the URL, and nothing else holds a copy of it.** `?q=` is the whole of the
state. `TicketList` reads it with `requireSync`, so a pasted link does not flash the unfiltered queue
past first, and the chip in the filter bar is how the list says it read one — the lede already claims
"matching these filters", and this is the filter that is not a control in that row. Removing the chip
drops the parameter, which is also how the search is cleared.

What writes it is the **command palette**, not a field on this screen. See the section below.

The page index is a `linkedSignal` sourced from the term, so a new search starts at page one —
otherwise page 4 of the old result set becomes page 4 of a one-page one, which the API answers with
an empty body and a reader reads as "no tickets".

The server matches the term case-insensitively against ticket number, title and description, as a
literal substring: `%` and `_` are escaped, so they mean those characters rather than LIKE's
wildcards. And it is ANDed with the ownership restriction, so a search cannot reach a ticket the user
could not already open.

**Sortable columns are a server whitelist.** `GET /api/tickets` accepts `createdAt`, `updatedAt`,
`priority`, `status`, `ticketNumber` and `id` — nothing else, and anything else is a 400. `title` has
no sort header for that reason. The list also drops the parameter entirely when a Material sort
header is clicked a third time, because `sort=createdAt,` is a 400 rather than a reset.

**Attachments cannot be downloaded with a link.** The endpoint needs an `Authorization` header and a
plain `<a href>` sends none, so the bytes come through `HttpClient` — and therefore through the auth
interceptor — and the blob is saved client-side. The filename comes from `Content-Disposition`,
preferring its RFC 5987 `filename*` form, with the list row's `fileName` as the fallback.

**Each panel decides its own permission, rather than trusting the route's.** The route accepts
`TICKET_READ_OWN` *or* `TICKET_READ_ALL`, but `GET /{id}/history` asserts `TICKET_READ_OWN`
specifically, and the comment and attachment panels assert their own. A panel whose permission is
missing asks for nothing at all, instead of firing a request to display its 403.

**Business impact is a drop-down, and it is about scope.** Five options, rendered in the order
`BUSINESS_IMPACTS` declares them rather than sorted — the list is a scale from one person to
everybody, and sorting it alphabetically would scatter that. It was a free-text box with a
50-character limit until the API's `V23`; the four tickets that existed by then had spelled the same
answer two ways, which is the whole argument. The label a reader sees is humanised
("Multiple departments"), while what goes over the wire is the constant, because the API matches
those names exactly — `ticket-create.spec.ts` has the test that fails if the two are ever swapped.

The blank option reads "Not sure / not stated" and sends **nothing**. The field is optional, and an
absent impact means the requester did not say, which is a different claim from the narrowest option.
`null` would be a 400, and so would `''`.

**The create form never asks for a module.** `CreateTicketRequest` carries `moduleName` alongside
`applicationId`, which looks like a second question and is not one: the server rejects any module
that is not that application's own, case-insensitively. An `applications` row *is* an application
and a module — `app_name` and `module_name` side by side, neither unique alone — so the picker offers
rows and the form sends the chosen row's module. A text box there could only ever produce 400s.

**`expectedBy` is converted, not typed.** The field is a `datetime-local` input, so the browser
collects `2026-10-20T17:00` with no zone, and `new Date(...).toISOString()` turns it into the instant
that value means *in the reader's own zone*. That is the whole point of the API refusing offset-less
datetimes: it will not guess a zone, and the browser is the one party that does not have to.
`/tickets/new` is also declared **before** `/tickets/:id`, and that order is load-bearing — swapped,
the router would resolve `new` as an id.

## The command palette

**Ctrl+K** (or Cmd+K) anywhere inside the shell opens a dialog listing every screen this user may
open, grouped as the rail groups them. Arrow keys move, Enter opens, Escape closes, and clicking a row
does the same as Enter on it. Typing filters by label *and* by group name, so "admin" finds People and
Applications.

The header carries a **search box** that opens the same thing — and it is a button, not a field. It
takes no typing: clicking it opens the palette, and the palette owns the input. A real field there
plus a dialog here would be two places to type a search, kept in step with each other for no gain.
The `Ctrl+K` pill printed on its right is what resolves the ambiguity, and it is most of the reason
the control is drawn at all: a shortcut nothing points at is a feature only the person who built it
knows about. It is one pill rather than two key caps on purpose — it names a single shortcut, where
the palette footer names several keys individually and draws each as its own cap. Below 768px it collapses to the icon it already contains, since the hint, the keys, the
title and three controls cannot share one row — and that shortcut is not on a phone keyboard anyway.

Five things about it are deliberate.

**It reads no permissions and calls no API.** `Shell.sections` has already decided what this user may
reach, and the palette is handed that list. A palette with its own copy would be a second answer to
the same question, and the half that was wrong would be the one nobody looks at.

**It returns a choice; the shell acts on it.** `PaletteChoice` is either a path to navigate to or a
term to search for. That keeps the dialog testable without a router, and it keeps the two kinds of
outcome beside each other in `Shell.act` where the difference between them is visible.

**The ticket search is the last row, and only appears once something has been typed.** Going
somewhere is what the palette is for, so Enter opens a screen whenever one matches; the search is what
is left when nothing does, and then it is the only row and Enter picks it. It is offered at all only
to somebody holding `TICKET_READ_OWN` or `TICKET_READ_ALL`.

**`preventDefault` on the shortcut is not optional.** Ctrl+K focuses Firefox's own search bar and puts
Chrome's address bar into search mode. Without it the palette opens behind a focused address bar.

**The box is a component, `SearchTrigger`, beside the palette rather than inside the shell.** It
belongs to the palette rather than to the shell's layout — and `shell.scss` is the one stylesheet
here where another forty lines is a build failure rather than a warning. See **Look and feel**.

This replaced a permanent search field in the header. The field was always present and did one thing;
this is summoned, lists what the rail lists, costs nothing when closed — and it is what a search box
in a toolbar is usually standing in for anyway: not "filter this screen" but "take me somewhere".

### Raising a ticket is offered in one place

The ticket list's own header, and nowhere else. It used to be in three: a filled **New ticket** button
in the shell's header on every screen, a **Raise a ticket** button on the dashboard, and the one on
the list. Three buttons for one action is three things to keep worded the same, and two of them sat on
screens that are not about creating anything — the dashboard is a page of counts.

The rail still carries `/tickets/new`, and so does the palette, because navigation is a different
claim: a list of destinations says where you may go, while a filled button says what to do next. The
dashboard's empty state now points at `/tickets` rather than straight at the form, so an empty
dashboard still has a way forward without becoming a fourth place to offer the action.

`shell.spec.ts` pins both halves — no create link in the header, `/tickets/new` still in the rail.

## The administration screens

Three things about them come from the API's shape rather than from a design choice.

**A user's roles are the only thing that can be changed.** There is no endpoint to edit a name, an
email or the `active` flag of an existing account — `POST /api/users` sets them and nothing revises
them. So the list offers *Change roles* and nothing else, and says so rather than leaving a reader to
wonder where Edit went. `PUT /{id}/roles` also **replaces** the set rather than adding to it, which
is why the dialog opens with the current roles already selected.

**Changing your own password signs you out everywhere.** `changeOwnPassword` revokes every session
for the account, the current one included, so the tokens this tab holds are dead the instant it
succeeds. The screen clears them and goes to the login page deliberately; letting the user discover
it as their next click failing would read as a fault. The dialog says so before they start.

**`GET /api/roles` needs `USER_MANAGE`, not `USER_READ`** — easy to get wrong, since it looks like
reference data. The list exists so whoever *assigns* roles can see the choices, so it is gated with
the assigning. Support staff who can read the user directory cannot read this.

Two further notes on these screens:

- The role dialog shows the permissions the chosen roles **add up to**, derived from the catalogue
  rather than from a rule restated in the client. Permissions are a union — adding a role only ever
  widens access — and "MANAGER plus IT_SUPPORT" is not obvious from the names.
- `DELETE /api/applications/{id}` **deactivates**; the row stays so tickets already raised against it
  keep naming it. It is confirmed first, because the consequence is not local to the screen: nobody
  can raise a ticket against an inactive application.

`department_id` and `designation_id` are **not** on the create-user form. They are nullable `BIGINT`
columns with no foreign key and no departments or designations table behind them — V11 says as much —
so nothing validates them, nothing resolves them to a name, and nothing in this application reads
them. A number box with nothing to look a value up in is a data-entry trap. If those tables arrive,
these become pickers.

## Not built yet

Every screen the API supports exists, and every endpoint is called from one except two:
`GET /api/users/{id}` and `GET /api/applications/{id}`, because the list screens already hold the
complete record for every row and there is nowhere that needs to refetch one. Both are implemented in
`core/api/` anyway, since those services mirror the API rather than only what today's screens happen
to use.

(This sentence used to give the count as a fraction. The backend's own README records why that is a
bad idea — a number nothing verifies is a comment that rots — and it rotted the moment `V22` added
four endpoints.)

What is missing is depth rather than coverage: no saved filters or views, no bulk actions, no
reporting beyond the dashboard's own figures, and no e2e tests (`ng e2e` has no runner configured).

One gap that used to be the API's is now only unbuilt:

- **There are no statistic tiles on the ticket list.** This used to read "the API has no aggregate
  endpoint", which was the whole reason — deriving counts from one page gives a number that silently
  means "on this page" while reading as "in total". `GET /api/tickets/stats` now answers exactly
  those counts, respecting the caller's visibility, and `/dashboard` is built on it. Putting the same
  figures above the list is work nobody has done, not a wall.

(This section also used to say there was no search box in the header, because `TicketFilters` had no
text field and no endpoint accepted one. `GET /api/tickets` now takes `q`, and the way in is Ctrl+K —
see **The command palette**. Deep links from the dashboard's tiles into a filtered list are still
missing, and now need less than they did: `?q=` proved the plumbing, but the other filters are still
component state rather than URL state, so a link to "overdue tickets" has nothing to point at.)

Two further gaps on the API side affect this client:

- `TicketCommentResponse`, `TicketAttachmentResponse` and `TicketHistoryResponse` identify people by
  **name only**. Names are not unique, so a thread cannot reliably attribute an entry to a user
  record or link to one. Rendering a name is fine, which is all these panels do; anything more needs
  `commentedById` adding there.
- `Retry-After` on a throttled login (429) is **not** in the backend's `exposedHeaders`, and is not a
  CORS-safelisted header either, so cross-origin this client cannot read it. The login screen says
  "wait a while" rather than counting down. Adding it to that list would fix it.

And one wording defect worth fixing at the source: a wrong **current** password on
`PATCH /api/users/me/password` answers with `"Invalid email or password."`, the uniform sentence
written for the login endpoint. There is no email in that request and no account to enumerate — the
caller is already authenticated — so this client replaces it rather than passing it on. It is the
same defect `InvalidRefreshTokenException` was introduced to fix, in a third place.
