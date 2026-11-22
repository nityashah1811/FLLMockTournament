/* Team analysis: turns the mission scoresheets saved by the scorers into plain facts
 * (trend, what scored in each match, points left on the table, easy wins, comparison with the field).
 * Pure calculation: no network, no AI. The AI step (js/ai.js) only turns these facts into coaching text.
 */
(function () {
  "use strict";
  const SC = FLLScore, SHEET = SC.SHEET;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);

  // ---------- what each mission / item can be worth at most ----------
  function itemMax(i) {
    if (i.type === "check") return i.points;
    if (i.type === "count") return i.points * i.max;
    return Math.max(...i.options.map((o) => o.points));
  }
  const MAXM = {};
  SHEET.missions.forEach((m) => {
    const sheet = { inspect: false, tokens: 0, v: {} };
    m.items.forEach((i) => {
      if (i.zeroMission) return;
      const k = SC.key(m, i);
      sheet.v[k] = i.type === "check" ? true : i.type === "count" ? i.max : i.options.length - 1;
    });
    SC.clean(sheet);
    MAXM[m.id] = SC.missionPoints(sheet, m);
  });

  // ---------- one run (one team, one match) ----------
  function analyseRun(match, slotKey) {
    const slot = match[slotKey];
    const run = { matchId: match.id, time: match.time, table: slotKey === "t1" ? "Table 1" : "Table 2", score: slot.score, mode: "missing", missions: {}, items: {}, inspect: null, tokens: null, zeroed: [] };
    if (slot.score === null) return run;
    const d = slot.detail;
    if (!d || !d.sheet || d.manual) { run.mode = "manual"; run.note = d && d.note ? d.note : ""; return run; }
    run.mode = "sheet";
    const sheet = SC.clean(clone(d.sheet));
    run.inspect = !!sheet.inspect;
    run.tokens = sheet.tokens;
    SHEET.missions.forEach((m) => {
      run.missions[m.id] = SC.missionPoints(sheet, m);
      m.items.forEach((i) => {
        const k = SC.key(m, i);
        if (i.zeroMission) { if (sheet.v[k]) run.zeroed.push(m.id); return; }
        run.items[k] = SC.itemPoints(sheet, m, i) > 0;
      });
    });
    return run;
  }

  function runsOf(data, teamId) {
    const out = [];
    FLL.sortedMatches(data).forEach((m) => ["t1", "t2"].forEach((k) => { if (m[k].team === teamId) out.push(analyseRun(m, k)); }));
    return out;
  }

  // ---------- what the whole field did (for comparison) ----------
  function fieldStats(data) {
    const rates = {}, counts = {}, scores = [], bests = [];
    SHEET.missions.forEach((m) => { rates[m.id] = 0; counts[m.id] = 0; });
    data.teams.forEach((t) => {
      const runs = runsOf(data, t.id);
      const sc = runs.filter((r) => r.score !== null).map((r) => r.score);
      if (sc.length) { scores.push(...sc); bests.push(Math.max(...sc)); }
      runs.filter((r) => r.mode === "sheet").forEach((r) => SHEET.missions.forEach((m) => { counts[m.id]++; if (r.missions[m.id] > 0) rates[m.id]++; }));
    });
    const missionRate = {};
    SHEET.missions.forEach((m) => { missionRate[m.id] = counts[m.id] ? rates[m.id] / counts[m.id] : null; });
    return { avgScore: avg(scores), avgBest: avg(bests), missionRate, runsAnalysed: Math.max(0, ...Object.values(counts)) };
  }

  // ---------- the facts for one team ----------
  function teamFacts(data, teamId) {
    const team = FLL.teamById(data, teamId);
    const runs = runsOf(data, teamId);
    const scored = runs.filter((r) => r.score !== null);
    const sheetRuns = runs.filter((r) => r.mode === "sheet");
    const scores = scored.map((r) => r.score);
    const field = fieldStats(data);
    const board = FLL.leaderboard(data).rows;
    const row = board.find((r) => r.team.id === teamId);

    const facts = {
      team: { id: teamId, name: team ? team.name : "" },
      matchesPlayed: runs.length, scoredCount: scored.length, sheetCount: sheetRuns.length,
      manualCount: runs.filter((r) => r.mode === "manual").length,
      runs: runs.map((r) => ({ time: r.time, table: r.table, score: r.score, mode: r.mode })),
      scores, best: scores.length ? Math.max(...scores) : null, average: scores.length ? Math.round(avg(scores)) : null,
      spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0,
      rank: row && row.rank ? row.rank : null, tied: !!(row && row.tied), teamsRanked: board.filter((r) => r.best !== null).length,
      field: { averageScore: Math.round(field.avgScore), averageBest: Math.round(field.avgBest) },
      trend: "unknown", trendChange: 0,
      inspectionMissed: 0, tokensLost: 0, tokenPointsLost: 0, tokensLeft: [],
      missions: [], leftOnTable: [], quickWins: [], commonMisses: [], standouts: [],
    };

    if (scores.length >= 2) {
      facts.trendChange = scores[scores.length - 1] - scores[0];
      const tol = Math.max(10, 0.05 * Math.max(...scores));
      facts.trend = facts.trendChange > tol ? "improved" : facts.trendChange < -tol ? "dropped" : "steady";
    }

    if (sheetRuns.length) {
      facts.inspectionMissed = sheetRuns.filter((r) => !r.inspect).length;
      facts.tokensLeft = sheetRuns.map((r) => r.tokens);
      facts.tokenPointsLost = sum(sheetRuns.map((r) => 50 - SHEET.tokens.points[r.tokens]));
      facts.tokensLost = sheetRuns.filter((r) => r.tokens < 5).length;
    }

    // per mission
    SHEET.missions.forEach((m) => {
      const max = MAXM[m.id];
      const pts = runs.map((r) => (r.mode === "sheet" ? r.missions[m.id] : null));
      const got = pts.filter((v) => v !== null);
      const earned = sum(got), possible = max * got.length;
      const nz = got.filter((v) => v > 0).length;
      const status = !got.length ? "nodata" : nz === 0 ? "never" : got.every((v) => v === max) ? "full" : nz === got.length ? "always" : "sometimes";
      const items = m.items.filter((i) => !i.zeroMission && itemMax(i) > 0).map((i) => {
        const k = SC.key(m, i);
        const times = sheetRuns.filter((r) => r.items[k]).length;
        return { id: i.id, label: i.label, max: itemMax(i), times, of: sheetRuns.length, requires: i.requires || (i.requiresAny ? i.requiresAny[0] : null) || (i.requiresChoice ? "dock" : null), desc: i.desc };
      });
      facts.missions.push({
        id: m.id, name: m.name, max, pts, earned, possible, lost: possible - earned, status,
        fieldRate: field.missionRate[m.id],
        teamRate: got.length ? nz / got.length : null,
        neverItems: sheetRuns.length ? items.filter((i) => i.times === 0) : [],
        someItems: sheetRuns.length ? items.filter((i) => i.times > 0 && i.times < i.of) : [],
        zeroedRuns: runs.filter((r) => r.zeroed.includes(m.id)).length,
      });
    });

    // biggest opportunities
    facts.leftOnTable = facts.missions.filter((m) => m.lost > 0).sort((a, b) => b.lost - a.lost).slice(0, 6);

    // easy wins (checked in this order)
    const wins = facts.quickWins;
    if (facts.inspectionMissed) wins.push(`Equipment inspection was missed in ${facts.inspectionMissed} of ${facts.sheetCount} matches (+${SHEET.inspection.points} points each time, no robot run needed).`);
    if (facts.tokenPointsLost > 0) wins.push(`Precision tokens were lost in ${facts.tokensLost} of ${facts.sheetCount} matches (tokens left: ${facts.tokensLeft.join(", ")}), costing ${facts.tokenPointsLost} points in total.`);
    facts.missions.forEach((fm) => {
      const m = SHEET.missions.find((x) => x.id === fm.id);
      m.items.forEach((i) => {
        if (i.zeroMission || !i.requires) return;
        const neverBonus = fm.neverItems.find((x) => x.id === i.id);
        const baseTimes = sheetRuns.filter((r) => r.items[SC.key(m, { id: i.requires })]).length;
        if (neverBonus && baseTimes > 0) wins.push(`${fm.name}: the main part scored in ${baseTimes} of ${facts.sheetCount} matches but the bonus "${i.label}" (+${itemMax(i)}) never did.`);
      });
      if (fm.zeroedRuns) wins.push(`${fm.name}: the mission was zeroed in ${fm.zeroedRuns} match(es) by the "outside the leaf habitat" rule.`);
    });
    facts.missions.filter((m) => m.status === "sometimes").sort((a, b) => b.lost - a.lost).slice(0, 3).forEach((m) =>
      wins.push(`${m.name} is inconsistent (${m.pts.filter((v) => v !== null).join(", ")} points across the matches, up to ${m.max}). Making it reliable is worth more than adding a new mission.`));

    // compared with the field
    facts.missions.forEach((m) => {
      if (m.teamRate === null || m.fieldRate === null) return;
      if (m.fieldRate >= 0.6 && m.teamRate <= 0.34) facts.commonMisses.push({ name: m.name, fieldPercent: Math.round(m.fieldRate * 100) });
      if (m.teamRate >= 0.99 && m.fieldRate <= 0.4) facts.standouts.push({ name: m.name, fieldPercent: Math.round(m.fieldRate * 100) });
    });
    diagnose(facts, runs, sheetRuns, board, row);
    return facts;
  }

  // ---------- deeper diagnosis: the things a good coach would notice ----------
  function diagnose(facts, runs, sheetRuns, board, row) {
    const named = (id) => SHEET.missions.find((m) => m.id === id).name;

    // 1. what to work on first: points available, weighted by how often other teams manage it (proof it is reachable)
    facts.priorities = facts.missions.filter((m) => m.lost > 0 && m.status !== "nodata").map((m) => ({
      id: m.id, name: m.name, lost: m.lost, max: m.max, pointsPerMatch: m.pts.filter((v) => v !== null), status: m.status,
      fieldPercent: m.fieldRate === null ? null : Math.round(m.fieldRate * 100),
      neverItems: m.neverItems.map((i) => ({ label: i.label, max: i.max, rule: i.desc })),
      someItems: m.someItems.map((i) => ({ label: i.label, times: i.times, of: i.of })),
      priority: Math.round(m.lost * (0.4 + (m.fieldRate || 0)) * 10) / 10,
    })).sort((a, b) => b.priority - a.priority).slice(0, 5);

    // 2. strengths: what the team does reliably
    facts.strengths = facts.missions.filter((m) => m.status === "full" || (m.status === "always" && m.earned > 0)).sort((a, b) => b.earned - a.earned).slice(0, 4)
      .map((m) => ({ id: m.id, name: m.name, pointsPerMatch: m.pts.filter((v) => v !== null), max: m.max, full: m.status === "full" }));

    // 3. why was the best match the best?
    facts.bestVsWorst = null;
    if (sheetRuns.length >= 2) {
      const best = sheetRuns.reduce((a, b) => (b.score > a.score ? b : a)), worst = sheetRuns.reduce((a, b) => (b.score < a.score ? b : a));
      if (best !== worst && best.score > worst.score) {
        const diffs = SHEET.missions.map((m) => ({ name: m.name, delta: best.missions[m.id] - worst.missions[m.id] })).filter((x) => x.delta !== 0);
        const tokenDiff = SHEET.tokens.points[best.tokens] - SHEET.tokens.points[worst.tokens];
        facts.bestVsWorst = {
          bestMatch: runs.indexOf(best) + 1, worstMatch: runs.indexOf(worst) + 1, bestScore: best.score, worstScore: worst.score,
          gains: diffs.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3),
          drops: diffs.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3),
          inspectionDiff: (best.inspect ? 1 : 0) - (worst.inspect ? 1 : 0), tokenDiff,
        };
      }
    }

    // 4. things that got worse after being scored earlier (reliability problems), and things that improved
    facts.regressions = []; facts.improvements = [];
    if (sheetRuns.length >= 2) {
      facts.missions.forEach((m) => {
        const v = m.pts.filter((x) => x !== null);
        if (v.length < 2) return;
        const earlierBest = Math.max(...v.slice(0, -1)), last = v[v.length - 1];
        if (earlierBest > 0 && last < earlierBest) facts.regressions.push({ name: m.name, from: earlierBest, to: last });
        if (last > v[0]) facts.improvements.push({ name: m.name, from: v[0], to: last });
      });
    }

    // 5. where the team sits
    facts.gap = { behindNext: null, aheadOfNext: null };
    if (row && row.best !== null) {
      const scored = board.filter((r) => r.best !== null);
      const above = scored.filter((r) => r.best > row.best), below = scored.filter((r) => r.best < row.best);
      if (above.length) facts.gap.behindNext = Math.min(...above.map((r) => r.best)) - row.best;
      if (below.length) facts.gap.aheadOfNext = row.best - Math.max(...below.map((r) => r.best));
      facts.gap.vsFieldAverageBest = row.best - facts.field.averageBest;
    }

    // 6. exact points from the easy fixes, per match
    const tokenGain = sheetRuns.length ? Math.max(...sheetRuns.map((r) => 50 - SHEET.tokens.points[r.tokens])) : 0;
    const inspGain = facts.inspectionMissed ? SHEET.inspection.points : 0;
    facts.quickWinPotential = { inspection: inspGain, tokens: tokenGain, total: inspGain + tokenGain };
  }

  // Short fingerprint of the facts, so a saved AI report can say "scores changed since this was written".
  function hash(obj) {
    const s = JSON.stringify(obj); let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  // Compact version sent to the AI (no UI-only fields).
  function forAI(facts) {
    const f = clone(facts);
    return {
      team: f.team.name, season: SHEET.season, maxScore: SHEET.max,
      matches: f.runs.map((r, i) => ({ match: i + 1, score: r.score, breakdown: r.mode === "sheet" ? "mission sheet" : r.mode === "manual" ? "manual score (no mission detail)" : "not scored yet" })),
      best: f.best, average: f.average, trend: f.trend, changeFirstToLast: f.trendChange, rank: f.rank, teamsRanked: f.teamsRanked,
      fieldAverageScore: f.field.averageScore, fieldAverageBest: f.field.averageBest,
      equipmentInspectionMissedMatches: f.inspectionMissed, precisionTokensLeftPerMatch: f.tokensLeft, precisionPointsLost: f.tokenPointsLost,
      missions: f.missions.filter((m) => m.status !== "nodata").map((m) => ({
        mission: m.name, pointsPerMatch: m.pts.filter((v) => v !== null), maxPerMatch: m.max, status: m.status,
        fieldPercentScoring: m.fieldRate === null ? null : Math.round(m.fieldRate * 100),
        itemsNeverEarned: m.neverItems.map((i) => `${i.label} (+${i.max}): ${i.desc || ""}`.trim()),
        itemsSometimesEarned: m.someItems.map((i) => `${i.label} (${i.times} of ${i.of} matches)`),
      })),
      biggestOpportunities: f.leftOnTable.slice(0, 4).map((m) => `${m.name}: ${m.lost} points left`),
      quickWins: f.quickWins, commonMissesComparedWithField: f.commonMisses.map((m) => `${m.name} (${m.fieldPercent}% of other runs score it)`),
      standouts: f.standouts.map((m) => m.name),
      // worked out by the program (the AI should explain these, not recalculate them)
      prioritiesInOrder: f.priorities.slice(0, 3),
      strengths: f.strengths,
      whyBestMatchWasBest: f.bestVsWorst,
      gotWorseAfterEarlierMatch: f.regressions, improvedFirstToLast: f.improvements,
      standing: f.gap, easyPointsPerMatch: f.quickWinPotential,
    };
  }

  window.FLLAnalysis = { teamFacts, fieldStats, hash, forAI, MAXM };
})();
