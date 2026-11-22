/* Organizer (admin) page.
 *
 * How saving works: the schedule/scores live in data.json inside the GitHub repo.
 * "Publish" saves data.json to GitHub using a personal access token that only the organizer has
 * (kept in this browser). GitHub Pages then updates the public site, usually within a minute.
 */
(function () {
  "use strict";
  const { esc, fmtTime, store, uid, CFG, teamLabel, sortedMatches, sortedInnovation, matchSlots, matchDone, matchStatuses, runsByTeam } = FLL;

  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const TOKEN_KEY = "fll_admin_token";
  const DRAFT_KEY = "fll_admin_draft";
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.dataFile}`;

  const S = {
    token: store.get(TOKEN_KEY) || "",
    data: null,
    sha: "",
    dirty: false,
    tab: "scores",
    hideDone: false,
    views: null,
    liveTimer: null,
    liveMsg: "",
  };

  // ---------- GitHub API ----------
  const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64dec = (b64) => decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
  const headers = () => ({ Authorization: "Bearer " + S.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

  function apiError(res, body) {
    const why = body && body.message ? ` (GitHub says: “${body.message}”)` : "";
    if (res.status === 401) return "GitHub says the token isn't valid or has expired. Make a new one and reconnect on the Settings tab." + why;
    if (res.status === 403 || res.status === 404)
      return `GitHub wouldn't let this token save ${CFG.dataFile} in ${CFG.owner}/${CFG.repo} (branch “${CFG.branch}”)${why}. ` +
        `Fix: make a new token whose Repository access includes ${CFG.repo} and whose Repository permissions say Contents → Read and write. ` +
        `Also make sure the token was created while signed in as ${CFG.owner}.`;
    return "GitHub error " + res.status + why;
  }

  async function ghLoad() {
    const res = await fetch(`${API}?ref=${encodeURIComponent(CFG.branch)}&_=${Date.now()}`, { headers: headers(), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiError(res, body));
    return { data: FLL.normalize(JSON.parse(b64dec(body.content))), sha: body.sha };
  }

  async function ghSave(overwrite) {
    if (overwrite) S.sha = (await ghLoad()).sha; // pick up the newest version id, then replace it
    const stamp = new Date().toISOString();
    S.data.updatedAt = stamp;
    const res = await fetch(API, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({
        message: "Update tournament data " + stamp,
        content: b64enc(JSON.stringify(S.data, null, 2) + "\n"),
        sha: S.sha,
        branch: CFG.branch,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 || (res.status === 422 && /sha/i.test(body.message || ""))) {
      const err = new Error("conflict");
      err.conflict = true;
      throw err;
    }
    if (!res.ok) throw new Error(apiError(res, body));
    S.sha = body.content.sha;
    return stamp;
  }

  // ---------- state helpers ----------
  function touch() {
    S.dirty = true;
    store.set(DRAFT_KEY, JSON.stringify({ data: S.data }));
    updateBar();
  }
  function clearDraft() { store.del(DRAFT_KEY); }

  function toast(html, kind) {
    const el = $("toast");
    if (el) el.innerHTML = html ? `<div class="notice ${kind || ""}">${html}</div>` : "";
  }

  function updateBar() {
    const bar = $("bar");
    bar.hidden = !(S.dirty && S.token);
    document.body.classList.toggle("has-bar", !bar.hidden);
    $("bar-msg").textContent = "You have unpublished changes";
  }

  // ---------- publish ----------
  async function publish() {
    const btn = $("publish");
    btn.disabled = true;
    btn.textContent = "Publishing…";
    toast("");
    try {
      let stamp;
      try {
        stamp = await ghSave(false);
      } catch (e) {
        if (!e.conflict) throw e;
        if (!confirm("The schedule was changed somewhere else since you opened this page (maybe on another device).\n\nReplace it with what is on this screen?")) throw new Error("Not published — reload the page to see the newest version.");
        stamp = await ghSave(true);
      }
      S.dirty = false;
      clearDraft();
      updateBar();
      watchLive(stamp);
      toast("✅ Saved to GitHub! The public page updates in about a minute.", "ok");
    } catch (e) {
      toast("⚠️ " + esc(e.message), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Publish";
    }
  }

  // After publishing, check the public site until it shows the new version.
  function watchLive(stamp) {
    clearInterval(S.liveTimer);
    let tries = 0;
    S.liveTimer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch(FLL.ROOT + CFG.dataFile + "?v=" + Date.now(), { cache: "no-store" });
        const d = await res.json();
        if (d.updatedAt === stamp) {
          clearInterval(S.liveTimer);
          toast("✅ Live! Everyone can see the latest version now.", "ok");
          return;
        }
      } catch (e) { /* keep trying */ }
      if (tries > 30) clearInterval(S.liveTimer);
    }, 8000);
  }

  // ---------- connect screen ----------
  function renderConnect(err) {
    $("bar").hidden = true;
    app.innerHTML = `
      <div class="card stack" style="margin-top:16px">
        <h2>Connect to GitHub (one time)</h2>
        <p>To save changes, this page needs a private “key” (a GitHub access token). It's stored only in this browser. Anyone without it can look at this page but can't change anything.</p>
        <h3 style="margin:4px 0 0">Easiest way</h3>
        <ol class="steps">
          <li>Open <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=FLL%20admin" target="_blank" rel="noopener"><b>this link</b></a> and sign in as <b>${esc(CFG.owner)}</b>.</li>
          <li>The <b>public_repo</b> box is already ticked. Set <b>Expiration</b> to a date after your tournament.</li>
          <li>Scroll to the bottom and click <b>Generate token</b>.</li>
          <li>Copy the token (starts with <code>ghp_</code>) and paste it below.</li>
        </ol>
        <details class="small muted"><summary>Prefer a fine-grained token?</summary>
          <p>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">the fine-grained token page</a>. Under <b>Repository access</b> choose <b>Only select repositories</b> and pick <b>${esc(CFG.repo)}</b> (the default “Public repositories” is read-only and will not work). Under <b>Permissions → Repository permissions</b> set <b>Contents</b> to <b>Read and write</b>.</p>
        </details>
        ${err ? `<div class="notice error">${esc(err)}</div>` : ""}
        <label class="field"><span>Access token</span><input type="password" id="token" placeholder="github_pat_…" autocomplete="off" autocapitalize="off"></label>
        <button class="btn" id="connect">Connect</button>
      </div>`;
    $("connect").onclick = async () => {
      const t = $("token").value.trim();
      if (!t) return;
      S.token = t;
      $("connect").disabled = true;
      $("connect").textContent = "Checking…";
      await start(true);
    };
  }

  // ---------- main UI ----------
  const TABS = [["scores", "🏁 Scores"], ["schedule", "📅 Schedule"], ["teams", "👥 Teams"], ["settings", "⚙️ Settings"]];

  function renderApp() {
    app.innerHTML = `
      <nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === S.tab}">${l}</button>`).join("")}</nav>
      <div id="toast"></div>
      <section id="panel"></section>`;
    app.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderApp(); }));
    renderPanel();
    updateBar();
  }

  function renderPanel() {
    const p = $("panel");
    p.innerHTML = { scores: scoresHtml, schedule: scheduleHtml, teams: teamsHtml, settings: settingsHtml }[S.tab]();
    if (S.tab === "settings") loadStats();
  }

  const teamOptions = (selected) =>
    `<option value="">— none —</option>` +
    S.data.teams.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.name)}${t.number ? " #" + esc(t.number) : ""}</option>`).join("");

  // ----- Scores tab -----
  function scoresHtml() {
    const d = S.data;
    const status = matchStatuses(d);
    let list = sortedMatches(d);
    const doneCount = list.filter(matchDone).length;
    if (S.hideDone) list = list.filter((m) => !matchDone(m));
    const rows = list.map((m) => {
      const st = status[m.id];
      const isNow = m.id === d.currentMatch;
      const slot = (k, label) => {
        const s = m[k];
        if (!s.team) return `<div class="slot-edit muted"><span class="table-tag">${label}</span><span class="team">— no team —</span></div>`;
        return `<div class="slot-edit"><span class="table-tag">${label}</span><span class="team">${esc(teamLabel(d, s.team))}</span>
          <input class="score-input" type="number" inputmode="numeric" min="0" max="9999" placeholder="Score" aria-label="${label} score"
            data-score="${m.id}:${k}" value="${s.score === null ? "" : s.score}"></div>`;
      };
      return `<div class="card match status-${st}" data-card="${m.id}">
        <div class="match-head"><span class="match-time">${fmtTime(m.time)}</span>
          <span class="row fixed" style="gap:8px"><span class="pill ${st}" data-pill>${{ done: "Finished", now: "Now playing", next: "Up next", later: "" }[st]}</span>
          ${isNow ? `<button class="btn secondary small" data-act="clearnow">Clear</button>` : `<button class="btn secondary small" data-act="now" data-id="${m.id}">▶ Mark live</button>`}</span></div>
        ${slot("t1", "Table 1")}${slot("t2", "Table 2")}</div>`;
    });
    return `
      <div class="notice">Type each team's score, then press the orange <b>Publish</b> button at the bottom. Use <b>Mark live</b> to show which match is on the table right now. (${doneCount} of ${d.matches.length} matches finished)</div>
      <label class="check"><input type="checkbox" data-act="hidedone" ${S.hideDone ? "checked" : ""}> Hide finished matches</label>
      ${rows.join("") || '<div class="empty">Nothing to show.</div>'}`;
  }

  // ----- Schedule tab -----
  function scheduleWarnings() {
    const d = S.data, out = [];
    // a team booked twice at the same time (two tables, or a match + judging)
    const seen = {};
    const add = (time, team, what) => { if (time && team) (seen[time + "|" + team] = seen[time + "|" + team] || []).push(what); };
    d.matches.forEach((m) => matchSlots(m).forEach((s) => add(m.time, s.team, "Robot Game")));
    d.innovation.forEach((s) => add(s.time, s.team, "Innovation Project"));
    Object.entries(seen).forEach(([key, list]) => {
      if (list.length > 1) { const [time, team] = key.split("|"); out.push(`${teamLabel(d, team)} is booked twice at ${fmtTime(time)} (${list.join(" + ")}).`); }
    });
    const runs = runsByTeam(d);
    d.teams.forEach((t) => { if (!runs[t.id].length) out.push(`${t.name || "A new team"} has no Robot Game matches.`); });
    const ipTeams = new Set(d.innovation.map((s) => s.team));
    const missing = d.teams.filter((t) => !ipTeams.has(t.id)).map((t) => t.name || "New team");
    if (missing.length) out.push(`No Innovation Project slot yet for: ${missing.join(", ")}.`);
    return out;
  }

  function scheduleHtml() {
    const d = S.data;
    const w = scheduleWarnings();
    const matchRows = sortedMatches(d).map((m) => `
      <div class="card stack" data-row="${m.id}">
        <div class="row"><input type="time" value="${esc(m.time)}" data-f="match-time:${m.id}" aria-label="Start time">
          <button class="btn icon fixed" data-act="delmatch" data-id="${m.id}" aria-label="Delete match">🗑</button></div>
        <div class="row"><span class="table-tag fixed">Table 1</span><select data-f="match-team:${m.id}:t1">${teamOptions(m.t1.team)}</select></div>
        <div class="row"><span class="table-tag fixed">Table 2</span><select data-f="match-team:${m.id}:t2">${teamOptions(m.t2.team)}</select></div>
      </div>`).join("");
    const ipRows = sortedInnovation(d).map((s) => `
      <div class="card stack" data-row="${s.id}">
        <div class="row"><input type="time" value="${esc(s.time)}" data-f="ip-time:${s.id}" aria-label="Start time">
          <button class="btn icon fixed" data-act="delip" data-id="${s.id}" aria-label="Delete slot">🗑</button></div>
        <select data-f="ip-team:${s.id}">${teamOptions(s.team)}</select>
        <label class="check"><input type="checkbox" data-f="ip-done:${s.id}" ${s.done ? "checked" : ""}> Judging finished</label>
      </div>`).join("");
    return `
      ${w.length ? `<div class="notice warn"><b>Heads up</b><ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <h2 class="section-title">Robot Game matches</h2>
      ${matchRows || '<div class="empty">No matches yet.</div>'}
      <button class="btn secondary" data-act="addmatch">+ Add match</button>
      <h2 class="section-title">Innovation Project judging</h2>
      ${ipRows || '<div class="empty">No sessions yet.</div>'}
      <button class="btn secondary" data-act="addip">+ Add judging slot</button>`;
  }

  // ----- Teams tab -----
  function teamsHtml() {
    const rows = S.data.teams.map((t) => `
      <div class="card stack" data-row="${t.id}">
        <input type="text" value="${esc(t.name)}" placeholder="Team name" data-f="team-name:${t.id}" aria-label="Team name">
        <div class="row"><input type="text" inputmode="numeric" value="${esc(t.number)}" placeholder="Team number (optional)" data-f="team-number:${t.id}" aria-label="Team number">
          <button class="btn icon fixed" data-act="delteam" data-id="${t.id}" aria-label="Delete team">🗑</button></div>
      </div>`).join("");
    return `${rows || '<div class="empty">No teams yet.</div>'}<button class="btn secondary" data-act="addteam">+ Add team</button>`;
  }

  // ----- Settings tab -----
  function settingsHtml() {
    const d = S.data;
    return `
      <div class="card"><h2>📊 Website views</h2>
        <div class="stats"><div class="stat"><b id="st-views">…</b>views</div><div class="stat"><b id="st-visitors">…</b>visitors</div></div>
        <p class="muted small" style="margin-bottom:0">A “view” is counted once each time someone opens the public page in a new browser session; a “visitor” is counted once per browser. Opening this admin page doesn't count.</p></div>

      <div class="card stack"><h2>Page text</h2>
        <label class="field"><span>Tournament name</span><input type="text" data-f="title" value="${esc(d.title)}"></label>
        <label class="field"><span>Subtitle (date, place…)</span><input type="text" data-f="subtitle" value="${esc(d.subtitle)}"></label>
        <label class="field"><span>Announcement banner (leave empty for none)</span><textarea rows="3" data-f="announcement" placeholder="e.g. Lunch is at 12:30 in the cafeteria!">${esc(d.announcement)}</textarea></label>
      </div>

      <div class="card stack"><h2>Tools</h2>
        <button class="btn secondary" data-act="backup">⬇ Download a backup (JSON)</button>
        <button class="btn danger" data-act="clearscores">Clear all scores</button>
      </div>

      <div class="card stack"><h2>GitHub connection</h2>
        <p class="muted small" style="margin:0">Connected to <b>${esc(CFG.owner)}/${esc(CFG.repo)}</b>.</p>
        <button class="btn danger" data-act="disconnect">Disconnect this browser</button>
      </div>`;
  }

  async function loadStats() {
    const c = await FLL.trackViews(false);
    S.views = c;
    if ($("st-views")) {
      $("st-views").textContent = c.views === null ? "n/a" : c.views.toLocaleString();
      $("st-visitors").textContent = c.visitors === null ? "n/a" : c.visitors.toLocaleString();
    }
  }

  // ---------- events ----------
  function setScore(mid, k, val) {
    const m = S.data.matches.find((x) => x.id === mid);
    if (!m) return;
    const n = val === "" ? null : Math.max(0, Math.round(Number(val)));
    m[k].score = n === null || isNaN(n) ? null : n;
    touch();
    // refresh the card's coloring/pill without redrawing (keeps keyboard focus)
    const card = document.querySelector(`[data-card="${mid}"]`);
    if (card) {
      const st = matchStatuses(S.data)[mid];
      card.className = `card match status-${st}`;
      const pill = card.querySelector("[data-pill]");
      pill.className = "pill " + st;
      pill.textContent = { done: "Finished", now: "Now playing", next: "Up next", later: "" }[st];
    }
  }

  app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.score) { const [mid, k] = t.dataset.score.split(":"); setScore(mid, k, t.value); return; }
    const f = t.dataset.f;
    if (!f) return;
    const [kind, id] = f.split(":");
    if (["title", "subtitle", "announcement"].includes(f)) { S.data[f] = t.value; touch(); }
    else if (kind === "team-name") { S.data.teams.find((x) => x.id === id).name = t.value; touch(); }
    else if (kind === "team-number") { S.data.teams.find((x) => x.id === id).number = t.value.trim(); touch(); }
  });

  app.addEventListener("change", (e) => {
    const t = e.target, d = S.data;
    if (t.dataset.act === "hidedone") { S.hideDone = t.checked; renderPanel(); return; }
    const f = t.dataset.f;
    if (!f) return;
    const [kind, id, slot] = f.split(":");
    if (kind === "match-time") { d.matches.find((x) => x.id === id).time = t.value; touch(); renderPanel(); }
    else if (kind === "match-team") { d.matches.find((x) => x.id === id)[slot].team = t.value; touch(); renderPanel(); }
    else if (kind === "ip-time") { d.innovation.find((x) => x.id === id).time = t.value; touch(); renderPanel(); }
    else if (kind === "ip-team") { d.innovation.find((x) => x.id === id).team = t.value; touch(); renderPanel(); }
    else if (kind === "ip-done") { d.innovation.find((x) => x.id === id).done = t.checked; touch(); }
  });

  function nextTime(list) {
    const last = list.map((x) => x.time).filter(Boolean).sort().pop();
    if (!last) return "13:00";
    const [h, m] = last.split(":").map(Number);
    const tot = h * 60 + m + 10;
    return String(Math.floor(tot / 60) % 24).padStart(2, "0") + ":" + String(tot % 60).padStart(2, "0");
  }

  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.type === "checkbox") return;
    const d = S.data, id = b.dataset.id;
    switch (b.dataset.act) {
      case "now": d.currentMatch = id; touch(); renderPanel(); break;
      case "clearnow": d.currentMatch = ""; touch(); renderPanel(); break;
      case "addmatch": d.matches.push({ id: uid("m"), time: nextTime(d.matches), t1: { team: "", score: null }, t2: { team: "", score: null } }); touch(); renderPanel(); break;
      case "delmatch":
        if (confirm("Delete this match?")) { d.matches = d.matches.filter((m) => m.id !== id); if (d.currentMatch === id) d.currentMatch = ""; touch(); renderPanel(); }
        break;
      case "addip": d.innovation.push({ id: uid("i"), time: nextTime(d.innovation), team: "", done: false }); touch(); renderPanel(); break;
      case "delip": if (confirm("Delete this judging slot?")) { d.innovation = d.innovation.filter((s) => s.id !== id); touch(); renderPanel(); } break;
      case "addteam": {
        const t = { id: uid("t"), name: "", number: "" };
        d.teams.push(t); touch(); renderPanel();
        const el = document.querySelector(`[data-f="team-name:${t.id}"]`);
        if (el) { el.focus(); el.scrollIntoView({ block: "center" }); }
        break;
      }
      case "delteam": {
        const t = d.teams.find((x) => x.id === id);
        if (confirm(`Delete “${t.name || "this team"}”? They will be removed from all matches and their scores will be lost.`)) {
          d.teams = d.teams.filter((x) => x.id !== id);
          d.matches.forEach((m) => ["t1", "t2"].forEach((k) => { if (m[k].team === id) m[k] = { team: "", score: null }; }));
          d.innovation = d.innovation.filter((s) => s.team !== id);
          touch(); renderPanel();
        }
        break;
      }
      case "clearscores":
        if (confirm("Erase EVERY score? (Teams and the schedule stay.)")) {
          d.matches.forEach((m) => { m.t1.score = null; m.t2.score = null; }); d.currentMatch = ""; touch(); renderPanel();
        }
        break;
      case "backup": {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
        a.download = "fll-tournament-backup-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".json";
        a.click();
        break;
      }
      case "disconnect":
        if (confirm("Disconnect this browser from GitHub? Unpublished changes on this screen will be lost.")) {
          store.del(TOKEN_KEY); clearDraft(); S.token = ""; S.dirty = false; S.data = null; renderConnect();
        }
        break;
    }
  });

  $("publish").addEventListener("click", publish);
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- start ----------
  async function start(fromConnect) {
    if (!S.token) return renderConnect();
    app.innerHTML = `<p class="empty">Loading the latest schedule from GitHub…</p>`;
    try {
      const r = await ghLoad();
      S.data = r.data;
      S.sha = r.sha;
      store.set(TOKEN_KEY, S.token);
    } catch (e) {
      if (fromConnect || !store.get(TOKEN_KEY)) S.token = "";
      else app.innerHTML = "";
      if (!S.token) return renderConnect(e.message);
      app.innerHTML = `<div class="notice error" style="margin-top:16px">⚠️ ${esc(e.message)}</div><button class="btn" onclick="location.reload()">Try again</button>`;
      return;
    }
    // Restore unpublished work from an earlier visit (e.g. phone died, page reloaded)
    const raw = store.get(DRAFT_KEY);
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        if (draft && draft.data && JSON.stringify(draft.data) !== JSON.stringify(S.data) &&
            confirm("You have changes from earlier that were never published.\n\nPress OK to bring them back, or Cancel to throw them away.")) {
          S.data = FLL.normalize(draft.data);
          S.dirty = true;
        } else clearDraft();
      } catch (e) { clearDraft(); }
    }
    renderApp();
  }

  start(false);
})();
