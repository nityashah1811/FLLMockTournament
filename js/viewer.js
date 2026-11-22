/* Public viewer page */
(function () {
  "use strict";
  const { esc, fmtTime, fmtStamp, store, teamHtml, teamById, sortedMatches, sortedInnovation, matchStatuses, runsByTeam, leaderboard } = FLL;

  const $ = (id) => document.getElementById(id);
  const TABS = ["schedule", "leaderboard", "scores", "innovation"];
  let data = null;
  let lastJson = "";
  let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "schedule";
  let myTeam = store.get("fll_myteam") || "";
  // A QR code on a team's table can link to ?team=<id> so the page opens already showing that team.
  try {
    const qTeam = new URLSearchParams(location.search).get("team");
    if (qTeam) { myTeam = qTeam; store.set("fll_myteam", qTeam); }
  } catch (e) { /* ignore */ }

  // ---------- Robot Game schedule ----------
  const TAG = { done: "Final", now: "Now playing", next: "Up next" };

  function cell(slot) {
    if (!slot.team) return `<td><div class="cell none"><span class="nm">&mdash;</span></div></td>`;
    const score = slot.score === null ? "" : `<span class="sc">${slot.score}</span>`;
    return `<td class="${myTeam === slot.team ? "mine" : ""}"><div class="cell"><span class="nm">${teamHtml(data, slot.team)}</span>${score}</div></td>`;
  }

  function renderSchedule() {
    const status = matchStatuses(data);
    let list = sortedMatches(data);
    if (myTeam) list = list.filter((m) => m.t1.team === myTeam || m.t2.team === myTeam);
    if (!list.length) return `<div class="empty">No matches scheduled yet.</div>`;
    const rows = list
      .map((m) => {
        const st = status[m.id];
        const tag = TAG[st] ? `<span class="tag ${st}">${TAG[st]}</span>` : "";
        return `<tr class="status-${st}"><td class="c-time"><span class="time">${fmtTime(m.time)}</span>${tag}</td>${cell(m.t1)}${cell(m.t2)}</tr>`;
      })
      .join("");
    return `<div class="panel"><table class="sched"><thead><tr><th>Start</th><th>Table 1</th><th>Table 2</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------- Leaderboard (FLL Challenge ranking) ----------
  // Rank = highest score of the team's 3 matches. Ties: compare 2nd-highest, then 3rd-highest.
  function renderLeaderboard() {
    const { rows, rounds } = leaderboard(data);
    if (!rows.length) return `<div class="empty">No teams yet.</div>`;
    const anyScore = rows.some((r) => r.best !== null);
    let head = `<tr><th>Rank</th><th class="team">Team</th>`;
    for (let i = 1; i <= rounds; i++) head += `<th><span class="long">Match ${i}</span><span class="short">M${i}</span></th>`;
    head += `<th>Best</th></tr>`;
    const body = rows
      .map((r) => {
        const bestIdx = r.best === null ? -1 : r.scores.indexOf(r.best);
        const cells = [];
        for (let i = 0; i < rounds; i++) {
          const s = r.scores[i];
          cells.push(`<td class="${i === bestIdx ? "used" : "dropped"}">${s === undefined || s === null ? '<span class="dash">&ndash;</span>' : s}</td>`);
        }
        const rank = r.rank === null ? '<span class="dash">&ndash;</span>' : (r.tied ? "<span>T</span>" : "") + r.rank;
        const num = r.team.number ? `<small>Team #${esc(r.team.number)}</small>` : "";
        const cls = [myTeam === r.team.id ? "mine" : "", r.rank && r.rank <= 3 ? "r" + r.rank : ""].join(" ");
        return `<tr class="${cls}"><td class="rank">${rank}</td><td class="team">${esc(r.team.name)}${num}</td>${cells.join("")}
          <td class="best">${r.best === null ? '<span class="dash">&ndash;</span>' : r.best}</td></tr>`;
      })
      .join("");
    return `${anyScore ? "" : '<div class="notice">No scores yet. Rankings will appear as matches finish.</div>'}
      <div class="panel"><table class="board"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="rules"><b>How teams are ranked:</b> by each team's <b>highest</b> Robot Game score from its ${rounds} matches. If teams tie, the <b>second-highest</b> score decides, then the <b>third-highest</b>. Teams still tied share a rank (T).</p>`;
  }

  // ---------- Score details: which missions earned points in each match ----------
  const SC = window.FLLScore, SHEET = SC.SHEET;
  const pts = (n) => (n > 0 ? "+" + n : "0");

  // The lines of one scoresheet: [{ label, detail, points }] for everything that earned points.
  function earnedLines(detail) {
    const sheet = SC.clean(JSON.parse(JSON.stringify(detail.sheet)));
    const lines = [];
    if (sheet.inspect) lines.push({ label: SHEET.inspection.label, points: SHEET.inspection.points });
    const notScored = [];
    SHEET.missions.forEach((m) => {
      const total = SC.missionPoints(sheet, m);
      const zeroed = m.items.some((i) => i.zeroMission && sheet.v[SC.key(m, i)]);
      const parts = [];
      m.items.forEach((i) => {
        if (i.zeroMission) return;
        const p = SC.itemPoints(sheet, m, i);
        if (p <= 0) return;
        const val = sheet.v[SC.key(m, i)];
        const note = i.type === "count" ? " &times; " + val : i.type === "choice" ? ": " + esc(i.options[val].label) : "";
        parts.push({ label: esc(i.label) + note, points: p });
      });
      if (zeroed) lines.push({ mission: m.name, parts: [], total: 0, zeroed: true });
      else if (total > 0) lines.push({ mission: m.name, parts, total });
      else notScored.push(m.name.split(" ")[0]);
    });
    const tp = SHEET.tokens.points[sheet.tokens] || 0;
    lines.push({ label: "Precision tokens left: " + sheet.tokens, points: tp });
    return { lines, notScored };
  }

  function breakdownHtml(slot) {
    const d = slot.detail;
    if (!d || !d.sheet || d.manual) return `<p class="muted small" style="margin:0">This score was entered as a total, so there is no mission-by-mission breakdown.</p>`;
    const { lines, notScored } = earnedLines(d);
    const rows = lines.map((l) => l.mission
      ? `<tr class="mis"><td>${esc(l.mission)}${l.zeroed ? ' <span class="muted">(scored 0: a rule cancelled it)</span>' : ""}</td><td class="p">${pts(l.total)}</td></tr>` +
        l.parts.map((x) => `<tr class="sub"><td>${x.label}</td><td class="p">${pts(x.points)}</td></tr>`).join("")
      : `<tr class="mis"><td>${esc(l.label)}</td><td class="p">${pts(l.points)}</td></tr>`).join("");
    return `<table class="bd"><tbody>${rows}</tbody><tfoot><tr><td>Total</td><td class="p">${slot.score}</td></tr></tfoot></table>
      ${notScored.length ? `<p class="muted small" style="margin:8px 0 0">No points: ${notScored.join(", ")}</p>` : ""}`;
  }

  function renderScores() {
    const runs = [];
    sortedMatches(data).forEach((m) => ["t1", "t2"].forEach((k) => {
      const s = m[k];
      if (s.team && s.score !== null && (!myTeam || s.team === myTeam)) runs.push({ m, s, table: k === "t1" ? "Table 1" : "Table 2" });
    }));
    const order = {}; data.teams.forEach((t) => (order[t.id] = 0));
    const matchNo = {};
    sortedMatches(data).forEach((m) => ["t1", "t2"].forEach((k) => { const t = m[k].team; if (t) { order[t] = (order[t] || 0) + 1; matchNo[m.id + k] = order[t]; } }));
    if (!runs.length) return `<div class="empty">${myTeam ? "This team has no scored matches yet." : "No scores yet. Each match's mission-by-mission breakdown will appear here once it is scored."}</div>`;
    runs.reverse();
    return runs.map(({ m, s, table }) => {
      const key = m.id + (table === "Table 1" ? "t1" : "t2");
      return `<details class="run panel"${myTeam ? " open" : ""}><summary><span class="who">${teamHtml(data, s.team)}<small>Match ${matchNo[key]} &middot; ${fmtTime(m.time)} &middot; ${table}</small></span><span class="tot">${s.score}</span></summary>
        <div class="run-body">${breakdownHtml(s)}</div></details>`;
    }).join("");
  }

  // ---------- Innovation Project ----------
  function renderInnovation() {
    let list = sortedInnovation(data);
    if (myTeam) list = list.filter((s) => s.team === myTeam);
    if (!list.length) return `<div class="empty">${myTeam ? "This team has no Innovation Project judging slot." : "No Innovation Project judging scheduled yet."}</div>`;
    const rows = list
      .map(
        (s) => `<tr class="${myTeam && s.team === myTeam ? "mine" : ""}"><td class="t">${fmtTime(s.time)}</td><td><b>${teamHtml(data, s.team)}</b></td>
          <td style="text-align:right">${s.done ? '<span class="tag done">Complete</span>' : ""}</td></tr>`
      )
      .join("");
    return `<div class="panel"><table class="simple"><thead><tr><th>Start</th><th>Team</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------- Team summary ----------
  function renderMyTeam() {
    const el = $("myteam");
    const t = teamById(data, myTeam);
    if (!t) { el.innerHTML = ""; return; }
    const status = matchStatuses(data);
    const runs = runsByTeam(data)[t.id] || [];
    const nextRun = runs.find((r) => status[r.matchId] !== "done");
    const ip = sortedInnovation(data).find((s) => s.team === t.id);
    const { rows } = leaderboard(data);
    const row = rows.find((r) => r.team.id === t.id);
    const items = [];
    items.push(["Next Robot Game match", nextRun
      ? `${fmtTime(nextRun.time)} &middot; ${nextRun.table}${status[nextRun.matchId] === "now" ? " (now playing)" : ""}`
      : runs.length ? "All matches complete" : "Not scheduled"]);
    if (ip) items.push(["Innovation Project", fmtTime(ip.time) + (ip.done ? " (complete)" : "")]);
    if (row && row.best !== null) items.push(["Best score", `${row.best} &middot; Rank ${row.tied ? "T" : ""}${row.rank}`]);
    el.innerHTML = `<div class="card summary"><h3>${esc(t.name)}</h3><dl>${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
  }

  function renderPicker() {
    const sel = $("team-pick");
    if (myTeam && !teamById(data, myTeam)) myTeam = "";
    sel.innerHTML =
      `<option value="">All teams</option>` +
      data.teams
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => `<option value="${esc(t.id)}"${t.id === myTeam ? " selected" : ""}>${esc(t.name)}${t.number ? " #" + esc(t.number) : ""}</option>`)
        .join("");
  }

  function render() {
    if (!data) return;
    document.title = data.title + " | Mechanical Mages";
    $("title").textContent = data.title;
    $("subtitle").textContent = data.subtitle;
    $("updated").textContent = data.updatedAt ? "Last updated " + fmtStamp(data.updatedAt) : "";
    $("banner").innerHTML = data.announcement ? `<div class="banner"><b>Announcement</b><span>${esc(data.announcement)}</span></div>` : "";
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    renderPicker();
    renderMyTeam();
    $("view").innerHTML = tab === "leaderboard" ? renderLeaderboard() : tab === "scores" ? renderScores() : tab === "innovation" ? renderInnovation() : renderSchedule();
  }

  // ---------- loading ----------
  async function refresh() {
    try {
      const d = await FLL.loadPublicData();
      const j = JSON.stringify(d);
      if (j !== lastJson) { lastJson = j; data = d; render(); }
    } catch (e) {
      if (!data) $("view").innerHTML = `<div class="notice error">Couldn't load the schedule. Check your internet connection and refresh the page.</div>`;
      if (!data) $("updated").textContent = "Offline";
    }
  }

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => { tab = b.dataset.tab; history.replaceState(null, "", "#" + tab); render(); })
  );
  $("team-pick").addEventListener("change", (e) => { myTeam = e.target.value; store.set("fll_myteam", myTeam); render(); });
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h)) { tab = h; render(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);

  refresh();
  FLL.trackViews(true).then((c) => {
    if (c.views !== null) { $("views").textContent = c.views.toLocaleString(); $("visitors").textContent = c.visitors.toLocaleString(); }
    else { const l = $("views").closest("div"); if (l) l.hidden = true; }   // counter blocked on this network: hide the line instead of showing dashes
  });
})();
