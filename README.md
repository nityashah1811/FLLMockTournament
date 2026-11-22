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

## Scoring (the scorer page)

Scorers use `https://nityashah1811.github.io/FLLMockTournament/score/` on their phones:

1. Organizer: **Admin → Settings → Scorers → Copy scorer link**, and send it to each scorer. Opening the link once connects that phone.
2. Scorer: choose **Both tables / Table 1 / Table 2**, tap **Score** next to a team, tick off the missions (the total updates live), then **Save score**.
3. **Manual score override**: turn it on and type the final score by hand (a referee decision, a correction). The mission total is then ignored.
4. Saved scores appear for other scorers within about 20 seconds and on the public leaderboard about a minute later.

Several scorers can save at the same time; every save re-reads the newest data and only changes that one score. The admin page merges its changes the same way, so it never wipes out scorer entries.

**Mission points and descriptions** are in `js/missions.js`, taken from FIRST's official [Bioglow Robot Game Rulebook](https://firstinspires.blob.core.windows.net/fll/challenge/2026-27/fll-challenge-bioglow-rgr.pdf) (530-point maximum). If FIRST issues a Challenge Update, change the numbers or wording in that file. The mission pictures are in `img/missions/` (from the same rulebook).

**Keep the scorer link private.** It contains a GitHub key that can edit this repository. Make the key with a short expiry (e.g. 3 days) and delete it on GitHub after the event.

## How it works

- All data lives in `data.json`. The admin page saves it to GitHub with the token; GitHub Actions publishes it.
- **View counter**: the viewer page calls the free [Abacus](https://abacus.jasoncameron.dev) counter service: one *view* per browser session, one *visitor* per browser. Visits from `localhost` aren't counted. Counter name is in `config.js`.
- Leaderboard ranks by each team's **best** Robot Game score; ties use the next-best score.
- Plain HTML/CSS/JS, no build step. To test locally: `python3 -m http.server` and open <http://localhost:8000>.
