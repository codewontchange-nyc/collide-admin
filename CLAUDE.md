# collide-admin — working notes

The desktop console for Collide owners and facilitators. Static Preact 10 + htm,
no build step, ES modules loaded from esm.sh, deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`. Same Supabase project as
the mobile app (`zion-collide`): `pjxvvwcnjjizdtiutpxd`.

## Shipping

1. Edit. Every module import and the two tags in `index.html` carry `?v=__V__`.
   **Never hand-bump `?v=`** — the deploy workflow stamps every `?v=` with the
   commit's short SHA (it also rewrites stray literal numbers, so an old-style
   bump still deploys consistently). Local preview works with `__V__` as-is.
2. `for f in *.js; do node --input-type=module --check < "$f"; done` — the same
   gate runs in CI and fails the deploy.
3. Commit as `Area: what changed` (e.g. `Money: maker bookings beside the ledger`),
   then `git fetch && git rebase origin/main && git push origin HEAD:main`.
   Another session may be shipping this repo at the same time — always rebase.
4. Poll `https://codewontchange-nyc.github.io/collide-admin/index.html` until
   `app.js?v=<short sha>` matches `git rev-parse --short HEAD`.

`config.js` is **not tracked** (`.gitignore`); the workflow writes it from the
`SUPABASE_URL` / `SUPABASE_ANON_KEY` secrets. Keep a local copy for previews.

## Database changes

SQL is applied **live first** (Supabase Management API, token in the macOS
keychain as `Supabase CLI`; send `User-Agent: curl/8.4.0`), then **recorded** in
`supabase/migrations/YYYYMMDD_<slug>.sql` whose first line is
`-- <purpose>. Applied live YYYY-MM-DD.` — the file is a transcript, not a
pending migration. Order is the prefix; everything in that directory is already
on prod. Don't put `.sql` files at the repo root.

RLS is the real permission gate: `is_owner()` / `is_any_staff()` /
`is_staff(cid)` key off the JWT email (`staff_email()`); `ed_can_facilitate(cid)`
also accepts `staff.profile_id`. New member-content tables need a staff SELECT
policy before the console can read them, and content that must be hideable needs
a `mod_hide_<table>` restrictive policy plus an entry in `content_hidden`'s CHECK
and `mod_delete()`.

Some tables have **column-level grants** (e.g. `meals.pickup_address/lat/lng` are
withheld from `authenticated`): `select("*")` on those 403s. Use explicit column
lists for member-data tables.

## Edge functions

`supabase/functions/`: `crm-tick`, `ics`, `invite`, `moderate`, `push-send`,
`share`. Deploy one at a time:
`supabase functions deploy <name> --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd`
then smoke it. The app repo owns `inkify`, `nav`, `qr`, `recap` in the same
project — one namespace, one secret store.

Secrets used: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_WEBHOOK_SECRET` (and the legacy
`PUSH_SECRET` alias `push-send` still accepts until the DB webhook is re-pointed).
The VAPID public key is mirrored in `app.js`; change both or push breaks.

## Verifying in a browser

The console needs a signed-in staff user. Pattern (scratch scripts, purge after):
insert a disposable `<name>@collide.test` user into `auth.users` (all token
columns `''`, `email_confirmed_at` set) + `auth.identities`, add a `staff` row
(`owner`, or `facilitator` + `community_id`), sign in with the anon key
(`/auth/v1/token?grant_type=password`), write the session to
`localStorage["sb-pjxvvwcnjjizdtiutpxd-auth-token"]` on the preview origin,
reload. Purge: delete `staff` row, `facilitators`/`community_members` rows,
then `auth.users`; assert 0 `@collide.test` users and 0 orphan profiles.

## Conventions (see the shared layer)

`ui.js` — formatting, constants, components. `db.js` — data access, config,
`useLoader`, `callFn`. `routes.js` — the page/tab table and owner gating.
`styles.css` — tokens at the top; no hex in JS outside `BRAND`. `null` means
"loading" for list state; `flash()` is the toast; errors go through
`showError()` so they also land in Issues.
