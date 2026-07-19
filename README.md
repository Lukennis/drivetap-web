# drivetap-web

Static web surfaces for DriveTap, hosted on GitHub Pages. No build step, no
node_modules — plain ES modules pushed with git.

- **`/admin/`** — the DriveTap Admin Suite: overview KPIs, user management with
  a full support drawer (drives on maps, subscription controls, notes), fleet
  drive inspector with moderation, revenue & cohort analytics, live remote
  config (including the detection-engine tuning JSON), push broadcast composer,
  the shared audit log, and the **Deals workspace** (prospect pipeline → quote
  builder with print-to-PDF → signed partners with onboarding checklists).
- **`/portal/`** — placeholder for the Phase-2 school-facing partner portal.

## How access control works

Anyone can load the page; nobody without an admin account can see or change
anything. Sign-in is Google via Firebase Auth, and the page checks
`users/{uid}.isAdmin`. The real enforcement is server-side: every collection
this suite touches is admin-gated in `firestore.rules` (in the main Drivetap
repo — deployed to the `drivetap-dda0e` project). The Firebase web config in
`admin/js/firebase-init.js` is public by design; it identifies the project and
grants nothing.

Deals data lives in four admin-only collections: `prospects`, `quotes`,
`partnerOrgs`, `partnerOnboarding`.

## Demo mode

`/admin/?demo=1` (or the sidebar's "Demo mode" link) loads deterministic fake
data — students, drives, revenue, a healthy pipeline — with all writes
disabled. Safe to project in a sales meeting; a yellow banner marks it.

## Deploying

1. Push to `main` on GitHub (`Lukennis/drivetap-web`, public — Pages on a
   private repo needs GitHub Pro).
2. Repo → Settings → Pages → Source: `main` / root. Site appears at
   `https://lukennis.github.io/drivetap-web/`.
3. **Firebase Console → Authentication → Settings → Authorized domains → add
   `lukennis.github.io`** (one-time; sign-in fails without it). `localhost` is
   already authorized for local testing.
4. Optional custom domain: add `admin.ennisventures.com` in Pages settings and
   create the CNAME at your DNS → `lukennis.github.io`. Then also add that
   domain to Firebase authorized domains.

## Local testing

```
python3 -m http.server 8080
# open http://localhost:8080/admin/?demo=1  (no sign-in needed in demo mode)
```

ES modules require http(s) — opening index.html via `file://` won't work.
