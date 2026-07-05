# BEFORE vs AFTER — concrete code diffs

Each block below is from your actual files. The "AFTER" version
shows exactly what the patcher emitted.

---

## 1. Sidebar badges (the big one)

### BEFORE — `clients.html:1570–1666` (and identical copies in 17 other pages)

```js
async function loadSidebarBadges() {
  const today = new Date(); today.setHours(0,0,0,0);
  let notifCount = 0;

  const trSnap = await getDocs(collection(db,'treatments'));   // ~1500 reads
  let overdueT = 0;
  trSnap.forEach(d => { /* compute */ });

  const pySnap = await getDocs(collection(db,'payments'));     // ~1200 reads
  let overdueP = 0;
  pySnap.forEach(d => { /* compute */ });

  const coSnap = await getDocs(collection(db,'contracts'));    // ~400 reads
  coSnap.forEach(d => { /* compute */ });

  const cmpSnap = await getDocs(collection(db,'complaints'));  // ~200 reads
  cmpSnap.forEach(d => { /* compute */ });

  const inSnap = await getDocs(collection(db,'inspections'));  // ~300 reads
  inSnap.forEach(d => { /* compute */ });

  if (currentRole === 'admin' || currentRole === 'super_admin') {
    const usrSnap = await getDocs(collection(db,'users'));     // ~50 reads
    /* compute */
  }
  /* ~3,650 reads PER PAGE LOAD, PER USER */
}
```

### AFTER — patched output

```js
async function loadSidebarBadges() {
  /* Replaced by sidebar-badges live listener.
     Reads SUMMARY/DASHBOARD doc once with onSnapshot; was
     reading 6 entire collections per call. */
  try {
    mountSidebarBadges({
      currentRole: (typeof currentRole !== 'undefined' ? currentRole : null)
    });
  } catch (e) { console.warn('[badges]', e?.message || e); }
}
```

**Cost:** 3,650 reads per nav → ~0 reads. The summary doc is
maintained by Cloud Functions (or a manual recompute) and updates
arrive via `onSnapshot` instantly.

---

## 2. Audit log

### BEFORE — `audit-log.html:503–520`

```js
async function loadLogs() {
  const snap = await getDocs(collection(db,'audit_log'));   // load ALL
  allLogs = snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => /* sort by createdAt desc */)
    .slice(0, 500);                                         // throw away rest
  computeStats();
  applyFilters();
}
```

### AFTER

```js
async function loadLogs() {
  const snap = await cachedGetDocs(query(
    collection(db,'audit_log'),
    orderBy('createdAt','desc'),
    limit(500)
  ));
  allLogs = snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => /* … */)
    .slice(0, 500);
  computeStats();
  applyFilters();
}
```

**Cost:** unbounded → max 500 reads, cached for 30s after that.
For deeper history use the paginator helper in `dataLayer.js`.

---

## 3. Get / Add / Update / Delete on collections

### BEFORE — typical patterns

```js
const snap = await getDocs(query(collection(db, 'clients'), orderBy('clientName', 'asc')));
allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));

await updateDoc(doc(db, 'clients', editId), data);
const ref = await addDoc(collection(db, 'clients'), data);
```

### AFTER — same code, different functions (drop-in replacements)

```js
const snap = await cachedGetDocs(query(collection(db, 'clients'), orderBy('clientName', 'asc')));
allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));

await smartUpdateDoc(doc(db, 'clients', editId), data);   // auto-invalidates clients cache
const ref = await smartAddDoc(collection(db, 'clients'), data);
```

The shim functions:
- have **the exact same return type** as the SDK functions
- serve from cache when it's fresh
- invalidate the matching cache after writes
- return real `QuerySnapshot` objects so `.forEach()`, `.docs.map()`,
  `.size`, `.empty` all keep working

---

## 4. Auth handler — lastLogin write

### BEFORE — every page

```js
updateDoc(doc(db, 'users', user.uid), { lastLogin: serverTimestamp() }).catch(() => {});
```

### AFTER

```js
updateLastLoginNoInvalidate(doc(db, 'users', user.uid), { lastLogin: serverTimestamp() }).catch(() => {});
```

Why: a blanket `smartUpdateDoc` would invalidate the entire `users`
cache on every page load. The `updateLastLoginNoInvalidate` shim
performs the write without invalidating.

---

## 5. Batch / transaction writes

### BEFORE — `clients.html:1497–1504`

```js
const batch = writeBatch(db);
batch.update(doc(db, 'clients', activeDetailClientId), { … });
batch.set(doc(collection(db, 'audit_log')), { … });
await batch.commit();
```

### AFTER

```js
const batch = writeBatch(db);
batch.update(doc(db, 'clients', activeDetailClientId), { … });
batch.set(doc(collection(db, 'audit_log')), { … });
await batch.commit();
      await invalidateAfterWrite('clients', 'contracts', 'treatments', 'payments', 'complaints', 'inspections', 'renewals', 'teams', 'users', 'config');
```

The patcher inserts a coarse invalidation after every batch and
transaction. It's overkill (we invalidate everything) but safe.

---

## 6. Topbar widgets

### BEFORE — bell button only

```html
<header class="topbar">
  <button class="hamburger">…</button>
  <span class="topbar-title">Clients</span>
  <div class="topbar-spacer"></div>
  <button class="topbar-btn" onclick="location.href='notification-calendar.html'">
    <svg>…bell…</svg>
    <span class="topbar-notif-dot" id="notif-dot"></span>
  </button>
</header>
```

### AFTER — last-updated + refresh button injected

```html
<header class="topbar">
  <button class="hamburger">…</button>
  <span class="topbar-title">Clients</span>
  <div class="topbar-spacer"></div>
  <span id="last-updated" class="last-updated-badge" data-pc-topbar="1"
        style="font-size:12px;color:#9ca3af;margin-right:8px"></span>
  <button id="btn-refresh" class="topbar-btn" title="Refresh data">
    <svg>…refresh…</svg>
  </button>
  <button class="topbar-btn" onclick="location.href='notification-calendar.html'">
    <svg>…bell…</svg>
    <span class="topbar-notif-dot" id="notif-dot"></span>
  </button>
</header>
```

Wired by `mountLastUpdated()` and `wireRefreshButton()` from
`pageInit.js`.

---

## 7. The auth + bootstrap pattern

### BEFORE — duplicated in every page

```js
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.replace('login.html'); return; }
  currentUser = user;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      await setDoc(doc(db, 'users', user.uid), { … });
      showAuth('pending');
      return;
    }
    const data = snap.data();
    updateDoc(doc(db, 'users', user.uid), { lastLogin: serverTimestamp() }).catch(()=>{});
    if (data.status !== 'approved') { showAuth('pending'); return; }
    currentRole = data.role;
    showApp();
    loadClients();
    loadSidebarBadges();
  } catch (err) { … }
});
```

### AFTER — same logic, with the shim improvements

The patcher kept this code in place but:
- `updateDoc(...lastLogin...)` → `updateLastLoginNoInvalidate(...)`
  (no cache thrashing on every login)
- `loadSidebarBadges()` → calls `mountSidebarBadges()` internally
  via the stub (real-time, summary-doc-driven)

If you want to consolidate further, replace the whole block with:

```js
import { bootstrapPage } from './js/pageInit.js';

bootstrapPage({
  onReady({ user, role }) {
    currentUser = user;
    currentRole = role;
    showApp();
    loadClients();
  }
});
```

This is optional — the patched code works as-is.

---

## 8. React equivalents (for the eventual port)

### BEFORE — typical React port without caching

```jsx
function ClientsPage() {
  const [clients, setClients] = useState([]);
  useEffect(() => {
    getDocs(collection(db, 'clients')).then(snap => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);
  return <Table rows={clients} />;
}
```

### AFTER — useCachedQuery

```jsx
import { useCachedQuery } from './js/useFirestore';

function ClientsPage() {
  const { data: clients, ageLabel, refresh } = useCachedQuery({
    collectionName: 'clients',
    orderBy: [['clientName', 'asc']]
  });
  return (
    <>
      <Toolbar onRefresh={refresh} ageLabel={ageLabel} />
      <Table rows={clients ?? []} />
    </>
  );
}
```

The hook handles cache, dedup, cleanup, and stable deps automatically.
