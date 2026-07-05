# Deploy Guide — Firebase Hosting + GitHub

This walks through deploying the optimized Pestastic app to your
existing Firebase project (`pestasticsys`) and setting up a GitHub
repo with optional auto-deploy on push.

> **Time estimate:** 15–25 minutes for the first time, ~2 minutes
> for subsequent deploys.

---

## Part 1 — Prerequisites

You'll need:

- **Node.js 18+** ([nodejs.org](https://nodejs.org/))
- **Git** ([git-scm.com](https://git-scm.com/))
- **A Firebase account** with access to the `pestasticsys` project
- **A GitHub account**

Install the Firebase CLI globally (one-time):

```bash
npm install -g firebase-tools
firebase --version    # should print 13.x or newer
```

Sign in:

```bash
firebase login
```

This opens a browser. Sign in with the Google account that owns
`pestasticsys`.

---

## Part 2 — Local setup

### 2.1 Put the files in place

Copy the entire contents of this refactor bundle into a new working
directory (let's call it `pestastic/`):

```
pestastic/
├── *.html              ← 19 patched files
├── firebase-config.js  ← from the bundle (your existing config)
├── js/                 ← new shared modules
├── scripts/
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc
├── .gitignore
└── README.md
```

If you already have `login.html`, `signup.html`, or other pages that
weren't in the original 19, drop them in alongside — they'll be
served as-is.

### 2.2 Confirm the Firebase target

```bash
cd pestastic/
firebase use pestasticsys
```

You should see:

```
Now using project pestasticsys
```

### 2.3 Test locally first

```bash
firebase emulators:start --only hosting
```

Open `http://localhost:5000` and confirm the app loads. You'll see
the "Last updated · just now" badge in the topbar — that's the new
caching layer working.

> **Heads-up:** The first time each page loads, you may see one
> Firestore index error in the console. That's because of the new
> `where + orderBy` queries. The console message includes a URL to
> auto-create the index — but step 3 below deploys all of them at
> once so you usually won't hit this.

---

## Part 3 — Deploy to Firebase

### 3.1 Deploy security rules and indexes first

This is the order that matters: rules first, indexes second, then
hosting. Otherwise the indexes might not be ready when the new
queries run.

```bash
firebase deploy --only firestore:rules
```

Expected output:

```
✔  firestore: released rules firestore.rules to cloud.firestore
```

```bash
firebase deploy --only firestore:indexes
```

Expected output:

```
✔  firestore: deployed indexes in firestore.indexes.json successfully
```

Indexes can take a few minutes to build. You can watch progress at
**Firebase Console → Firestore → Indexes**.

### 3.2 Deploy the hosting

```bash
firebase deploy --only hosting
```

Expected output (last lines):

```
✔  hosting[pestasticsys]: file upload complete
✔  hosting[pestasticsys]: release complete
✔  Deploy complete!
Hosting URL: https://pestasticsys.web.app
```

Your app is now live at:

- `https://pestasticsys.web.app`
- `https://pestasticsys.firebaseapp.com`

### 3.3 Seed the `summary/dashboard` doc

Until you set up the Cloud Function (Part 5), you need to manually
seed the summary doc once so sidebar badges have something to show.

1. Open `https://pestasticsys.web.app/dashboard.html` and sign in.
2. Open the browser DevTools console (F12).
3. Run:

```js
const m = await import('./js/sidebarBadges.js');
await m.recomputeSummary();
```

You should see an object with the current counts. Refresh — sidebar
badges should now show.

After this, badges update in real time via `onSnapshot` whenever
`summary/dashboard` changes. You only need to recompute when source
collections change in bulk outside the app (e.g. CSV import) or
once you set up the Cloud Function in Part 5.

### 3.4 Verify reads dropped

In **Firebase Console → Firestore → Usage**, watch the read counter
over the next hour. Compared to the previous build, you should see
roughly a 95–99% reduction in reads from sidebar/badge traffic alone.

---

## Part 4 — Push to GitHub

### 4.1 Create the repo

Either via the GitHub website (New repo → name it `pestastic`) or
the GitHub CLI:

```bash
gh repo create pestastic --private --source=. --remote=origin
```

### 4.2 First commit

```bash
git init -b main
git add .
git status              # confirm .firebaserc, firebase-config.js etc. are listed
git commit -m "Initial commit — optimized Firestore data layer"
git remote add origin https://github.com/YOUR_USERNAME/pestastic.git
git push -u origin main
```

> **About `firebase-config.js`:** It contains your `apiKey`,
> `authDomain`, etc. These are NOT secrets — Firebase web app
> configs are public by design (they identify the project, not
> authorize access). Access is controlled by the Firestore rules
> you just deployed. So it's fine to commit `firebase-config.js`
> to a public repo. If you'd rather keep the repo minimally
> identifiable, make it private.

### 4.3 What's NOT committed

The `.gitignore` excludes:

- `.firebase/` (CLI cache)
- `node_modules/`
- `*.log`
- `.env*`, `*service-account*.json` (secrets — never commit)
- `patched/` (transient build output if you re-run the patcher)

---

## Part 5 — (Recommended) Auto-recompute via Cloud Functions

Without this, you have to call `recomputeSummary()` manually after
bulk imports. With it, the `summary/dashboard` doc auto-updates
whenever any source collection changes.

### 5.1 Initialize Cloud Functions

```bash
firebase init functions
```

Choose:
- **Use existing project:** `pestasticsys`
- **Language:** JavaScript (or TypeScript if you prefer)
- **ESLint:** your preference
- **Install npm dependencies now:** Yes

This creates a `functions/` directory.

### 5.2 Replace `functions/index.js`

```js
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function recompute() {
  const today = new Date(); today.setHours(0,0,0,0);
  const tMs   = today.getTime();

  const [tr, py, co, cmp, ins, usr] = await Promise.all([
    db.collection('treatments').get(),
    db.collection('payments').get(),
    db.collection('contracts').get(),
    db.collection('complaints').get(),
    db.collection('inspections').get(),
    db.collection('users').get()
  ]);

  let overdueTreatments = 0;
  tr.forEach(d => {
    const t = d.data();
    if (t.status !== 'scheduled') return;
    const td = t.treatmentDate?.toDate ? t.treatmentDate.toDate() : new Date(t.treatmentDate || 0);
    if (td.getTime() < tMs) overdueTreatments++;
  });

  let overduePayments = 0;
  py.forEach(d => {
    const p = d.data();
    if (p.status !== 'Pending') return;
    const dd = p.dueDate?.toDate ? p.dueDate.toDate() : new Date(p.dueDate || 0);
    if (dd.getTime() < tMs) overduePayments++;
  });

  let expiringContracts = 0;
  co.forEach(d => {
    const c = d.data();
    if (c.status !== 'active') return;
    const ed = c.contractEndDate?.toDate ? c.contractEndDate.toDate() : new Date(c.contractEndDate || 0);
    const days = Math.round((ed.getTime() - tMs) / 86400000);
    if (days >= 0 && days <= 7) expiringContracts++;
  });

  let openComplaints = 0;
  cmp.forEach(d => {
    const s = d.data().status || '';
    if (['Open','In Progress','Scheduled'].includes(s)) openComplaints++;
  });

  let scheduledInspections = 0;
  ins.forEach(d => { if ((d.data().status || '') === 'Scheduled') scheduledInspections++; });

  let pendingUsers = 0;
  usr.forEach(d => { if (d.data().status === 'pending') pendingUsers++; });

  await db.doc('summary/dashboard').set({
    overdueTreatments, overduePayments, expiringContracts,
    openComplaints,    scheduledInspections, pendingUsers,
    updatedAt: FieldValue.serverTimestamp()
  });
}

exports.onTreatmentWrite  = onDocumentWritten('treatments/{id}',  recompute);
exports.onPaymentWrite    = onDocumentWritten('payments/{id}',    recompute);
exports.onContractWrite   = onDocumentWritten('contracts/{id}',   recompute);
exports.onComplaintWrite  = onDocumentWritten('complaints/{id}',  recompute);
exports.onInspectionWrite = onDocumentWritten('inspections/{id}', recompute);
exports.onUserWrite       = onDocumentWritten('users/{id}',       recompute);
```

### 5.3 Deploy functions

```bash
firebase deploy --only functions
```

Now `summary/dashboard` updates automatically. Sidebar badges across
all users see new counts within seconds.

> **Cost note:** Cloud Functions on the Spark (free) plan do NOT
> support outbound network requests beyond Google services, but
> Firestore IS Google so this works fine. Free tier includes
> 2M function invocations/month — plenty of headroom.

> **High write volume tweak:** If you write hundreds of records per
> minute (CSV imports, bulk treatments), the per-write trigger will
> recompute too often. Replace with a Pub/Sub Schedule running every
> 60s and have triggers just enqueue. See Firebase docs on
> "Scheduled functions".

---

## Part 6 — (Optional) GitHub Actions auto-deploy

Push to `main` → automatic deploy.

### 6.1 Generate a service account key

```bash
firebase init hosting:github
```

Walk through the prompts. The CLI will:
- Create a service account in your Firebase project
- Add a secret called `FIREBASE_SERVICE_ACCOUNT_PESTASTICSYS` to
  your GitHub repo
- Generate `.github/workflows/firebase-hosting-merge.yml` and
  `firebase-hosting-pull-request.yml`

If it didn't (or you prefer the manual path):

1. **Firebase Console → Project Settings → Service accounts → Generate new private key**.
2. Open the JSON file.
3. **GitHub repo → Settings → Secrets and variables → Actions → New secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT_PESTASTICSYS`
   - Value: paste the entire JSON contents.

### 6.2 Workflow file

Save as `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Firebase Hosting on merge

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken:    ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_PESTASTICSYS }}
          projectId: pestasticsys
          channelId: live
```

After committing and pushing, every push to `main` will deploy the
hosting bundle automatically. Pull requests get a preview URL.

> **What this workflow doesn't do:** it doesn't redeploy rules,
> indexes, or functions. Those change less often, so deploy them
> manually when you change them. If you want a one-shot full
> deploy, replace the action with a `firebase deploy` step using
> a service account key.

---

## Part 7 — Day-to-day workflow

After the one-time setup:

```bash
# Pull latest, edit some files, test locally
git pull
firebase emulators:start --only hosting

# Commit and push — auto-deploys via GitHub Actions
git add .
git commit -m "tweak: …"
git push
```

When you change rules or indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

When you change cloud functions:

```bash
firebase deploy --only functions
```

When you re-run the patcher on updated source HTML:

```bash
python3 scripts/patch.py path/to/originals/  ./
git add *.html
git commit -m "Re-patch HTML files"
git push
```

---

## Part 8 — Troubleshooting

### "Permission denied" on Firestore reads after deploy
Your security rules are working. Make sure the user you're testing
with has `users/{uid}.status == 'approved'`. New users start as
`pending`. Promote them in the **user-management.html** page or via
the Firebase Console.

### Sidebar badges stay at 0 after deploy
The `summary/dashboard` doc doesn't exist yet. Run step 3.3 once
manually, or wait for the first write to a source collection (which
triggers the Cloud Function from Part 5).

### "The query requires an index" error in console
A composite index hasn't built yet. Two options:
1. Wait — indexes deploy automatically after `firebase deploy
   --only firestore:indexes` but can take a few minutes.
2. Click the URL in the error message — it auto-creates the index.

### Cache shows stale data after a write
1. Verify you're using the patched code (not the original) — your
   imports should reference `js/firestoreShim.js`.
2. Open DevTools → Application → IndexedDB and confirm
   `pestastic_cache` exists.
3. Force-clear the cache from the console:
   ```js
   await window.__pcCache.clear();
   ```

### "Last updated" badge doesn't appear
Either the topbar markup of that page didn't match the patcher's
regex, or you're on a page that has no topbar. Run:
```bash
python3 scripts/patch.py path/to/originals/ ./
```
again — the script logs widget injection per file.

### After login, users see "pending"
Expected. Promote them via the user-management page or in Firebase
Console: **Firestore → users → {uid} → status → "approved"** and
set their `role`.

### How do I know caching is actually working?
In DevTools console:
```js
console.log(await window.__pcCache.stats());
```
You'll see entries with their ages. After navigating between pages,
ages should INCREASE (not reset to 0) because reads are served
from cache.
