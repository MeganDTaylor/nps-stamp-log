# Stamp Trail

A personal checklist for National Park Service passport stamps. Each person signs in and keeps their own list.

- **Checklist** of 425 park sites with passport cancellations, grouped by state, with progress for each region.
- **Stamps per park.** Check off the main stamp in one tap, or add each stamp you see (visitor centers, bonus and anniversary stamps).
- **Visit journal** with date, who you went with, notes and a rating.
- **Map view** of every site (filled = have, hollow = still need).
- **Near me** uses your phone's location to list the closest sites, or pick any park to see what's near it.
- **Your own places**, such as national forests and state parks, which aren't part of the passport program.

No build step: plain HTML, CSS and JavaScript modules, with Firebase Auth + Firestore for accounts and data, and Leaflet + OpenStreetMap for the map.

## Try it without Firebase (demo mode)

While `public/js/firebase-config.js` has an empty `apiKey`, the app runs in demo mode and saves to the browser only.

```sh
cd public && python3 -m http.server 5000
# open http://localhost:5000
```

## Put it on Firebase

1. In the [Firebase console](https://console.firebase.google.com), create a project (or reuse one).
2. **Authentication → Sign-in method:** turn on **Email/Password** and **Google**.
3. **Firestore Database → Create database** (production mode).
4. **Project settings → Your apps → Add app → Web.** Copy the config values into `public/js/firebase-config.js`.
   These values are safe to commit; the security rules are what protect the data.
5. Deploy:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only hosting,firestore:rules
   ```

6. After the first deploy, add your hosting domain under **Authentication → Settings → Authorized domains** if it isn't already listed (`*.web.app` and `*.firebaseapp.com` are added automatically).

"Use my location" needs HTTPS, which Firebase Hosting provides. On `localhost` it works too.

## Data layout

Everything a person saves lives under their own user id, and `firestore.rules` only lets them read and write their own:

```
users/{uid}/stamps/{id}   { unit: "YELL", name: "Old Faithful Visitor Center", got: true, date: "2026-10-13" }
users/{uid}/visits/{id}   { unit: "YELL", date: "2026-10-13", with: "", notes: "…", rating: "Great" }
users/{uid}/places/{id}   { name: "Pisgah National Forest", kind: "National Forest", st: "NC", lat, lon }
```

`unit` is the NPS four-letter park code, or `x-{placeId}` for your own places.

## Testing locally with the emulators

```sh
firebase emulators:start --only auth,firestore --project demo-stamptrail
```

Then fill in any non-empty `apiKey` with `projectId: "demo-stamptrail"` and set `useEmulators = true` in `firebase-config.js`.

## About the park list

`public/js/units.js` was written by hand, because the official NPS data feed wasn't reachable when the app was built. Coordinates are approximate (good for distances and the map, not for navigation). A few of the newest sites may be missing. To refresh it from the official source, use the NPS API (`https://developer.nps.gov/api/v1/parks`, free key) and keep the same row shape.

The app doesn't include a list of every individual stamp. There are well over a thousand, and there's no public data feed for them. People add the stamps they see, park by park.
