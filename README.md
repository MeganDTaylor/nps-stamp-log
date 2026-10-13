# NPS Stamp Log

A personal checklist for National Park Service passport stamps. Each person signs in and keeps their own list.

- **Checklist** of 474 park sites with passport cancellations, grouped by state and color-coded by passport region.
- **One tap to check off a site.** Tap the empty circle in the list (or "Got the stamp" on the park page). Saving a visit checks it off too.
- **Visit journal** with date, who you went with, notes and a rating.
- **Map view** of every site (filled = have, hollow = still need).
- **Near me** uses your phone's location to list the closest sites, or pick any park to see what's near it.
- **Your own places**, such as national forests and state parks, which aren't part of the passport program.
- **Where to get the stamp:** every stamp location the Park Service lists (1,190+), with where in the building it is, today's hours and directions.
- **Live alerts** (closures, cautions) on each park page once you've saved your NPS API key.
- **Update park list** from the National Park Service with your own API key, whenever you like.

No build step: plain HTML, CSS and JavaScript modules, with Firebase Auth + Firestore for accounts and data, and Leaflet + OpenStreetMap for the map.

## Try it without Firebase (demo mode)

If you empty the `apiKey` in `public/js/firebase-config.js`, the app runs in demo mode and saves to the browser only.

```sh
cd public && python3 -m http.server 5000
# open http://localhost:5000
```

## Put it on Firebase

You do steps 1–5 once, in the browser. Step 6 is on your computer.

1. **Create the project.** Go to the [Firebase console](https://console.firebase.google.com) → **Add project** (or open an existing one). Google Analytics is optional; you can turn it off.
2. **Turn on sign-in.** **Build → Authentication → Get started → Sign-in method.**
   - **Email/Password:** Enable (leave "Email link" off) → Save.
   - **Google:** Enable → pick your email as the support email → Save.
3. **Create the database.** **Build → Firestore Database → Create database.** Pick a location near you (for example `us-central1` or `nam5`). This can't be changed later. Start in **production mode**; the deploy in step 6 installs this app's rules.
4. **Register the web app.** **Project settings** (gear icon) → **Your apps** → the **</>** (Web) button → nickname "NPS Stamp Log". Leave "Also set up Firebase Hosting" unchecked; step 6 does that. Copy the `firebaseConfig` values it shows into `public/js/firebase-config.js` (already done for `nps-stamp-log`; `.firebaserc` points the CLI at it). They aren't secret; the security rules are what protect the data.
5. **Billing:** the free Spark plan covers this app. No card needed.
6. **Deploy** from the project folder on your computer (needs [Node.js](https://nodejs.org) 18 or newer):

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase deploy --only hosting,firestore:rules
   ```

   It prints your site address: `https://nps-stamp-log.web.app`.
7. Open the site, create your account, then tap **Update park list**, paste your NPS key, and tap **Refresh**. That saves your key so park pages show live alerts.

`*.web.app` and `*.firebaseapp.com` are already allowed for sign-in. If you add a custom domain later, add it under **Authentication → Settings → Authorized domains**.

"Use my location" needs HTTPS, which Firebase Hosting provides. On `localhost` it works too.

### Updating the site later

Change files, then run `firebase deploy --only hosting` again (add `firestore:rules` if `firestore.rules` changed).

## GitHub

The code lives at [megandtaylor/nps-stamp-log](https://github.com/megandtaylor/nps-stamp-log). The Firebase project is `nps-stamp-log`.

`.env` (your NPS key) is git-ignored and never pushed. `public/js/firebase-config.js` and `.firebaserc` are fine to commit.

## Region colors

The nine region colors are set once at the top of `public/css/app.css` (`--r-NA`, `--r-MA`, … with lighter versions for dark mode). Everything else (region cards, stamp marks, list stripes, map dots and state shading) uses those. Change them there to match your passport book.

## Claude preview page

`node tools/build-preview.mjs` bundles `public/` into one file (`dist/stamp-trail-preview.html`) for the claude.ai preview. There, stamps save privately to the viewer's Claude account instead of Firebase. The real site doesn't need this step.

## Data layout

Everything a person saves lives under their own user id, and `firestore.rules` only lets them read and write their own:

```
users/{uid}/stamps/{unit} { date: "2026-10-13" }          (one doc per site you have)
users/{uid}/visits/{id}   { unit: "YELL", date: "2026-10-13", with: "", notes: "…", rating: "Great" }
users/{uid}/places/{id}   { name: "Pisgah National Forest", kind: "National Forest", st: "NC", lat, lon }
```

`unit` (and the stamp doc id) is the NPS four-letter park code, or `x-{placeId}` for your own places.

## Testing locally with the emulators

```sh
firebase emulators:start --only auth,firestore --project demo-stamptrail
```

Then fill in any non-empty `apiKey` with `projectId: "demo-stamptrail"` and set `useEmulators = true` in `firebase-config.js`.

## The park list

The built-in list (`public/js/units.js`, 474 sites) and where to get each stamp (`public/data/park-info.json`) come from the official [NPS Data API](https://www.nps.gov/subjects/developer/api-documentation.htm).

**Refreshing it from the app:** tap **Update park list** at the bottom of the page, paste your NPS API key once, and tap **Refresh park list**. The app downloads the latest sites, saves your copy to your account (`users/{uid}/meta/units`), and tells you what was added or removed. Your key is saved privately to your account (`users/{uid}/meta/settings`). Stamps and journal entries are tied to park codes, so a refresh never loses them.

**Park pages with your key:** when you open a park, the app fetches that park's stamp locations, visitor center hours and alerts live (4 small requests, cached for 30 minutes). Without a key, park pages use the built-in copy and skip alerts.

**Refreshing the built-in list and stamp locations** (what everyone starts with):

```sh
echo "NPS_API_KEY=your-key" > .env     # .env is git-ignored
node tools/fetch-nps-units.mjs
```

Each site is filed under the state that contains its coordinates (the API lists a multi-state park's states alphabetically). Types (National Park, Monument, Historic Site…) come from the API's designation. Both the app and the script use the same conversion code in `public/js/nps.js`.

Behind a corporate or cloud proxy, run the script with `NODE_USE_ENV_PROXY=1`.
