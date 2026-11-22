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

  // The "what the numbers show" section: pure algorithm, no AI.
  function insightsHtml(f) {
    const li = [];
    const b = f.bestVsWorst;
    if (b) {
      const g = b.gains.map((x) => `${esc(x.name)} +${x.delta}`).join(", "), d = b.drops.map((x) => `${esc(x.name)} ${x.delta}`).join(", ");
      let t = `<b>Match ${b.bestMatch} was the best (${b.bestScore}) and match ${b.worstMatch} the lowest (${b.worstScore}).</b>`;
      if (g) t += ` The difference came from: ${g}.`;
      if (d) t += ` It did worse in: ${d}.`;
      if (b.inspectionDiff) t += ` Equipment inspection was ${b.inspectionDiff > 0 ? "passed" : "missed"} in the best match.`;
      li.push(t);
    }
    if (f.regressions.length) li.push(`<b>Points that slipped away:</b> ${f.regressions.map((r) => `${esc(r.name)} went from ${r.from} to ${r.to}`).join("; ")}. Something changed in the last match, or this mission is not reliable yet.`);
    if (f.gap && f.gap.behindNext !== null) li.push(`<b>Standing:</b> ${f.gap.behindNext} point${f.gap.behindNext === 1 ? "" : "s"} behind the next team up${f.gap.aheadOfNext !== null ? `, ${f.gap.aheadOfNext} ahead of the next one down` : ""}; ${f.gap.vsFieldAverageBest >= 0 ? f.gap.vsFieldAverageBest + " above" : -f.gap.vsFieldAverageBest + " below"} the average best score.`);
    else if (f.gap && f.gap.aheadOfNext !== null) li.push(`<b>Standing:</b> top of the leaderboard, ${f.gap.aheadOfNext} points clear of the next team.`);
    if (f.quickWinPotential && f.quickWinPotential.total) li.push(`<b>Easy points:</b> fixing the equipment inspection and precision tokens is worth up to ${f.quickWinPotential.total} points in a match, with no new robot code.`);
    return li.length ? `<h4>What the numbers show</h4><ul class="rep-list">${li.map((x) => `<li>${x}</li>`).join("")}</ul>` : "";
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

    const opp = f.priorities.length ? `<h4>What to fix first</h4><ol class="rep-list">${f.priorities.slice(0, 4).map((m) =>
      `<li><b>${esc(m.name)}</b> <span class="pill-pts">${m.lost} points left</span>${m.neverItems.length ? `<br><span class="muted small">Never scored: ${m.neverItems.map((i) => esc(i.label)).join(", ")}</span>` : ""}${m.fieldPercent !== null ? `<br><span class="muted small">${m.fieldPercent}% of runs in the tournament scored here.</span>` : ""}</li>`).join("")}</ol>
      <p class="muted small">Ranked by points available and how often other teams manage the mission.</p>` : "";
    const wins = f.quickWins.length ? `<h4>Quick wins</h4><ul class="rep-list">${f.quickWins.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
    let field = "";
    if (f.commonMisses.length || f.standouts.length) {
      field = `<h4>Compared with the other teams</h4><ul class="rep-list">${f.commonMisses.map((m) => `<li>Most teams score <b>${esc(m.name)}</b> (${m.fieldPercent}% of runs) but this team hasn't yet.</li>`).join("")}${f.standouts.map((m) => `<li>This team scores <b>${esc(m.name)}</b> every time; only ${m.fieldPercent}% of runs in the tournament do.</li>`).join("")}</ul>`;
    }
    return stats + runs + notes + insightsHtml(f) + grid + opp + wins + field;
  }

  // Structured feedback from the AI. Mission names and point numbers come from the program, not the AI.
  function aiBody(d, f) {
    const L = (a) => (Array.isArray(a) ? a : []);
    let h = `<p class="ai-headline">${esc(d.headline)}</p><p>${esc(d.summary)}</p>`;
    if (L(d.strengths).length) h += `<h5>What went well</h5><ul>${L(d.strengths).map((x) => `<li><b>${esc(x.title)}.</b> ${esc(x.evidence)}</li>`).join("")}</ul>`;
    const opps = L(d.opportunities).map((o) => {
      const p = f.priorities.find((x) => x.id === String(o.id).trim().toLowerCase());
      return p ? `<div class="ai-opp"><b>${esc(p.name)}</b> <span class="pill-pts">${p.lost} points left</span><p>${esc(o.what_happened)}</p><p><b>Try this:</b> ${esc(o.practice_idea)}</p><p class="muted small">${esc(o.why_it_matters)}</p></div>` : "";
    }).join("");
    if (opps) h += `<h5>Biggest opportunities</h5>${opps}`;
    if (L(d.quick_wins).length) h += `<h5>Quick wins</h5><ul>${L(d.quick_wins).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    if (L(d.plan).length) h += `<h5>Plan for the next tournament</h5><ol>${L(d.plan).map((x) => `<li><b>${esc(x.action)}</b> <span class="muted">${esc(x.why)}</span></li>`).join("")}</ol>`;
    if (d.coach_note) h += `<p class="coach-note"><b>For the coach:</b> ${esc(d.coach_note)}</p>`;
    return h;
  }

  // The AI part. `opts.busy` / `opts.err` come from the admin page.
  function aiHtml(f, opts) {
    opts = opts || {};
    const c = getCache(f.team.id);
    const fresh = c && c.hash === FLLAnalysis.hash(f);
    let h = `<h4>Coach's feedback <span class="ai-tag">AI</span></h4>`;
    if (opts.busy) return h + `<p class="muted">Writing feedback…</p>`;
    if (opts.err) h += `<div class="notice error">${esc(opts.err)}</div>`;
    if (c) h += `${fresh ? "" : '<div class="notice warn small">Scores have changed since this was written. Write it again to update.</div>'}<div class="ai-text">${c.data ? aiBody(c.data, f) : mdToHtml(c.text || "")}</div>
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
