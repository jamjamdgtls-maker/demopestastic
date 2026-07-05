# Migration Guide

Read this once before deploying so you understand what the refactor
does and how the runtime behavior differs.

---

## The diagnosis

A scan of all 19 original HTML files surfaced these read amplifiers:

### 1. `loadSidebarBadges()` runs on EVERY page (worst offender)

Found in 18 of 19 pages. Each call reads **6 entire collections**:

| Collection  | Approx size | Reads per call |
|-------------|-------------|----------------|
| treatments  | ~1,500      | 1,500          |
| payments    | ~1,200      | 1,200          |
| contracts   | ~400        | 400            |
| complaints  | ~200        | 200            |
| inspections | ~300        | 300            |
| users       | ~50         | 50 (admin only)|

**Total: ~3,650 reads per page navigation, per user.**
A user clicking through 5 pages costs 18,000+ reads. Multiply by
team size and it's a quota incident waiting to happen.

### 2. Audit log: full-collection load → JS slice

`audit-log.html` did:

```js
const snap = await getDocs(collection(db,'audit_log'));   // ALL of it
allLogs = snap.docs.map(...).sort(...).slice(0, 500);     // throw most away
```

Unbounded. As your audit log grows, every page open gets
proportionally more expensive.

### 3. Each page reads its own full collection on every load

| Page          | Collections fetched in full           |
|---------------|---------------------------------------|
| clients.html  | clients, contracts (per detail open)  |
| contracts.html| clients, teams, payments, contracts   |
| payments.html | clients, contracts, payments          |
| treatments.html| clients, contracts, teams, treatments|
| teams.html    | teams, contracts                      |
| dashboard.html| clients, contracts, treatments, payments, complaints, inspections, audit_log |
| reports/*     | clients + contracts + the report's source |

No caching, no `limit()` on most. Every F5 = full re-read.

### 4. No real-time anywhere

Despite being a multi-user app, not a single `onSnapshot` in the
codebase. Updates from other users were invisible until refresh.

### 5. No de-duplication

Re-renders, double-clicks, rapid filter changes all fired fresh
queries.

---

## What the refactor does

### A. Single summary doc with `onSnapshot`

`loadSidebarBadges()` no longer reads any collection. It calls
`mountSidebarBadges()` which subscribes to ONE small document at
`summary/dashboard`. The doc is maintained either by:

- A **Cloud Function** trigger that runs on writes to source
  collections (recommended — see DEPLOY.md Part 5), or
- A manual `recomputeSummary()` call from an admin page.

**Cost:** 1 listener × 1 small doc per user. Writes to the doc are
batched and tiny. This change alone drops total reads ~95%.

### B. Drop-in shims with caching

Every `getDocs(...)` was replaced with `cachedGetDocs(...)`. The
shim has the same return type as the SDK — `.docs.map(d => ({ id:
d.id, ...d.data() }))`, `.forEach(d => d.data())`, `.size`,
`.empty` — so existing page code continues to work.

Behavior:
- **Cache fresh** (within TTL) → return from IndexedDB, 0 reads
- **Cache stale** → return stale data immediately, refresh in
  background, 1 set of reads per stale-window (5 min for static
  lists, 60s for semi-dynamic, 30s for audit log)
- **Cache miss** → network read, populated cache, returned

`addDoc`, `updateDoc`, `deleteDoc`, `setDoc` were replaced with
`smartXxxDoc` shims that automatically invalidate the cache after a
successful write, so the next read returns fresh data.

### C. Bounded queries on big collections

- `audit-log.html` now uses `query(orderBy('createdAt','desc'),
  limit(500))` — no more unbounded reads.
- `dashboard.html` "Recent Activity" card uses `limit(20)`.

### D. Tab-aware behavior

- Polling (where used) pauses while the tab is hidden — background
  tabs cost zero reads.
- BroadcastChannel keeps multiple tabs of the same user in sync
  without extra Firestore traffic.

### E. UI affordances

Every page now has:
- A "Last updated · Xs ago" badge in the topbar
- A manual refresh button next to it
- A sidebar-badge listener that updates in real time

---

## Data classification

| Class            | Examples                            | Strategy            | TTL         |
|------------------|-------------------------------------|---------------------|-------------|
| **A — critical** | `summary/dashboard`                 | `onSnapshot`        | live        |
| **B — semi-dyn** | `payments`, `treatments`, `audit_log` | shim cache + SWR  | 30–60 s     |
| **C — static**   | `clients`, `teams`, `contracts`     | shim cache + SWR    | 5 min       |
| **C — config**   | `config/settings`                   | shim cache + SWR    | 30 min      |
| **C — bulk**     | full `audit_log` history            | cursor pagination   | per page    |

TTLs are configured in `js/firestoreShim.js` (`TTL_BY_COLL`).
Override per-call via `cachedGetDocs(query, { ttl: 0 })` to force a
network read.

### Why polling instead of `onSnapshot` for class B?

A real-time listener stays attached for the entire session and bills
reads on every write across the org. For a 10-person team writing
50 records/hour, an `onSnapshot` listener costs 500 reads/user/hour
PER OPEN TAB. The cache shim with stale-while-revalidate costs ~12
reads/user/hour for the same data and pauses cleanly when the tab
hides.

---

## Read-count math (before vs after)

Assumes 5 active users, ~10 pages/hour each, 8-hour workday,
collection sizes from the table above.

### Per page navigation

|                              | BEFORE          | AFTER         | Cut   |
|------------------------------|-----------------|---------------|-------|
| Sidebar badges               | 3,650 reads     | 0–1 reads     | -100% |
| Page primary data (cache hit)| 450 reads       | 0             | -100% |
| Page primary data (cache miss)| 450 reads      | 450           | 0%    |
| Audit log                    | ~5,000 reads    | 50–500 reads  | -90%  |

### One workday

|                     | BEFORE        | AFTER          |
|---------------------|---------------|----------------|
| Sidebar badges      | ~1,460,000    | ~5             |
| Page primary data   | ~180,000      | ~9,000         |
| Audit log           | ~200,000      | ~2,000         |
| **Total / day**     | **~1,840,000**| **~11,000**    |

That's a **~99.4% reduction** — well under the free-tier 50K reads/day.

### Where reads still happen

- First load of a list page when the user has no cache (one-time
  per 5 min per user per collection)
- Pagination "Load more" clicks
- Manual refresh button presses (intentional)
- Cache misses after write invalidations
- Cloud Function recomputes (these are server-side reads, but they
  consolidate what would otherwise be N client reads)

---

## What's NOT done by this refactor

These would be larger architectural changes — call them out for a
future iteration:

- **No collection-group queries** for audit log retention (delete old
  records). If your audit log grows past 100K entries, add a
  scheduled function that deletes records older than 90 days.
- **No optimistic UI** for writes. After a `smartUpdateDoc`, the UI
  waits for the round-trip before showing the change. The existing
  pages mostly already handled this manually (e.g.
  `allClients.push(...)` after `addDoc`); that pattern still works.
- **No conflict resolution** for concurrent edits. Last write wins.
- **No offline mode.** The cache helps with read freshness but the
  pages still need network connectivity for writes.

---

## Multi-user consistency

| Channel              | Latency       | Mechanism                              |
|----------------------|---------------|----------------------------------------|
| Sidebar badges       | < 1s          | `onSnapshot` on `summary/dashboard`    |
| Same user, other tab | < 100ms       | BroadcastChannel('pestastic_cache')    |
| Other users, lists   | up to TTL     | Cache TTL (5 min) + manual refresh     |
| Other users, badges  | < 1s          | Real-time summary doc                  |

The "Last updated" badge tells the user exactly how fresh their
view is, so they know when to hit refresh.

---

## Performance safeguards built in

- **Dedupe**: in-flight requests for the same key share one Promise.
- **Tab-hidden pause**: polling skips ticks when the tab is hidden.
- **Listener ref-counting**: `liveDoc()` reuses one `onSnapshot` per
  doc path even if multiple consumers subscribe.
- **Schema versioning**: `CACHE_SCHEMA_VERSION` in `firestoreCache.js`
  — bump it when document shape changes, all old caches are wiped.
- **Timestamp-safe serialization**: Firestore `Timestamp` objects
  survive IndexedDB round-trips (they get tagged on write, revived
  on read with `.toDate()` and `.toMillis()` restored).

---

## Re-running the patcher

If you edit the original HTML files (e.g. add a new field or button)
and want to re-apply the optimization:

```bash
python3 scripts/patch.py path/to/originals/  .
```

The patcher is idempotent — running it twice produces the same
result. It detects:
- imports already injected (`firebase-init.js` is in the file)
- `loadSidebarBadges` already stubbed (the body has the `mountSidebarBadges` call)
- topbar widgets already present (`data-pc-topbar="1"` marker)

So it's safe to commit the patcher and re-run it on PR merges.

---

## Things to verify in production

After deploying:

1. **Open dashboard.html** — sidebar badges should populate within
   ~1 second.
2. **Click around 4–5 pages** — the second visit to each page should
   be near-instant (cache hit). Topbar shows "Cached · 12s ago".
3. **Edit a payment** — refresh the payments page, the edit should
   appear (cache was invalidated by `smartUpdateDoc`).
4. **Check Firestore Usage** in the Firebase Console — reads/min
   should be visibly lower than before.
5. **Open DevTools → Application → IndexedDB → pestastic_cache** —
   you should see entries accumulating.
6. **Console**: `await window.__pcCache.stats()` shows cache state.
