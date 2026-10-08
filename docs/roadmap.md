# Čekis — Project Brief and Complete MVP Roadmap

Version: 1.0 · Date: 2026-10-05 · Status: scope reference; implementation status is tracked in `docs/progress.md`.

## 1. Read this first

Čekis is a new, focused application for keeping receipts organised and receiving reminders before a recorded warranty expires.

**Product promise: Save your receipts. Find them easily. Know when your warranty ends.**

Brand name: **Čekis**. All interface copy, errors, emails and accessibility labels must be Lithuanian. Project discussions, code documentation and sprint specifications may be English.

This document is the authoritative starting brief for the new project. The owner will also upload four app design images. Use those images as visual references together with the design rules below. Do not assume the images have been inspected until they are available in the new project.

There are **12 planned sprints**, preceded by a small foundation checklist called Phase 0. Phase 0 is preparation, not a thirteenth sprint. Sprint lengths depend on implementation and verification; these are deliverable boundaries, not promises of calendar duration.

The roadmap does not authorise implementing every sprint at once. Implement the sprint the owner requests, preserve the scope boundaries, and report its actual completion state.

## 2. Scope contract

The MVP supports:

- A private user account.
- Photographing or uploading receipts and preserving their original files.
- Manually adding, editing, deleting, finding and organising purchase records.
- OCR suggestions that the user reviews and confirms.
- User-entered or user-confirmed warranty dates.
- Warranty status and reminders before expiry.
- A simple mobile-first, installable web application.

The following are outside this roadmap and require an explicit future instruction from the owner: consumer-rights questionnaires, legal warranty calculations, return eligibility, complaints, VVTAT packages, dispute/case tracking, wishlists, price comparison, spending analytics, budgeting, retailer integrations, family accounts, an AI assistant, email receipt importing, and native iOS/Android applications.

Do not add these features, navigation entries, dormant services or speculative database tables. A warranty reminder is a notice about a saved date, not a legal decision or a recommendation to file a claim.

## 3. Relationship to the previous project

The previous application was Pirkėjo Skydas. Its historical repository is https://github.com/IgnasGaj/pirkejo_skydas.

Čekis starts in a **new project folder with its own architecture, schema and repository**. The old repository is a reference for lessons and selected implementation patterns. It is not the new project's remote and is not a verified current code baseline.

Useful lessons include preserving original receipt bytes, reviewing OCR suggestions, testing two-account isolation, handling upload retries and cancellation, and keeping development and production build outputs from interfering with one another.

Do not copy the old legal workflows or its Supabase-dependent infrastructure. Existing users/data do not automatically migrate; migration is outside the initial implementation unless requested.

## 4. Technical stack

**PostgreSQL is confirmed. Supabase is not the backend for this rebuild.**

| Layer | Planned choice | Responsibility / decision status |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript | Mobile UI and server-side application endpoints; one application |
| Styling | Tailwind CSS, simple line icons | Small reusable component set; no heavy dashboard template |
| Database | PostgreSQL | Confirmed relational source of truth |
| Database hosting | Neon is the proposed starting provider | Provider remains replaceable; verify pricing and region before provisioning |
| Data access | Drizzle ORM and versioned SQL migrations | Typed queries, explicit schema, reproducible upgrades |
| Authentication | Auth.js is the proposed starting library | Finalise supported login/recovery approach in Phase 0/Sprint 1; PostgreSQL-backed account/session persistence |
| Receipt storage | Private S3-compatible object storage | Original image/PDF bytes live here, not in PostgreSQL; provider to be chosen |
| Input validation | Zod | Shared input rules with authoritative server validation |
| OCR | Tesseract.js with Lithuanian and English language data | Initial browser-side extraction; manual entry always available |
| Email | Transactional email service behind a small adapter | Verification/recovery if required and warranty reminders; provider to be chosen |
| Scheduling | Hosted scheduler invoking a protected reminder worker | Durable reminder state in PostgreSQL; hosting choice to be confirmed |
| Tests | Vitest, React Testing Library, Playwright | Domain/component tests, browser flows and isolation checks |
| Repository / CI | New GitHub repository and GitHub Actions | Repeatable install, lint, typecheck, tests and build |
| Delivery | Responsive web app; PWA in Sprint 9 | Native applications are outside MVP |

Use a supported stable release combination at implementation time and lock dependencies. Do not inherit the old project's version numbers blindly. Verify official documentation before choosing authentication APIs or deployment-specific features.

Budget target: free/freemium development and initial testing. A free plan is not a guarantee of zero-cost production. Flag paid requirements before activating them. Record hosting, storage, email, scheduling, backup and domain costs and quotas before deployment. Select EU hosting regions where available and document actual data locations and provider terms.

Keep the architecture small: browser → Next.js server → PostgreSQL/private object storage. OCR can run in the browser; a scheduled worker processes reminders. Authentication, file access and database ownership checks remain server-enforced. Do not introduce microservices, realtime infrastructure or paid AI OCR by default.

## 5. Core data rules

Start with the entities required by the current sprint. The eventual MVP needs:

| Entity | Purpose |
| --- | --- |
| User / auth records | Identity, sessions and required account lifecycle data |
| Purchase | Owner, product name, seller, purchase date, optional price/currency, notes and optional category |
| Receipt | Owner, private object key, original filename/type/size, upload state and optional reviewed receipt number |
| Purchase–receipt association | Links purchases to their evidence without duplicating an original file |
| Warranty fields | Unknown, none, or known end date; optional confirmed duration |
| Reminder settings / delivery records | Preferences, due dates, retries and sent/cancelled state |

One receipt can cover several products. Store its original once; allow purchases to share a receipt owned by the same user. A purchase may also have several attachments. The first UI can add one purchase at a time; automatic receipt line-item splitting is outside MVP. Deleting a purchase must not delete a receipt still used by another purchase.

Use PostgreSQL `date` for purchase/warranty calendar dates and timezone-aware timestamps for events. Store money as fixed precision or integer minor units, never floating-point values. Use EUR as the UI default without silently interpreting other currencies as EUR.

Unknown warranty and no warranty are different states. New purchases default to 24 months, with 6, 12, 24 and 36-month choices. Calculate the end date from the purchase date and selected calendar-month duration, clamping month ends; saving confirms the calculated date without a separate step. Existing records keep their recorded state, duration and end date. Legacy end-date-only records retain their saved date on unrelated edits and can be explicitly converted to a duration. No reminder should exist without a recorded warranty end date. These periods are tracking choices, not legal determinations.

Every record and file must be scoped to its authenticated owner. Never accept a client-provided owner ID as authority. A random UUID or hidden button does not provide access control. Enforce ownership in database queries and file authorisation; use a limited database role and test cross-account denial. PostgreSQL RLS may add defence in depth if implemented correctly, but it is not automatically provided by choosing PostgreSQL.

Treat uploads and record creation as a recoverable workflow: validate the upload, preserve original bytes, confirm the record, and clean up abandoned objects. Retries must not create duplicate purchases or delete another in-progress upload. Editing/deleting warranty dates or disabling reminders must cancel obsolete reminder work.

## 6. Design brief and reference images

The design should be **simple, light, calm and made for mobile usage**. Start at approximately 390 px width, verify narrow screens, then expand to a centred content area around 600–800 px on desktop.

Use the owner's four uploaded pictures for visual direction: colour, typography, spacing, navigation and screen composition. Document the actual filenames and which screen each represents after inspecting them. If an image conflicts with this scope, preserve its visual language while keeping this brief's functionality. The pictures are design references, not evidence of working functionality.

Design rules:

- White or soft warm-gray background, dark readable text and one restrained accent colour.
- Generous spacing, subtle neutral borders, approximately 12–16 px corner radii and minimal shadows.
- Headings roughly 28–32 px, item titles 18–20 px, secondary text 14–16 px.
- Thumb-friendly actions, approximately 44 px or larger touch targets, visible focus and accessible contrast.
- Simple line icons; communicate status in words as well as colour.
- Subtle transitions and useful progress feedback; no decorative animations or busy illustrations.
- Fixed bottom navigation: **Pradžia**, **Pirkiniai**, **+ Čekis**, **Nustatymai**. The add action stands out.
- Handle phone safe areas, keyboard overlap and large text. Keep the primary action reachable.

Primary flow: **Fotografuoti / įkelti → Patikrinti informaciją → Išsaugoti**. Scanning is a progress state, not a long wizard. Manual entry and correction remain accessible.

| Screen | Essential content |
| --- | --- |
| Authentication | Clear login/registration/recovery states appropriate to the chosen method |
| Pradžia | Add action, recent purchases, useful upcoming warranties; empty state before data exists |
| Pridėti čekį | Photograph, select image, select PDF or enter manually |
| Patikrink informaciją | Receipt preview, editable suggested fields, explicit warranty confirmation, save |
| Pirkiniai | Compact list, search, simple sorting/filtering and empty states |
| Purchase detail | Product/seller, purchase date/price, warranty/reminder, original receipt preview/download, edit/delete |
| Nustatymai | Account lifecycle, reminder controls, privacy/help required to operate the app |

No sidebar, dense desktop table, spending graph or unexplained legal status. Example Lithuanian labels: **Pridėti čekį**, **Fotografuoti čekį**, **Įkelti PDF**, **Patikrink informaciją**, **Išsaugoti**, **Garantija nenurodyta**, **Garantija pasibaigė**.

## 7. Phase 0 — Preparation

Before Sprint 1:

1. Initialise the clean folder/repository and inspect the supplied images.
2. Confirm runtime/package versions, package manager and dependency lockfile.
3. Define local PostgreSQL setup and a reproducible migration command. Docker is optional; provide a workable alternative if unavailable.
4. Confirm authentication approach. Auth.js alone does not supply a complete password registration/reset product; define either supported email/OAuth flows or a securely implemented password lifecycle before building UI.
5. Choose provisional deployment/storage/email/scheduler providers and document unresolved decisions, free limits and paid steps. Do not block local implementation on unnecessary production accounts.
6. Establish environment variable examples with no secrets, scripts, CI skeleton and design tokens.

Do not implement future features during this phase.

## 8. The 12 sprints

### Sprint 1 — Authentication and app shell

Deliver account creation, sign-in, sign-out, session handling and recovery appropriate to the selected auth method. Build the Lithuanian mobile shell, protected routes and useful empty states. No receipt functionality yet.

Acceptance: a real account lifecycle works locally/in the configured test environment; protected pages reject anonymous access; expired sessions are handled; sign-out removes access; auth secrets stay server-side. Commit the initial PostgreSQL auth migrations and CI checks.

### Sprint 2 — Purchase vault

Create purchase records with product name, seller, date, optional price/currency, notes and owner. Add manual create/edit/delete, list/detail, basic product/seller search and newest/oldest sorting. Reserve the future warranty fields without adding legal logic. The attachment area is an honest empty state until Sprint 3.

Acceptance: persistence survives reload/sign-in; invalid fields produce Lithuanian errors; a second account cannot list, view or mutate the first account's purchases. At this point there is a purchase organiser; the receipt vault becomes functional in Sprint 3.

### Sprint 3 — Private receipt upload

Implement camera/image/PDF selection, private storage, original-file preview/download and purchase associations. Start with JPEG, PNG and PDF; determine practical HEIC preview/conversion support on real devices. Preserve original bytes even if a derived preview is generated. Unsupported formats must fail clearly rather than be silently changed.

Set documented file-size and content validation limits. Handle failed uploads, retries, cancellation, abandoned files and deletion safely. Allow attaching an existing owned receipt to another purchase through a simple action.

Acceptance: a user saves and retrieves an original receipt; two-account and anonymous file access checks pass; oversized/invalid uploads fail safely; deleting one linked purchase preserves shared evidence. Camera/mobile checks begin here, not only in Sprint 9.

### Sprint 4 — OCR and review

Use Lithuanian/English OCR to suggest seller, purchase date, total, receipt number and product name when sufficiently supported. PDF OCR requires an explicit supported rendering/extraction path; otherwise store the PDF and allow manual entry. Never promise all documents scan successfully.

Show editable suggestions and a receipt preview. Leave uncertain fields unfilled or clearly marked. A multi-item total is not automatically the selected product's price. Warranty information requires separate confirmation. Provide scan progress, retry/cancel, manual fallback and duplicate-save protection.

Acceptance: representative Lithuanian receipts are reviewed; ambiguous dates/totals/currencies are not silently invented; failed scans do not lose originals; cancellation and retries work. Measure entry time during testing instead of promising a fixed 10–20 seconds.

### Sprint 5 — Warranty tracking

Implement unknown/none/known warranty states, calculated end date from duration, legacy end-date-only compatibility, and editing. Show **Galioja**, **Greitai baigsis**, **Pasibaigė**, or **Garantija nenurodyta** with dates/remaining days. Add warranty filters and sort by next expiry.

Acceptance: date boundaries, month-end/leap-year handling and unknown/none states are verified; saved dates persist correctly; the 24-month tracking default is not presented as a legal warranty period. Use Europe/Vilnius for the current-day and expiry boundary; store purchase and end dates as PostgreSQL date-only values.

### Sprint 6 — Warranty email reminders

Implement a default reminder 30 days before the confirmed end date. Offer fixed options of 90, 30 and 7 days; custom offsets are optional within this sprint only if they remain simple. Add global/per-purchase controls and verified recipient handling.

Use a scheduled worker with durable due/delivery records, bounded retries and protection against repeated sends during overlapping runs. Define the delivery window/timezone and policy for reminders whose due date was already passed when a purchase was added. Show useful delivery failure state where needed.

Acceptance: test-clock scenarios cover due reminders, repeated runs, failed delivery, warranty edits, deletions and opt-out. Verify actual test email delivery. Document that provider/network failures can delay delivery and how retries operate. PWA/native push is outside this sprint.

### Sprint 7 — Useful home screen

Replace the initial shell home screen with a compact upcoming-warranty summary, recent purchases and a prominent add action. Show nearest expiry first, with clear empty/no-upcoming states. Keep counts accurately labelled if 30/90-day windows overlap.

Acceptance: counts match stored records and filters; key destinations are one tap away; the first screen remains useful and uncluttered. No charts, spending analytics or generic dashboard widgets.

### Sprint 8 — Search and organisation

Extend existing search with purchase-date and warranty filters, simple categories, combined filtering and expiry sorting. Suggested categories: Elektronika, Buitinė technika, Baldai, Įrankiai, Sportas, Kita. Optional tags are not required for MVP and should be omitted unless the owner requests them.

Add pagination or incremental loading appropriate to the dataset.

Acceptance: finding a receipt among approximately 200 seeded purchases remains practical; filters combine predictably; searches stay owner-scoped; keyboard/empty states work. Categories carry no legal meaning.

### Sprint 9 — PWA and mobile polish

Add manifest/icons, supported installation behaviour and platform-specific installation guidance. Refine one-handed capture, loading/error states, safe areas, keyboard behaviour, slow connections and receipt preview.

Keep private receipts/authenticated responses out of broadly cached service-worker content. Default offline behaviour is a clear connection state with no false saved confirmation. Offline draft persistence is optional and needs explicit privacy, cleanup and sync design; full offline operation is not required.

Acceptance: real iPhone Safari and Android Chrome capture/upload/review/save/install flows are checked; narrow screens and large text remain usable. Record actual devices/results and any unavailable checks. Mobile usability has been required throughout all earlier sprints.

### Sprint 10 — Production hardening

Audit ownership enforcement, private object access, auth, upload validation, database constraints, migrations, rate limits, dependency security, errors and logging. Implement account deletion covering database rows, files, sessions and pending reminders, with recoverable cleanup if a storage deletion fails.

Finalise deployment settings, monitoring, privacy information/required data controls, backup and restore procedures, storage lifecycle, quota alerts and operational costs. Backups must cover both PostgreSQL data and receipt objects; verify restoration rather than assuming a free provider retains everything.

Acceptance: CI and production build pass; two-account isolation is verified; migration/deployment checks and a restore drill succeed; account deletion is tested; unresolved release blockers are listed. These controls are built from Sprint 1 onward and audited here, not postponed until this sprint.

### Sprint 11 — Closed beta

Invite roughly 10–30 consenting users through the owner's chosen process. Observe first receipt capture, OCR correction, retrieval and reminder usefulness. Fix defects and confusing existing flows; do not expand scope automatically from requests.

Measure first receipt saved, subsequent receipts added, retrieval success, scan correction effort and delivery failures using privacy-conscious instrumentation. Beta duration depends on feedback; simulated/test reminders can verify behaviour without waiting months.

Acceptance: major failures are fixed, core tasks work on the tested devices, feedback and known limitations are recorded, and release blockers are resolved.

### Sprint 12 — Public MVP release

Complete final release verification, Lithuanian onboarding/help, deployment, operational checks and a rollback plan. Publish only when explicitly requested by the owner. Native apps and new feature families remain out of scope.

Acceptance: production account/capture/review/save/retrieve/warranty/reminder flows work; privacy/help and account deletion are accessible; monitoring and backup procedures are operational; costs and remaining limitations are recorded.

## 9. Milestones and dependencies

| Milestone | Sprints completed | What is usable |
| --- | --- | --- |
| Private receipt vault | 1–3 | Account, purchases and original receipts |
| Faster entry | 4 | Reviewed OCR suggestions |
| Core Čekis promise | 5–6 | Warranty tracking and email reminders |
| Polished mobile MVP | 7–9 | Home, organisation and installable mobile experience |
| Release candidate | 10 | Audited production setup |
| Validated and released | 11–12 | Closed beta followed by public release |

Dependencies follow the sprint order. Basic search starts in Sprint 2 and is extended in Sprint 8. Mobile design starts in Sprint 1 and is refined in Sprint 9. Privacy/security apply from the beginning. OCR is an enhancement; upload/manual entry must work without it.
