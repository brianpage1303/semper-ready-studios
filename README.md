# Warrior Wayfinder™ — Semper Ready Studios site

Static GitHub Pages site for Warrior Wayfinder™, from Semper Ready Studios.

Live URL: https://brianpage1303.github.io/semper-ready-studios/

- `index.html` — marketing landing page plus the in-browser Warrior Wayfinder™ app (hash routes such as `#/orgs`, `#/events`, `#/browse`)
- `privacy.html` — privacy policy for the Android app and this website (effective November 21, 2026)
- `styles.css` / `app.css` — Cream + Navy marketing styles and the in-browser app shell
- `js/` — client-side app (plain ES modules, no build step)
- `data/` — bundled reads and place lists, a U.S. Census ZIP table, and a public-feed snapshot used if the live GitHub feed cannot be reached
- `assets/` — app icon, screenshots, install-link QR code, fonts

The in-browser app prefers the live public feed at `https://raw.githubusercontent.com/brianpage1303/warrior-wayfinder-feed/main/feed.json` and falls back to `data/feed-snapshot.json`. Place, saved items, theme, and Peer Talk interest stay in this browser’s local storage.

Serve the folder with any static file server (needed for ES modules). No build step, no backend, no paid services.
