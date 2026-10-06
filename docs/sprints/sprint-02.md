# Sprint 2 — purchase vault

Signed-in people can save, find, edit and delete private purchase records. Routes: `/pirkiniai`, `/pirkiniai/naujas`, `/pirkiniai/[id]`, `/pirkiniai/[id]/redaguoti`; `/prideti` is the honest add entry from bottom navigation. The UI and errors are Lithuanian.

The `purchase` table stores an existing auth user's ID, trimmed product/seller, PostgreSQL purchase `date`, optional exact decimal price and supported currency, optional plain-text notes, and timezone-aware creation/update timestamps. A unique per-owner submission key prevents duplicate creates. A deleted row retains the key and owner but replaces user content with fixed tombstone values. Date, currency, length, price and consistency checks are enforced in server validation and the database where applicable. The owner/date/creation/ID index supports bounded list pages. Warranty fields are reserved for a future reviewed migration, not present now.

All purchase operations resolve a valid session and include owner predicates. Invalid and non-owned IDs produce the same not-found UI. Forms use server actions with framework origin protection and revalidate affected pages. User-entered notes are rendered as text. List search escapes SQL wildcard characters, uses product/seller OR and validates URL state. Page size is 50. The add form starts with a blank purchase date and EUR selected; the calendar boundary is Europe/Vilnius. No receipt or warranty functionality is implied.

Verification uses the disposable `cekis_test` database, Mailpit's real email-link flow, limited `cekis_app` role, Vitest validation checks, Playwright browser cases and the existing CI workflow. `npm run db:migrate` and `npm run db:grant` are repeatable. Sprint 3 adds private receipt upload.
