# skypainter.f-90.co.uk

Home, privacy, and support site for [Skypainter](https://github.com/utopastac/skypainter), hosted as a subdomain of f-90.

## Stack

Plain HTML / CSS / JS. Nested CSS with variables. Instrument Sans via Google Fonts.

## Local preview

```sh
cd /Users/becter/code/skypainter-site
python3 -m http.server 8080
```

Open http://localhost:8080

## Deploy

GitHub Pages from this repo’s root on `main`, custom domain `skypainter.f-90.co.uk`.

DNS: CNAME `skypainter` → `utopastac.github.io`. Keep the root `CNAME` file as `skypainter.f-90.co.uk`.

App Store listing URLs:

- Marketing: `https://skypainter.f-90.co.uk/`
- Support: `https://skypainter.f-90.co.uk/support/`
- Privacy Policy: `https://skypainter.f-90.co.uk/privacy/`

## Assets

- `assets/app-icon-64.png` and `app-icon-256.png` — from the Skypainter iOS App Icon
