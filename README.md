# Pestastic — Optimized

A pest-control operations system. This refactor cuts Firestore reads
by ~99% versus the previous build by introducing a hybrid data
strategy — real-time only where it matters, cached + paginated
everywhere else.

## At a glance

| Before                               | After                                    |
|--------------------------------------|------------------------------------------|
| 6 entire collections read per page   | 1 listener on a single summary doc       |
| Full collection re-reads on F5       | IndexedDB cache (5 min TTL on lists)     |
| `audit_log` loaded in full, JS-sliced| Cursor-paginated, capped at 500 / page   |
| `config/settings` read on every page | Cached for 30 min via `cachedGetDoc`     |
| No multi-user updates without F5     | Real-time badges + 60s polling on lists  |
| ~1.84M reads/day for 5 active users  | ~11K reads/day for the same workload     |

## Project structure

```
.
├── *.html                     ← 23 patched pages, drop-in
│   ├── index.html             ← redirect (no Firestore — copied as-is)
│   ├── login.html             ← pre-auth (shim only, no badges/topbar)
│   ├── layout.html            ← app-shell template (full patch, loadBadges→stub)
│   ├── settings.html          ← full patch + config/settings caching
│   ├── dashboard.html         ← full patch + audit_log limit(20)
│   ├── audit-log.html         ← full patch + audit_log limit(500)
│   └── (17 other pages)       ← full patch
│
├── firebase-config.js         ← your existing config (unchanged)
├── js/
│   ├── firebase-init.js       ← single Firebase init
│   ├── firestoreCache.js      ← IndexedDB + TTL + tab-sync
│   ├── firestoreShim.js       ← drop-in cachedGetDocs / cachedGetDoc / smartAddDoc / etc.
│   ├── dataLayer.js           ← pollingQuery / liveDoc / paginator
│   ├── sidebarBadges.js       ← summary/dashboard onSnapshot
│   ├── pageInit.js            ← bootstrapPage / mountLastUpdated
│   └── useFirestore.js        ← React hook equivalents
├── scripts/
│   └── patch.py               ← reproducible patcher (re-runnable)
├── firebase.json              ← Hosting + Firestore config
├── firestore.rules            ← security rules
├── firestore.indexes.json     ← composite indexes for new queries
├── .firebaserc                ← project alias
├── .gitignore
├── README.md                  ← this file
├── DEPLOY.md                  ← step-by-step deploy guide
├── MIGRATION-GUIDE.md         ← what changed, classification, math
└── BEFORE-AFTER.md            ← concrete code diffs
```

## Special-case handling

The patcher applies **different transformations** to different file types:

| File                 | Treatment                                          |
|----------------------|----------------------------------------------------|
| `index.html`         | No Firestore → copied through unchanged            |
| `login.html`         | Shim imports + lastLogin no-invalidate, NO badges/topbar (pre-auth page) |
| `layout.html`        | Full patch + handles the alternate `loadBadges()` name (vs `loadSidebarBadges()`) |
| `settings.html`      | Full patch + caches the `config/settings` reads with 30-min TTL |
| All other 19 pages   | Full patch (shim, badges, topbar, tx invalidation) |

## Quick start

```bash
# 1. Sign in to Firebase (one-time)
npm install -g firebase-tools
firebase login

# 2. Confirm we're targeting your project
firebase use pestasticsys

# 3. Seed the summary/dashboard doc (one-time)
#    Open any patched page in a browser, sign in as admin,
#    then in the JS console run:
#       const { recomputeSummary } = await import('./js/sidebarBadges.js');
#       await recomputeSummary();

# 4. Deploy hosting + rules + indexes
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

See `DEPLOY.md` for the full step-by-step including GitHub setup,
Cloud Functions for auto-recompute, and CI/CD.

## Re-running the refactor

If you make further changes to the original HTML files and want to
re-apply the optimization, run:

```bash
python3 scripts/patch.py path/to/originals/  ./
```

The patcher is idempotent and produces the same output for the same
input, so it's safe to commit.

## How it works (one-paragraph version)

Each page imports `cachedGetDocs`, `cachedGetDoc`, `smartAddDoc`,
`smartUpdateDoc`, `smartDeleteDoc`, `smartSetDoc` from
`js/firestoreShim.js`. These are drop-in replacements for the
Firestore SDK functions with identical return types, so existing
page code continues to work — but reads are served from IndexedDB
when the cache is fresh, and writes invalidate the relevant cache
so the next read is fresh. Sidebar badges, which used to load 6
entire collections per page, now read a single `summary/dashboard`
document via `onSnapshot`, updated either by Cloud Functions on
collection writes or by a manual recompute. Each page (except
pre-auth and redirect pages) also gets a "Last updated · 2m ago"
badge and a refresh button.

## Data classification

| Class           | Examples                                | Strategy            | TTL/Interval |
|-----------------|-----------------------------------------|---------------------|--------------|
| **A — critical**| `summary/dashboard` (badges, totals)    | `onSnapshot`        | live         |
| **B — semi-dyn**| `payments`, `treatments`, `audit_log`   | poll / SWR          | 30–60 s      |
| **C — static**  | `clients`, `teams`, `contracts`         | cache-first SWR     | 5 min        |
| **C — config**  | `config/settings` (single doc)          | cache-first SWR     | 30 min       |
| **C — bulk**    | `audit_log` history, treatment history  | cursor pagination   | per page     |
