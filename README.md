# skypainter.f-90.co.uk

Home, privacy, support, and the [web app](https://github.com/utopastac/skypainter-web) for [Skypainter](https://github.com/utopastac/skypainter), hosted as a subdomain of f-90.

## Stack

Plain HTML / CSS / JS for marketing pages. Nested CSS with variables. Instrument Sans via Google Fonts. The playable web build lives in `/web/` (Vite + Three.js).

## Local preview

```sh
cd /Users/becter/code/skypainter-site
python3 -m http.server 8080
```

Open http://localhost:8080 — home CTAs: **Web** → `/web/`, **iOS** → App Store (coming soon).

## Refresh the web build

From the sibling `skypainter-web` repo:

```sh
./scripts/publish-to-site.sh
```

That builds with `base: "/web/"` and copies `dist/` into this repo’s `web/` folder.

## Deploy

GitHub Pages from this repo’s root on `main`, custom domain `skypainter.f-90.co.uk`.

DNS: CNAME `skypainter` → `utopastac.github.io`. Keep the root `CNAME` file as `skypainter.f-90.co.uk`.

Listing URLs:

- Marketing: `https://skypainter.f-90.co.uk/`
- Web app: `https://skypainter.f-90.co.uk/web/`
- Support: `https://skypainter.f-90.co.uk/support/`
- Privacy Policy: `https://skypainter.f-90.co.uk/privacy/`

Set the real App Store ID in `site.js` (`APP_STORE_URL`) when the iOS listing goes live.

## Assets

- `assets/app-icon-64.png` and `app-icon-256.png` — from the Skypainter iOS App Icon
- `web/` — built output from skypainter-web (do not edit by hand)
