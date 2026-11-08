# Fitness Tracker — private data repo

This folder is a **template**. Copy its contents into a new **private** GitHub
repo; that repo is where the Fitness Tracker app stores your personal data.

Nothing here is served to the web. The app itself lives in a separate public
repo and reaches this one through the GitHub API using your personal access
token.

## Setup

1. **Create the repo.** New repository → name it something like
   `fitness-data` → **Private** → tick **Add a README** (this creates the
   default branch, which the API needs) → Create.
2. **Copy these files in**, preserving the layout:

   ```
   .github/workflows/polar-sync.yml
   scripts/polar-sync.mjs
   scripts/crypto.js
   ```

   The easiest route is to download this folder from the app repo and drag the
   files into GitHub's web uploader.
3. **Create a fine-grained token** (GitHub → Settings → Developer settings →
   Fine-grained tokens): repository access limited to **only this repo**,
   with **Contents: Read and write**, plus **Actions: Read and write** if you
   want the app's "Sync activities now" button.
4. **Point the app at it**: open the app → ⚙ Settings → Data repository →
   enter the owner, repo name, and branch (`main`) → Save → paste the token.
   Then press **Upload all local data** once to seed this repo from the
   browser you have been using.

## Polar sync (optional)

The sync workflow lives here because it writes into `data/activities/`.
Polar's AccessLink API is free — no subscription, no approval gate. (The app
used Strava until June 2026, when Strava put its API behind a $11.99/month
subscription.)

### One-time OAuth bootstrap

1. Sign in at <https://admin.polaraccesslink.com> with your Polar Flow
   account and create a client. Note the **Client ID** and **Client Secret**.
   Set the redirect URI to `http://localhost`.
2. Authorize your own client — open this in a browser, with your client id:

   ```
   https://flow.polar.com/oauth2/authorization?response_type=code&client_id=CLIENT_ID
   ```

   Approve; you land on `http://localhost/?code=AUTH_CODE`. Copy the code.
3. Exchange it for an access token. The token endpoint uses HTTP Basic auth
   with your client id and secret:

   ```sh
   curl -X POST https://polarremote.com/v2/oauth2/token \
     -u 'CLIENT_ID:CLIENT_SECRET' \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'grant_type=authorization_code&code=AUTH_CODE&redirect_uri=http://localhost'
   ```

   The response contains `access_token` and `x_user_id`. Keep both.
4. Register the user with your client — **required once**, and it is what
   starts making data available:

   ```sh
   curl -X POST https://www.polaraccesslink.com/v3/users \
     -H "Authorization: Bearer ACCESS_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"member-id": "anything-you-like"}'
   ```

   A `409 Conflict` here just means the user is already registered — fine.
5. Add repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `POLAR_ACCESS_TOKEN` | `access_token` from step 3 |
| `POLAR_USER_ID` | `x_user_id` from step 3 |
| `ENCRYPTION_PASSWORD` | only if you enabled encryption in the app |

The workflow then runs every four hours, and on demand from the Actions tab or
the app's "Sync activities now" button.

If the token is ever revoked (e.g. you remove the app in Polar Flow), the run
fails with a message telling you to redo this bootstrap.

### How much gets pulled

**Polar only exposes the last ~30 days**, and only exercises uploaded after
your client was registered. There is no historical backfill through the API at
all — so there is no date-floor setting, and nothing before setup will appear.
To bring in older activities, or anything from another device, use
**Logs → History → Import GPX/TCX** in the app instead.

Each run lists what is available, skips exercises it has already stored
(tracked by id in `sync-state.json`), and is therefore safe to re-run.

Optional repo **variables** (Settings → Secrets and variables → Actions →
*Variables* tab — these are not secrets):

| Variable | Default | Effect |
|---|---|---|
| `SYNC_TYPES` | unset = all sports | Comma-separated Polar sport allowlist, e.g. `RUNNING,CYCLING`. |
| `SYNC_MAX_ACTIVITIES` | `200` | Per-run cap. A warning is logged if there were more, so nothing is silently dropped. |
| `DATA_DIR` | `data` | Folder holding the app's data. Must match **Folder in the repo** in the app's Settings; `/` means the repo root. Only change it if you changed that setting. |

### A note on Polar's transaction model

Some Polar endpoints *discard* data once a transaction is committed. The script
only ever commits **after** the shards have been written to disk, so a crash
mid-run means the next run re-fetches rather than losing an activity.

## What ends up here

```
data/plans.json          data/exercises.json   data/matches.json
data/logs.json           data/metrics.json     data/goals.json
data/activity-edits.json                        # corrections to synced activities
data/gear.json                                  # shoes, bikes and other tracked gear
data/activities/sync-state.json                 # written by the workflow
data/activities/activities-YYYY-MM.json         # written by the workflow
data/imported/imported-YYYY-MM.json             # written by the app's import
```

Each file has exactly one writer — the workflow owns `data/activities/`, the
browser owns everything else — so the two can never conflict.

The app creates these on first sync — you do not need to make them yourself.

`scripts/crypto.js` is a byte-identical copy of `ghsync/crypto.js` in the app
repo, so the workflow can read and write the same encrypted format the browser
uses. If you ever update one, update both — `tests/crypto-drift.mjs` in the app
repo fails if they diverge.
