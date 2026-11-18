# YEP Escape Room

Static web app (no build step). Live sync via Firebase Realtime Database.

- Participants: open the site link on a phone.
- Game Master: open the same link with `#admin` at the end (PIN in `config.js`, default `0000`).

## Go live
1. Paste the Firebase web config into `config.js` (`window.FIREBASE_CONFIG = {...}`).
2. GitHub repo → Settings → Pages → Source: "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save.
3. Wait 1–2 minutes, then open `https://<user>.github.io/<repo>/`.

Without a Firebase config the app runs in DEMO MODE (only syncs between tabs of one browser).

## Edit content
All text (rooms, personas, surprises, rules) is in `content.js`. Boss images are in `bosses/`.
