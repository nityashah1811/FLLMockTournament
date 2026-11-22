/* Shared helpers for the viewer site and the admin site. */
(function () {
  "use strict";

  const ROOT = new URL("../", document.currentScript.src).href; // site root, works for / and /admin/
  const CFG = Object.assign(
    {
      owner: "", repo: "", branch: "main", dataFile: "data.json",
      counterNamespace: "fll-mock-tournament",
      counterHost: "https://abacus.jasoncameron.dev",
    },
    window.FLL_CONFIG || {}
  );

  // ---------- small utilities ----------
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fmtTime(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return t;
    return (h % 12 === 0 ? 12 : h % 12) + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM");
  }

  function fmtStamp(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- loading the public data ----------
  async function loadPublicData() {
    // Shares a cache "bucket" for 15s so lots of viewers don't all bypass the CDN cache.
    const bucket = Math.floor(Date.now() / 15000);
    const res = await fetch(ROOT + CFG.dataFile + "?v=" + bucket, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load schedule (" + res.status + ")");
    return normalize(await res.json());
  }

  // Make sure old / hand-edited data never crashes the page.
  function normalize(d) {
    d = d || {};
    d.title = d.title || "FLL Mock Tournament";
    d.subtitle = d.subtitle || "";
    d.announcement = d.announcement || "";
    d.currentMatch = d.currentMatch || "";
    d.teams = Array.isArray(d.teams) ? d.teams : [];
    d.matches = Array.isArray(d.matches) ? d.matches : [];
    d.innovation = Array.isArray(d.innovation) ? d.innovation : [];
    d.matches.forEach((m) => {
      ["t1", "t2"].forEach((k) => {
        m[k] = m[k] || {};
        m[k].team = m[k].team || "";
        m[k].score = m[k].score === "" || m[k].score == null || isNaN(Number(m[k].score)) ? null : Number(m[k].score);
      });
    });
    return d;
  }

  // ---------- tournament logic ----------
  const teamById = (d, id) => d.teams.find((t) => t.id === id);
  const byTime = (a, b) => (a.time || "").localeCompare(b.time || "");
  const sortedMatches = (d) => d.matches.slice().sort(byTime);
  const sortedInnovation = (d) => d.innovation.slice().sort(byTime);

  function teamLabel(d, id) {
    const t = teamById(d, id);
    return t ? t.name + (t.number ? " #" + t.number : "") : "";
  }
  function teamHtml(d, id) {
    const t = teamById(d, id);
    if (!t) return "—";
    return esc(t.name) + (t.number ? " <small>#" + esc(t.number) + "</small>" : "");
  }

  const matchSlots = (m) => [m.t1, m.t2].filter((s) => s.team);
  const matchDone = (m) => {
    const s = matchSlots(m);
    return s.length > 0 && s.every((x) => x.score !== null);
  };

  // Returns { matchId: "done" | "now" | "next" | "later" }
  function matchStatuses(d) {
    const list = sortedMatches(d);
    const out = {};
    const curIdx = list.findIndex((m) => m.id === d.currentMatch);
    let nextId = null;
    for (let i = curIdx >= 0 ? curIdx + 1 : 0; i < list.length; i++) {
      if (!matchDone(list[i])) { nextId = list[i].id; break; }
    }
    list.forEach((m) => {
      out[m.id] = matchDone(m) ? "done" : m.id === d.currentMatch ? "now" : m.id === nextId ? "next" : "later";
    });
    return out;
  }

  // For each team: their runs in time order -> [{ matchId, table, time, score }]
  function runsByTeam(d) {
    const map = {};
    d.teams.forEach((t) => (map[t.id] = []));
    sortedMatches(d).forEach((m) => {
      [["t1", "Table 1"], ["t2", "Table 2"]].forEach(([k, label]) => {
        const s = m[k];
        if (s.team && map[s.team]) map[s.team].push({ matchId: m.id, table: label, time: m.time, score: s.score });
      });
    });
    return map;
  }

  // FLL ranks by best score; ties are broken by 2nd best, then 3rd best.
  function leaderboard(d) {
    const runs = runsByTeam(d);
    const rows = d.teams.map((t) => {
      const r = runs[t.id] || [];
      const scores = r.map((x) => x.score);
      const sorted = scores.filter((s) => s !== null).sort((a, b) => b - a);
      return { team: t, scores, sorted, best: sorted.length ? sorted[0] : null };
    });
    const cmp = (a, b) => {
      for (let i = 0; i < Math.max(a.sorted.length, b.sorted.length); i++) {
        const x = a.sorted[i] ?? -1, y = b.sorted[i] ?? -1;
        if (x !== y) return y - x;
      }
      return 0;
    };
    rows.sort((a, b) => {
      if ((a.best === null) !== (b.best === null)) return a.best === null ? 1 : -1;
      return cmp(a, b) || a.team.name.localeCompare(b.team.name);
    });
    rows.forEach((row, i) => {
      if (row.best === null) row.rank = null;
      else row.rank = i > 0 && rows[i - 1].best !== null && cmp(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
    });
    rows.forEach((row) => { row.tied = row.rank !== null && rows.filter((r) => r.rank === row.rank).length > 1; });
    const rounds = Math.max(3, ...rows.map((r) => r.scores.length));
    return { rows, rounds };
  }

  // ---------- view counter (free service, no sign-up) ----------
  // Counts a "view" once per browser session and a "visitor" once per browser.
  // Nothing is counted when you test on your own computer (localhost).
  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(location.hostname);

  async function counterCall(op, key) {
    const url = CFG.counterHost + "/" + op + "/" + encodeURIComponent(CFG.counterNamespace) + "/" + key;
    const res = await fetch(url, { cache: "no-store" });
    const j = await res.json();
    return typeof j.value === "number" ? j.value : 0; // "Key not found" => nobody has visited yet
  }

  // countIt=false => only read the numbers (used by the admin page).
  async function trackViews(countIt) {
    const result = { views: null, visitors: null };
    try {
      const doView = countIt && !isLocal && !store.get("fll_counted", true);
      const doVisitor = countIt && !isLocal && !store.get("fll_visitor");
      const [v, u] = await Promise.all([
        counterCall(doView ? "hit" : "get", "views"),
        counterCall(doVisitor ? "hit" : "get", "visitors"),
      ]);
      if (doView) store.set("fll_counted", "1", true);
      if (doVisitor) store.set("fll_visitor", "1");
      result.views = v;
      result.visitors = u;
    } catch (e) { /* counter is a nice-to-have; never break the page */ }
    return result;
  }

  window.FLL = {
    ROOT, CFG, esc, fmtTime, fmtStamp, store, uid, loadPublicData, normalize,
    teamById, teamLabel, teamHtml, sortedMatches, sortedInnovation, matchSlots, matchDone,
    matchStatuses, runsByTeam, leaderboard, trackViews, byTime,
  };
})();
