/* Public viewer page */
(function () {
  "use strict";
  const { esc, fmtTime, fmtStamp, store, teamHtml, teamById, sortedMatches, sortedInnovation, matchStatuses, runsByTeam, leaderboard } = FLL;

  const $ = (id) => document.getElementById(id);
  const TABS = ["schedule", "leaderboard", "innovation"];
  let data = null;
  let lastJson = "";
  let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "schedule";
  let myTeam = store.get("fll_myteam") || "";

  // ---------- rendering ----------
  function slotHtml(label, slot, mine) {
    if (!slot.team) {
      return `<div class="slot empty-slot"><span class="table-tag">${label}</span><span class="team">— no team —</span></div>`;
    }
    const score = slot.score === null ? `<span class="score none">–</span>` : `<span class="score">${slot.score}</span>`;
    return `<div class="slot${mine ? " mine" : ""}"><span class="table-tag">${label}</span><span class="team">${teamHtml(data, slot.team)}</span>${score}</div>`;
  }

  const PILL = { done: ["done", "Finished"], now: ["now", "Now playing"], next: ["next", "Up next"] };

  function renderSchedule() {
    const status = matchStatuses(data);
    let list = sortedMatches(data);
    if (myTeam) list = list.filter((m) => m.t1.team === myTeam || m.t2.team === myTeam);
    if (!list.length) return `<div class="empty">No matches scheduled yet.</div>`;
    return list
      .map((m) => {
        const st = status[m.id];
        const pill = PILL[st] ? `<span class="pill ${PILL[st][0]}">${PILL[st][1]}</span>` : "";
        return `<div class="card match status-${st}">
          <div class="match-head"><span class="match-time">${fmtTime(m.time)}</span>${pill}</div>
          ${slotHtml("Table 1", m.t1, myTeam && m.t1.team === myTeam)}
          ${slotHtml("Table 2", m.t2, myTeam && m.t2.team === myTeam)}
        </div>`;
      })
      .join("");
  }

  const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

  function renderLeaderboard() {
    const { rows, rounds } = leaderboard(data);
    if (!rows.length) return `<div class="empty">No teams yet.</div>`;
    const anyScore = rows.some((r) => r.best !== null);
    let head = `<tr><th>#</th><th class="team">Team</th>`;
    for (let i = 1; i <= rounds; i++) head += `<th>R${i}</th>`;
    head += `<th>Best</th></tr>`;
    const body = rows
      .map((r) => {
        const cells = [];
        for (let i = 0; i < rounds; i++) {
          const s = r.scores[i];
          cells.push(`<td>${s === undefined || s === null ? '<span class="dash">–</span>' : s}</td>`);
        }
        const rank = r.rank === null ? '<span class="dash">–</span>' : MEDAL[r.rank] || r.rank;
        const num = r.team.number ? `<small>#${esc(r.team.number)}</small>` : "";
        return `<tr class="${myTeam === r.team.id ? "mine" : ""}"><td class="rank">${rank}</td>
          <td class="team">${esc(r.team.name)}${num}</td>${cells.join("")}
          <td class="best${r.rank && r.rank <= 3 ? " top" : ""}">${r.best === null ? '<span class="dash">–</span>' : r.best}</td></tr>`;
      })
      .join("");
    return `${anyScore ? "" : '<div class="notice">No scores yet — check back once the first matches are finished!</div>'}
      <div class="card board-wrap"><table class="board"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="muted small">Teams are ranked by their <b>best</b> Robot Game score. Ties are broken by the next-best score.</p>`;
  }

  function renderInnovation() {
    let list = sortedInnovation(data);
    if (myTeam) list = list.filter((s) => s.team === myTeam);
    if (!list.length) return `<div class="empty">${myTeam ? "This team has no Innovation Project slot listed." : "No Innovation Project sessions scheduled yet."}</div>`;
    return list
      .map(
        (s) => `<div class="card match status-${s.done ? "done" : "later"}">
          <div class="match-head"><span class="match-time">${fmtTime(s.time)}</span>${s.done ? '<span class="pill done">Finished</span>' : ""}</div>
          <div class="slot${myTeam && s.team === myTeam ? " mine" : ""}"><span class="table-tag">Judging</span><span class="team">${teamHtml(data, s.team)}</span></div>
        </div>`
      )
      .join("");
  }

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
    items.push(nextRun
      ? `<li>Next Robot Game run: <b>${fmtTime(nextRun.time)}</b> at <b>${nextRun.table}</b>${status[nextRun.matchId] === "now" ? " (happening now!)" : ""}</li>`
      : runs.length ? `<li>All Robot Game runs finished 🎉</li>` : `<li>No Robot Game runs scheduled yet.</li>`);
    if (ip) items.push(`<li>Innovation Project judging: <b>${fmtTime(ip.time)}</b>${ip.done ? " (done)" : ""}</li>`);
    if (row && row.best !== null) items.push(`<li>Best score: <b>${row.best}</b> · Rank: <b>#${row.rank}</b></li>`);
    el.innerHTML = `<div class="card myteam-card"><h3>${esc(t.name)}</h3><ul>${items.join("")}</ul></div>`;
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
    document.title = data.title;
    $("title").textContent = data.title;
    $("subtitle").textContent = data.subtitle;
    $("updated").textContent = data.updatedAt ? "Last updated " + fmtStamp(data.updatedAt) + " · refreshes automatically" : "";
    $("banner").innerHTML = data.announcement ? `<div class="banner">📣 ${esc(data.announcement)}</div>` : "";
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    renderPicker();
    renderMyTeam();
    $("view").innerHTML = tab === "leaderboard" ? renderLeaderboard() : tab === "innovation" ? renderInnovation() : renderSchedule();
  }

  // ---------- loading ----------
  async function refresh() {
    try {
      const d = await FLL.loadPublicData();
      const j = JSON.stringify(d);
      if (j !== lastJson) { lastJson = j; data = d; render(); }
    } catch (e) {
      if (!data) $("view").innerHTML = `<div class="notice error">Couldn't load the schedule. Check your internet connection and refresh the page.</div>`;
      $("updated").textContent = data ? $("updated").textContent : "Offline";
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
  });
})();
