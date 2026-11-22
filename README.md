# FLL Mock Tournament website

Two pages, one GitHub Pages site:

| Page | Address | Who |
|---|---|---|
| **Viewer** – schedule, live scores, leaderboard, Innovation Project times, view counter | `https://nityashah1811.github.io/FLLMockTournament/` | Teams, parents, everyone |
| **Admin** – enter scores, edit schedule/teams, announcements, see view stats | `https://nityashah1811.github.io/FLLMockTournament/admin/` | Organizers only (needs a token to save) |

## Logo and certificate images

`img/logo.png` is the emblem shown in the site header. The other files in `img/` (`logo-transparent.png`, `fll-challenge-reverse.png`, `cert-bg.jpg`) are the artwork used by the participation certificates in Google Slides.

## QR code

`img/qr.svg` is the QR code shown in the header of the public page (desktop and tablet widths). It points to the public site address.

## One-time setup (≈5 minutes)

1. **Turn on GitHub Pages**: repo → *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
2. Make sure these files are on the `main` branch (merge the working branch). Every push to `main` re-deploys the site (Actions tab shows progress).
3. **Make an admin token** (lets the admin page save): open <https://github.com/settings/personal-access-tokens/new>
   - Repository access → *Only select repositories* → `FLLMockTournament`
   - Repository permissions → **Contents: Read and write**
   - Generate, copy, then paste it into the admin page when asked. It's stored only in that browser.

## Running the tournament

1. Open `/admin/`, go to **Scores**, type scores, press the orange **Publish** button.
2. Use **Mark live** on a match to show “Now playing / Up next” to viewers.
3. **Schedule / Teams** tabs: change times, swap teams, add team numbers (Robo Phoenix and Kinetic Kaptains have none yet).
4. **Settings** tab: announcement banner, the **view & visitor counts**, backup download.

Published changes show up on the viewer page in about a minute (the admin page tells you when it's live). Viewer pages refresh themselves every 30 seconds.

## How it works

- All data lives in `data.json`. The admin page saves it to GitHub with the token; GitHub Actions publishes it.
- **View counter**: the viewer page calls the free [Abacus](https://abacus.jasoncameron.dev) counter service: one *view* per browser session, one *visitor* per browser. Visits from `localhost` aren't counted. Counter name is in `config.js`.
- Leaderboard ranks by each team's **best** Robot Game score; ties use the next-best score.
- Plain HTML/CSS/JS, no build step. To test locally: `python3 -m http.server` and open <http://localhost:8000>.
