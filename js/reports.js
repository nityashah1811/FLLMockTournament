/* Draws a team report (facts from analysis.js + saved AI feedback from ai.js). */
(function () {
  "use strict";
  const { esc, fmtTime } = FLL;
  const SHEET = FLLScore.SHEET;
  const CACHE = "fll_ai_report_";

  const getCache = (id) => { try { return JSON.parse(FLL.store.get(CACHE + id)); } catch (e) { return null; } };
  const setCache = (id, v) => FLL.store.set(CACHE + id, JSON.stringify(v));

  // Very small, safe Markdown: ## headings, - bullets, **bold**.
  function mdToHtml(md) {
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$|[.,;:!?])/g, "$1<i>$2</i>");
    let html = "", list = false;
    esc(md).split("\n").forEach((l) => {
      const h = /^#{1,4}\s+(.*)$/.exec(l), li = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(l);
      if (li) { if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(li[1]) + "</li>"; return; }
      if (list) { html += "</ul>"; list = false; }
      if (h) html += "<h4>" + inline(h[1]) + "</h4>";
      else if (l.trim()) html += "<p>" + inline(l) + "</p>";
    });
    return html + (list ? "</ul>" : "");
  }

  const TREND = { improved: ["Improving", "good"], steady: ["Steady", ""], dropped: ["Dropped", "bad"], unknown: ["Not enough matches yet", ""] };

  function cell(v, max) {
    if (v === null) return '<td class="g-na">–</td>';
    return `<td class="${v === max ? "g-full" : v > 0 ? "g-part" : "g-zero"}">${v}</td>`;
  }

  function factsHtml(f) {
    if (!f.scoredCount) return `<p class="muted">No scores have been entered for this team yet.</p>`;
    const t = TREND[f.trend];
    const stats = `<div class="rep-stats">
      <div><b>${f.best}</b><span>best score</span></div>
      <div><b>${f.average}</b><span>average</span></div>
      <div><b>${f.rank ? (f.tied ? "T" : "") + "#" + f.rank : "–"}</b><span>rank of ${f.teamsRanked}</span></div>
      <div class="${t[1]}"><b>${f.trend === "unknown" ? "–" : (f.trendChange > 0 ? "+" : "") + f.trendChange}</b><span>${t[0]}</span></div></div>`;
    const runs = `<div class="rep-runs">${f.runs.map((r, i) => `<span><b>Match ${i + 1}: ${r.score === null ? "not scored" : r.score}</b> <span class="muted">${fmtTime(r.time)} · ${r.table}${r.mode === "manual" ? " · by hand" : ""}</span></span>`).join("")}</div>`;
    let notes = "";
    if (f.manualCount) notes += `<p class="muted small">${f.manualCount} match${f.manualCount > 1 ? "es were" : " was"} scored by hand, so ${f.manualCount > 1 ? "they have" : "it has"} no mission breakdown.</p>`;
    if (!f.sheetCount) return stats + runs + notes + `<p class="muted">The mission breakdown needs matches scored with the mission sheet.</p>`;

    const head = `<tr><th>Mission</th>${f.runs.map((r, i) => `<th title="${fmtTime(r.time)}">M${i + 1}</th>`).join("")}<th>Max</th><th title="Share of all runs in the tournament that scored anything here">Field</th></tr>`;
    const rows = f.missions.filter((m) => m.status !== "nodata").map((m) =>
      `<tr><td class="g-name">${esc(m.name)}</td>${m.pts.map((v) => cell(v, m.max)).join("")}<td class="g-max">${m.max}</td><td class="g-max">${m.fieldRate === null ? "–" : Math.round(m.fieldRate * 100) + "%"}</td></tr>`).join("");
    const grid = `<h4>Mission by mission</h4><div class="panel"><table class="rep-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">Green = full points, yellow = some points, red = none. “Field” is how often all teams scored in that mission.</p>`;

    const opp = f.leftOnTable.length ? `<h4>Biggest opportunities</h4><ol class="rep-list">${f.leftOnTable.slice(0, 4).map((m) =>
      `<li><b>${esc(m.name)}</b> <span class="pill-pts">${m.lost} points left</span>${m.neverItems.length ? `<br><span class="muted small">Never scored: ${m.neverItems.map((i) => esc(i.label)).join(", ")}</span>` : ""}</li>`).join("")}</ol>` : "";
    const wins = f.quickWins.length ? `<h4>Quick wins</h4><ul class="rep-list">${f.quickWins.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
    let field = "";
    if (f.commonMisses.length || f.standouts.length) {
      field = `<h4>Compared with the other teams</h4><ul class="rep-list">${f.commonMisses.map((m) => `<li>Most teams score <b>${esc(m.name)}</b> (${m.fieldPercent}% of runs) but this team hasn't yet.</li>`).join("")}${f.standouts.map((m) => `<li>This team scores <b>${esc(m.name)}</b> every time; only ${m.fieldPercent}% of runs in the tournament do.</li>`).join("")}</ul>`;
    }
    return stats + runs + notes + grid + opp + wins + field;
  }

  // The AI part. `opts.busy` / `opts.err` come from the admin page.
  function aiHtml(f, opts) {
    opts = opts || {};
    const c = getCache(f.team.id);
    const fresh = c && c.hash === FLLAnalysis.hash(f);
    let h = `<h4>Coach's feedback <span class="ai-tag">AI</span></h4>`;
    if (opts.busy) return h + `<p class="muted">Writing feedback…</p>`;
    if (opts.err) h += `<div class="notice error">${esc(opts.err)}</div>`;
    if (c) h += `${fresh ? "" : '<div class="notice warn small">Scores have changed since this was written. Write it again to update.</div>'}<div class="ai-text">${mdToHtml(c.text)}</div>
      <p class="muted small">Written by Gemini (${esc(c.model)}) from the facts above. Check it makes sense before sharing.</p>`;
    else if (opts.print) return "";
    else if (!opts.err) h += `<p class="muted">${f.scoredCount ? "Not written yet." : "Enter scores first."}</p>`;
    return h;
  }

  function reportHtml(f, opts) {
    return `<article class="report"><header><h3>${esc(f.team.name)}</h3><span class="muted small">${esc(SHEET.season)} · FLL Mock Tournament</span></header>${factsHtml(f)}${aiHtml(f, opts)}</article>`;
  }

  window.FLLReports = { reportHtml, aiHtml, factsHtml, mdToHtml, getCache, setCache };
})();
