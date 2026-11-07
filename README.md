# Carevanta Super-Admin Dashboard

Administrative console for the Carevanta healthcare marketplace. Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query & Table · React Hook Form + Zod · Recharts · Lucide icons. Black primary identity (black sidebar, buttons and hero banner) with a colourful accent palette reserved for data, status and actions.

Every screen calls the real API (`Carevanta_Backedn_Api`, `/api/v1`). There is no mock data in the application: empty states appear until the backend has records, and analytics show which environment the figures come from.

## Run

```bash
npm install                       # .npmrc enables legacy-peer-deps (npm 10 peer-resolution bug)
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                       # http://localhost:3000 → /login
```

The API's `CORS_ORIGINS` must include the dashboard origin. Sign in with an account created by `npm run admin:bootstrap` in the backend repo.

Checks: `npm run typecheck` · `npm run lint` · `npm test` (Vitest + Testing Library, jsdom) · `npm run build`.

## Structure

```
src/app/login                 sign-in (lockout / inactive / rate-limit messages)
src/app/(admin)/…             26 navigation areas behind the authenticated shell
src/components/layout         sidebar/topbar shell, permission-filtered navigation
src/components/ui             primitives (button, inputs, dialog, badge, table, states), toasts
src/components/charts         colourful Recharts series (status-aware colours) + breakdown bars
src/components/providers      full-screen provider registration dialog (details → documents → done)
src/components/forms          LocationFields (PIN auto-fill), ProviderPicker (search-as-you-type provider selector)
src/components/finance        shared finance pieces: money/bps helpers, calcCommission, KPI tiles, lifecycle strip, CSV export button
src/lib/geo.ts                useStates/useCities/lookupPincode hooks over /public/geo
src/components/settings       branding (name/tagline/logo) and SMTP configuration forms
src/lib/branding.tsx          useBranding() + <Logo/> (auto-fits any uploaded logo into a fixed-height box)
src/lib/api.ts                typed fetch client: bearer token, single-flight refresh, ApiError with field errors, idempotency keys, protected downloads
src/lib/auth.tsx              AuthProvider: /auth/me, permissions, can()
src/lib/hooks.ts              useGet, useAction (toast + invalidation), filters, debounce
```

## Design system

- **Black is the brand**: sidebar, primary buttons, the overview hero banner and focus rings are `ink` (#0a0a0a) on a light-grey canvas with white cards (rounded 2xl, soft shadow).
- **Colour carries meaning**: six accents (`blue`, `green`, `orange`, `purple`, `red`, `teal`) defined once in `globals.css` and `ACCENT` in `primitives.tsx`. Status badges, KPI icon tiles, progress bars, quick-action tiles and chart series all draw from the same palette, so a green bar in a chart means the same thing as a green badge in a table. `seriesColor()` maps status-like series names (completed → green, cancelled → red, pending → orange, confirmed → blue) and falls back to the ordered palette.
- **Shell**: fixed-height viewport; the black sidebar scrolls independently; the top bar has the page title, global search (users, or paste a provider id), a notifications bell (red dot when deliveries have failed) and an avatar menu. Below `lg` the sidebar is a drawer.
- **Create flows** open a ~90% full-screen `Dialog size="full"` instead of navigating away; filters sit in one wrapping row (`FilterBar`).
- **Responsive**: 1 → 2 → 4 column grids, tables scroll horizontally, dialogs are 95vw on phones.

## No hardcoded geography

State, district, city and locality fields (`src/components/forms/location-fields.tsx`) are driven by the API's reference data: states and cities from the ISO dataset, and PIN-code auto-fill from the India Post directory (state, district, block, post offices). City and locality accept free text with suggestions because small towns are missing from every dataset. Medical councils are suggested from the state list. Service regions, the dispatch drill district and provider locations all start empty; the Moyna/Tamluk pilot is just data in Settings → Service regions. `HOME_COUNTRY` in `src/lib/geo.ts` is the single place the country is set.

## Finance screens

- **Commission rules**: KPIs (active, awaiting approval, high-risk without legal approval, drafts), latest-version filter, scope/terms/effective columns, a detail dialog with lifecycle strip, blockers explained (author cannot activate, legal gate, rejected review), supersede handling for overlapping versions, legal-review recording, retire with reason, version history and a client-side worked-example table using the same integer rounding as the API (`calcCommission` in `src/components/finance/shared.tsx`). The editor validates rate/flat/min/max/tax/dates and shows a live preview; the calculator resolves the real policy for a provider and amount.
- **Payments & refunds**: 30-day KPIs, provider picker filter, CSV export, a full transaction view (tiles, commission snapshots, payments, refunds with lifecycle, append-only ledger with running balance), refund request capped at the refundable amount (excluding in-flight refunds) with a Full button, maker–checker review dialog, webhook explanations, and a reconciliation runner that parses pasted or uploaded statements (header detection, per-line errors, 5,000-line limit) and lets you filter results by run.
- **Provider settlements**: KPIs from the overview, payable balances with ready/blocked/negative totals and a per-provider ledger dialog, a prepare-batch dialog that previews what will be included and skipped and explains "nothing due" responses, and a batch view with lifecycle, payout progress, per-item UTR recording (validated, not in the future), failure recording and cancel-with-reason, all gated by maker–checker rules.

## Manual finance operations

Holders of `finance.manual.record` see extra actions: **Record offline payment** on a transaction (platform account vs. paid at the provider), **Mark abandoned** on stuck online checkouts, **Record manual refund** on requested/approved/failed refunds (never their own request), **Post adjustment** on a provider ledger (credit/debit with reason), and **Replay** on failed webhooks. Every action asks for a reason and is audited; nothing is edited in place.

## Navigation (permission-gated)

Overview · Users · Roles & permissions · Doctors · Hospitals · Clinics · Diagnostic labs · Imaging centres · Pharmacies · Ambulance operators & vehicles · Provider applications · Credential verification · Doctor–hospital affiliations · Departments & services · Appointments · Pharmacy orders · Diagnostic orders & reports · Ambulance dispatch · Payments & refunds · Commission rules · Provider settlements · Complaints & disputes · Notifications · Reports & exports · Audit logs · Platform settings (+ regions, legal holds, incidents).

Items are hidden when the signed-in user lacks the permission; pages additionally render a clear "no access" state. The API enforces every permission server-side — the UI gating is a convenience, never the security boundary.

## Behaviours worth knowing

- **Tokens**: the access token lives in memory; the refresh token in `localStorage`. A 401 triggers one refresh and retry; a failed refresh returns the user to `/login`.
- **Forms**: validated client-side (Zod) and server-side; API field errors are mapped back onto the form. Buttons disable while a request is in flight (double-submit protection); destructive actions use confirmation dialogs; the provider registration form warns before leaving with unsaved changes.
- **Sensitive files** (credential documents, medical reports, exports) are fetched with the bearer token and require a stated purpose, which the API logs.
- **Maker–checker** is reflected in the UI: a user never sees "approve" for something they created (verification, refunds, settlement batches, commission policies, clinical mappings).
- **Emergency**: dispatch screens never show an ambulance as assigned unless an operator accepted; the "live dispatch" switch in settings carries an explicit warning.

## Tests

`src/lib/api.test.ts` (token refresh, error mapping, idempotency header), `src/components/layout/nav.test.ts` (26 areas, permission filtering), `src/components/ui/data-table.test.tsx` (cursor paging, empty/error states), `src/app/login/page.test.tsx` (validation, lockout message, redirect).

## Demo Logins

All demo accounts (Super Admin, one per provider type, patient) with passwords and what data each one sees: see [Carevanta_Backedn_Api/docs/demo-logins.md](../Carevanta_Backedn_Api/docs/demo-logins.md). Development only.
