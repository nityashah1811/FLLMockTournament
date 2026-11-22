/* Scorer page: pick a match, tick off the missions, save the score.
 *
 * Screens:  connect (first time only)  ->  list of matches  ->  scoresheet  ->  back to the list.
 */
(function () {
  "use strict";
  const { esc, fmtTime, store } = FLL;
  const GH = FLLGH, SC = FLLScore, SHEET = SC.SHEET;

  const $ = (id) => document.getElementById(id);
  const app = $("app"), bar = $("bar");

  const st = {
    data: null,
    view: "boot",            // boot | connect | list | sheet
    table: store.get("fll_sc_table") || "both",   // both | t1 | t2
    filter: store.get("fll_sc_filter") || "todo", // todo | all
    cur: null,               // { mid, slot }
    sheet: null,
    manual: false, manualVal: "", note: "",
    busy: false, msg: "", err: "",
    timer: null,
  };

  // ---------- helpers ----------
  const slotLabel = { t1: "Table 1", t2: "Table 2" };
  const teamName = (id) => { const t = FLL.teamById(st.data, id); return t ? t.name : ""; };
  const findMatch = (mid) => st.data.matches.find((m) => m.id === mid);
  const intOrNull = (v) => { const s = String(v).trim(); return /^\d+$/.test(s) ? parseInt(s, 10) : null; };

  function finalScore() {
    if (st.manual) return intOrNull(st.manualVal);
    return SC.compute(st.sheet);
  }

  // ---------- connect ----------
  function renderConnect(err) {
    st.view = "connect"; bar.hidden = true; document.body.classList.remove("has-bar");
    app.innerHTML = `
      <div class="card stack" style="margin-top:16px">
        <h2>Connect this device</h2>
        <p>Ask the organizer for the <b>scorer link</b> and open it on this device. That connects you automatically.</p>
        <p class="muted small">Or paste the scorer key the organizer gave you:</p>
        ${err ? `<div class="notice error">${esc(err)}</div>` : ""}
        <label class="field"><span>Scorer key</span><input type="password" id="key" autocomplete="off" autocapitalize="off" placeholder="ghp_…"></label>
        <button class="btn big" id="connect">Connect</button>
      </div>`;
    $("connect").onclick = async () => {
      const t = $("key").value.trim(); if (!t) return;
      $("connect").disabled = true; $("connect").textContent = "Checking…";
      try { await GH.load(t); GH.setToken(t); await start(); }
      catch (e) { renderConnect(e.message); }
    };
  }

  // ---------- match list ----------
  function listHtml() {
    const d = st.data, status = FLL.matchStatuses(d);
    const slots = ["t1", "t2"].filter((k) => st.table === "both" || st.table === k);
    const total = d.matches.reduce((n, m) => n + ["t1", "t2"].filter((k) => m[k].team).length, 0);
    const scored = d.matches.reduce((n, m) => n + ["t1", "t2"].filter((k) => m[k].team && m[k].score !== null).length, 0);

    const rows = FLL.sortedMatches(d).filter((m) => {
      const mine = slots.filter((k) => m[k].team);
      if (!mine.length) return false;
      return st.filter === "all" || mine.some((k) => m[k].score === null);
    }).map((m) => {
      const stt = status[m.id];
      const tag = stt === "now" ? '<span class="tag now">Now playing</span>' : stt === "next" ? '<span class="tag next">Up next</span>' : "";
      const lines = slots.map((k) => {
        const s = m[k];
        if (!s.team) return `<div class="sc-row none"><span class="table-tag">${slotLabel[k]}</span><span class="sc-team muted">No team</span></div>`;
        const done = s.score !== null;
        const manual = done && s.detail && s.detail.manual ? ' <span class="tag">manual</span>' : "";
        return `<button class="sc-row" data-open="${m.id}:${k}">
          <span class="table-tag">${slotLabel[k]}</span><span class="sc-team">${esc(teamName(s.team))}${manual}</span>
          <span class="sc-score ${done ? "done" : ""}">${done ? s.score : "Score"}</span></button>`;
      }).join("");
      return `<div class="card sc-match status-${stt}"><div class="match-head"><span class="match-time">${fmtTime(m.time)}</span>${tag}</div>${lines}</div>`;
    }).join("");

    return `
      ${st.msg ? `<div class="notice ok">${st.msg}</div>` : ""}${st.err ? `<div class="notice error">${esc(st.err)}</div>` : ""}
      <div class="sc-progress"><b>${scored}</b> of <b>${total}</b> scores entered</div>
      <div class="sc-controls">
        <div class="seg" role="group" aria-label="Which table are you scoring?">
          <span class="seg-label">I'm scoring</span>
          ${[["both", "Both tables"], ["t1", "Table 1"], ["t2", "Table 2"]].map(([v, l]) => `<button data-table="${v}" aria-pressed="${st.table === v}">${l}</button>`).join("")}
        </div>
        <div class="seg" role="group" aria-label="Which matches to show">
          <span class="seg-label">Show</span>
          ${[["todo", "Not scored yet"], ["all", "All matches"]].map(([v, l]) => `<button data-filter="${v}" aria-pressed="${st.filter === v}">${l}</button>`).join("")}
        </div>
      </div>
      ${rows || `<div class="empty">${st.filter === "todo" ? "Everything is scored." : "No matches to show."}</div>`}`;
  }

  // ---------- scoresheet ----------
  function openSheet(mid, slot) {
    const m = findMatch(mid); if (!m) return;
    const s = m[slot];
    st.cur = { mid, slot };
    st.msg = ""; st.err = "";
    if (s.detail && s.detail.sheet) {
      st.sheet = SC.clean(GH.clone(s.detail.sheet));
      st.manual = !!s.detail.manual;
      st.manualVal = s.detail.manual && s.detail.manualScore !== undefined && s.detail.manualScore !== null ? String(s.detail.manualScore) : "";
      st.note = s.detail.note || "";
    } else if (s.score !== null) {            // scored by hand earlier (e.g. by the organizer): open as a manual score
      st.sheet = SC.defaultSheet(); st.manual = true; st.manualVal = String(s.score); st.note = "";
    } else {
      st.sheet = SC.defaultSheet(); st.manual = false; st.manualVal = ""; st.note = "";
    }
    st.view = "sheet";
    render();
    window.scrollTo(0, 0);
  }

  const descHtml = (d) => (d ? `<small class="sc-desc">${esc(d)}</small>` : "");

  function rowToggle(k, label, pts, on, enabled, desc, zero) {
    return `<button class="sc-toggle ${on ? "on" : ""} ${zero ? "zero" : ""}" data-act="toggle" data-k="${k}" ${enabled ? "" : "disabled"} aria-pressed="${on}">
      <span class="sc-box">${on ? "✓" : ""}</span><span class="sc-lbl">${esc(label)}${descHtml(desc)}</span><span class="sc-pts">${zero ? "= 0" : "+" + pts}</span></button>`;
  }

  function missionHtml(m) {
    const sheet = st.sheet, v = sheet.v;
    const items = m.items.map((i) => {
      const k = SC.key(m, i), enabled = SC.available(sheet, m, i);
      if (i.type === "check") return rowToggle(k, i.label, i.points, !!v[k], enabled, i.desc, i.zeroMission);
      if (i.type === "count") {
        const max = SC.countMax(sheet, m, i), n = Number(v[k] || 0);
        return `<div class="sc-count ${enabled ? "" : "off"}"><span class="sc-lbl">${esc(i.label)}<small class="sc-each">${i.points} each, up to ${max}</small>${descHtml(i.desc)}</span>
          <span class="sc-step"><button data-act="dec" data-k="${k}" ${enabled && n > 0 ? "" : "disabled"} aria-label="One less">−</button><b>${n}</b>
          <button data-act="inc" data-k="${k}" ${enabled && n < max ? "" : "disabled"} aria-label="One more">+</button></span></div>`;
      }
      const cur = v[k];
      return `<div class="sc-choice"><span class="sc-lbl">${esc(i.label)}${descHtml(i.desc)}</span><span class="sc-opts">
        <button class="${cur === undefined ? "on" : ""}" data-act="choice" data-k="${k}" data-i="">None</button>
        ${i.options.map((o, idx) => `<button class="${cur === idx ? "on" : ""}" data-act="choice" data-k="${k}" data-i="${idx}">${esc(o.label)}${o.points ? ` <small>+${o.points}</small>` : ""}</button>`).join("")}</span></div>`;
    }).join("");
    const pts = SC.missionPoints(sheet, m);
    const n = m.id.slice(1);
    return `<section class="card sc-mission"><h3><span>${esc(m.name)}</span><em class="${pts ? "has" : ""}">${pts}</em></h3>
      <div class="sc-body">
        <button class="sc-pic" data-pic="${m.id}" aria-label="Enlarge the picture of ${esc(m.name)}"><img src="../img/missions/${m.id}.jpg" alt="${esc(m.name)} model" loading="lazy"></button>
        <div class="sc-items">${m.noTouch ? '<p class="sc-hint">Scores nothing if the model is touching equipment at the end of the match.</p>' : ""}${items}</div>
      </div></section>`;
  }

  function sheetHtml() {
    const { mid, slot } = st.cur, m = findMatch(mid), s = m[slot];
    const sheet = st.sheet, tk = SHEET.tokens;
    const manualOk = !st.manual || intOrNull(st.manualVal) !== null;
    return `
      <div class="sc-top">
        <button class="btn secondary small" data-act="back">← Back</button>
        <div class="sc-who"><b>${esc(teamName(s.team))}</b><span>${fmtTime(m.time)} · ${slotLabel[slot]}</span></div>
      </div>
      ${st.err ? `<div class="notice error">${esc(st.err)}</div>` : ""}
      <div class="sc-note-top">${st.manual ? "<b>Manual override is on.</b> The missions below are ignored." : "Tap everything that was completed. The total updates as you go."}</div>
      <section class="card sc-mission"><h3><span>Equipment inspection</span></h3>
        ${rowToggle("inspect", "Passed inspection", SHEET.inspection.points, sheet.inspect, true, SHEET.inspection.desc)}</section>
      ${SHEET.missions.map(missionHtml).join("")}
      <section class="card sc-mission"><h3><span>Precision tokens</span><em class="has">${tk.points[sheet.tokens]}</em></h3>
        <p class="sc-hint">${esc(tk.desc)}</p>
        <div class="sc-tokens">${[6, 5, 4, 3, 2, 1, 0].map((n) => `<button class="${sheet.tokens === n ? "on" : ""}" data-act="tokens" data-n="${n}">${n}<small>+${tk.points[n]}</small></button>`).join("")}</div></section>
      <section class="card sc-manual ${st.manual ? "on" : ""}"><h3><span>Manual score override</span></h3>
        <p class="sc-hint">Use this if the referee decides the score by hand. The number you type replaces the mission total.</p>
        <button class="sc-toggle ${st.manual ? "on" : ""}" data-act="manual" aria-pressed="${st.manual}"><span class="sc-box">${st.manual ? "✓" : ""}</span><span class="sc-lbl">Type the score by hand</span></button>
        ${st.manual ? `<label class="field" style="margin-top:10px"><span>Final score</span><input type="text" inputmode="numeric" id="manualVal" value="${esc(st.manualVal)}" placeholder="e.g. 245" autocomplete="off"></label>
          ${manualOk ? "" : '<div class="notice warn">Type a whole number, like 245.</div>'}
          ${intOrNull(st.manualVal) > SHEET.max ? `<div class="notice warn">That is more than the ${SHEET.max}-point maximum. Double-check it.</div>` : ""}` : ""}
        <label class="field" style="margin-top:10px"><span>Note (optional)</span><input type="text" id="note" value="${esc(st.note)}" placeholder="e.g. referee ruling" autocomplete="off"></label>
      </section>
      <div class="stack" style="margin:8px 0 28px">
        <button class="btn secondary" data-act="reset">Start this sheet over</button>
        ${s.score !== null ? '<button class="btn danger" data-act="clear">Remove the saved score</button>' : ""}
      </div>`;
  }

  function updateBar() {
    bar.hidden = st.view !== "sheet";
    document.body.classList.toggle("has-bar", !bar.hidden);
    if (st.view !== "sheet") return;
    const f = finalScore();
    $("bar-label").textContent = st.manual ? "Manual score" : `Score (max ${SHEET.max})`;
    $("bar-total").textContent = f === null ? "–" : f;
    const btn = $("bar-save");
    btn.disabled = st.busy || f === null;
    btn.textContent = st.busy ? "Saving…" : "Save score";
  }

  function render() {
    if (st.view === "connect") return;
    app.classList.toggle("manual-on", st.view === "sheet" && st.manual);
    app.innerHTML = st.view === "sheet" ? sheetHtml() : st.data ? listHtml() : '<p class="empty">Loading…</p>';
    updateBar();
  }

  // ---------- actions ----------
  async function save() {
    if (st.busy) return;
    const f = finalScore(); if (f === null) return;
    const { mid, slot } = st.cur, m = findMatch(mid), name = teamName(m[slot].team);
    const detail = { season: "bioglow", sheet: GH.clone(st.sheet), computed: SC.compute(st.sheet), manual: st.manual, manualScore: st.manual ? f : null, note: st.note.trim() };
    st.busy = true; st.err = ""; render();
    try {
      const r = await GH.update((d) => {
        const mm = d.matches.find((x) => x.id === mid);
        if (!mm) throw new Error("That match was removed from the schedule.");
        mm[slot].score = f; mm[slot].detail = detail; mm[slot].scoredAt = new Date().toISOString();
        return d;
      }, `Score: ${name} ${f} (${slotLabel[slot]})`);
      st.data = r.data; st.view = "list"; st.msg = `Saved: <b>${esc(name)}</b> scored <b>${f}</b>. The public leaderboard updates in about a minute.`;
    } catch (e) { st.err = "Could not save: " + e.message; }
    st.busy = false; render();
    if (st.view === "list") window.scrollTo(0, 0);
  }

  async function clearScore() {
    if (!confirm("Remove the saved score for this team?")) return;
    const { mid, slot } = st.cur; st.busy = true; render();
    try {
      const r = await GH.update((d) => { const mm = d.matches.find((x) => x.id === mid); if (mm) { mm[slot].score = null; mm[slot].detail = null; mm[slot].scoredAt = null; } return d; }, "Score removed");
      st.data = r.data; st.view = "list"; st.msg = "Score removed.";
    } catch (e) { st.err = "Could not remove: " + e.message; }
    st.busy = false; render();
  }

  function showPic(id) {
    const m = SHEET.missions.find((x) => x.id === id); if (!m) return;
    const box = document.createElement("div");
    box.className = "sc-lightbox"; box.setAttribute("role", "dialog");
    box.innerHTML = `<div><img src="../img/missions/${id}.jpg" alt="${esc(m.name)} model"><p>${esc(m.name)} · tap anywhere to close</p></div>`;
    box.addEventListener("click", () => box.remove());
    document.body.appendChild(box);
  }

  function setVal(k, fn) { st.sheet.v = st.sheet.v || {}; fn(st.sheet.v); SC.clean(st.sheet); render(); }

  app.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.pic) { showPic(t.dataset.pic); return; }
    if (t.dataset.open) { const [mid, slot] = t.dataset.open.split(":"); openSheet(mid, slot); return; }
    if (t.dataset.table) { st.table = t.dataset.table; store.set("fll_sc_table", st.table); render(); return; }
    if (t.dataset.filter) { st.filter = t.dataset.filter; store.set("fll_sc_filter", st.filter); render(); return; }
    const a = t.dataset.act, k = t.dataset.k; if (!a) return;
    if (a === "back") { st.view = "list"; st.err = ""; render(); window.scrollTo(0, 0); }
    else if (a === "toggle") { if (k === "inspect") { st.sheet.inspect = !st.sheet.inspect; render(); } else setVal(k, (v) => { if (v[k]) delete v[k]; else v[k] = true; }); }
    else if (a === "inc") setVal(k, (v) => { v[k] = Number(v[k] || 0) + 1; });
    else if (a === "dec") setVal(k, (v) => { v[k] = Math.max(0, Number(v[k] || 0) - 1); });
    else if (a === "choice") setVal(k, (v) => { if (t.dataset.i === "") delete v[k]; else v[k] = Number(t.dataset.i); });
    else if (a === "tokens") { st.sheet.tokens = Number(t.dataset.n); render(); }
    else if (a === "manual") { st.manual = !st.manual; if (st.manual && !st.manualVal) st.manualVal = String(SC.compute(st.sheet)); render(); }
    else if (a === "reset") { if (confirm("Clear everything on this sheet?")) { st.sheet = SC.defaultSheet(); st.manual = false; st.manualVal = ""; st.note = ""; render(); } }
    else if (a === "clear") clearScore();
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "manualVal") { st.manualVal = e.target.value; updateBar(); }
    if (e.target.id === "note") st.note = e.target.value;
  });
  $("bar-save").addEventListener("click", save);

  // ---------- loading ----------
  async function refresh() {
    if (st.view !== "list" || st.busy) return;
    try { st.data = (await GH.load()).data; render(); } catch (e) { /* keep showing what we have */ }
  }

  async function start() {
    // The organizer's scorer link looks like  .../score/#key=TOKEN  : save the key, then tidy the address.
    const m = /[#&]key=([^&]+)/.exec(location.hash);
    if (m) { GH.setToken(decodeURIComponent(m[1])); history.replaceState(null, "", location.pathname + location.search); }
    if (!GH.getToken()) return renderConnect();
    st.view = "boot";
    try {
      st.data = (await GH.load()).data;
      st.view = "list"; render();
      clearInterval(st.timer); st.timer = setInterval(refresh, 20000);
    } catch (e) {
      GH.clearToken(); renderConnect(e.message);
    }
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  start();
})();
