/* AI coaching feedback using Google's Gemini API.
 *
 * The Gemini key is typed into the Admin page once and stays in THIS browser only (localStorage).
 * It is never written to the website or to GitHub.
 *
 * Later, when teams use this on their own, the key should live on a small server instead.
 * Only generate() below needs to change for that (point it at your server instead of Google).
 */
(function () {
  "use strict";
  const KEY_STORE = "fll_gemini_key", MODEL_STORE = "fll_gemini_model", CHOICE_STORE = "fll_gemini_model_choice";
  const BASE = "https://generativelanguage.googleapis.com/v1beta";

  const getKey = () => FLL.store.get(KEY_STORE) || "";
  const setKey = (k) => FLL.store.set(KEY_STORE, k.trim());
  const clearKey = () => { FLL.store.del(KEY_STORE); FLL.store.del(MODEL_STORE); FLL.store.del(CHOICE_STORE); };
  // The model the organizer picked by hand ("" = automatic).
  const getChoice = () => FLL.store.get(CHOICE_STORE) || "";
  const setChoice = (name) => { if (name) FLL.store.set(CHOICE_STORE, name); else FLL.store.del(CHOICE_STORE); };

  async function api(path, key, body) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);
    try {
      const res = await fetch(BASE + path, {
        method: body ? "POST" : "GET", signal: ctl.signal,
        headers: Object.assign({ "x-goog-api-key": key }, body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (j.error && j.error.message) || "";
        const e = new Error(friendly(res.status, msg)); e.status = res.status; throw e;
      }
      return j;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Gemini took too long to answer. Try again.");
      if (e.status) throw e;
      throw new Error("Couldn't reach Gemini. Check your internet connection.");
    } finally { clearTimeout(timer); }
  }

  function friendly(status, msg) {
    if (status === 400 && /api key/i.test(msg)) return "Gemini says this API key isn't valid. Check that you copied the whole key.";
    if (status === 403) return "Gemini refused this key (" + (msg || "permission denied") + "). Check that the key is for the Gemini API and not restricted to other websites.";
    if (status === 429) return "Gemini says too many requests were sent. Wait a minute and try again (the free plan has a small limit).";
    if (status === 404) return "Gemini couldn't find the model. Try again; the page will pick another one.";
    return "Gemini error " + status + (msg ? ": " + msg : "");
  }

  // Pick a current "Flash" model for this key (fast and cheap). Falls back to Google's moving alias.
  async function pickModel(key, force) {
    const saved = FLL.store.get(MODEL_STORE);
    if (saved && !force) return saved;
    let name = "gemini-flash-latest";
    try {
      const j = await api("/models?pageSize=200", key);
      const usable = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
      if (usable.includes("gemini-flash-latest")) name = "gemini-flash-latest";
      else {
        const stable = usable.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
        name = stable[0] || usable.find((n) => /flash/.test(n) && !/lite|image|tts|live|audio/.test(n)) || usable[0] || name;
      }
    } catch (e) { if (e.status === 400 || e.status === 403) throw e; /* otherwise use the alias */ }
    FLL.store.set(MODEL_STORE, name);
    return name;
  }

  // Every model this key can use for writing text, newest first.
  async function listModels() {
    const key = getKey();
    if (!key) throw new Error("Add your Gemini API key first.");
    const j = await api("/models?pageSize=200", key);
    const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini/.test(n) && !/embedding|tts|image|live|audio|robotics|computer-use/.test(n));
    return names.sort((a, b) => (parseFloat((b.match(/gemini-([\d.]+)/) || [0, 0])[1]) - parseFloat((a.match(/gemini-([\d.]+)/) || [0, 0])[1])) || a.localeCompare(b));
  }

  // The one place that talks to the AI. `schema` (optional) asks for structured JSON. Returns { text, model }.
  async function generate(system, user, opts) {
    opts = opts || {};
    const key = getKey();
    if (!key) throw new Error("Add your Gemini API key first.");
    const body = (withSchema) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: Object.assign({ temperature: opts.temperature === undefined ? 0.5 : opts.temperature, maxOutputTokens: 4096 },
        opts.schema && withSchema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
    });
    const run = async (model) => {
      try { return await api(`/models/${model}:generateContent`, key, body(true)); }
      catch (e) {   // a few models don't accept a response schema: ask again in plain JSON mode
        if (opts.schema && e.status === 400 && /schema|json mode|response_mime/i.test(e.message)) return api(`/models/${model}:generateContent`, key, body(false));
        throw e;
      }
    };
    const chosen = getChoice();
    let model = chosen || await pickModel(key), j;
    try { j = await run(model); }
    catch (e) {
      if (e.status !== 404) throw e;
      if (chosen) throw new Error(`Gemini can't use the model "${chosen}" with this key. Choose another model (Reports tab → Change model).`);
      model = await pickModel(key, true); j = await run(model);
    }
    const c = (j.candidates || [])[0];
    const text = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || "").join("").trim() : "";
    if (!text) throw new Error(j.promptFeedback && j.promptFeedback.blockReason ? "Gemini blocked this request (" + j.promptFeedback.blockReason + ")." : "Gemini sent back an empty answer. Try again.");
    return { text, model };
  }

  // ---------- the coaching request ----------
  const S = { type: "STRING" };
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      headline: S, summary: S,
      strengths: { type: "ARRAY", items: { type: "OBJECT", properties: { title: S, evidence: S }, required: ["title", "evidence"] } },
      opportunities: { type: "ARRAY", items: { type: "OBJECT", properties: { id: S, what_happened: S, practice_idea: S, why_it_matters: S }, required: ["id", "what_happened", "practice_idea", "why_it_matters"] } },
      quick_wins: { type: "ARRAY", items: S },
      plan: { type: "ARRAY", items: { type: "OBJECT", properties: { action: S, why: S }, required: ["action", "why"] } },
      coach_note: S,
    },
    required: ["headline", "summary", "strengths", "opportunities", "quick_wins", "plan", "coach_note"],
  };

  const EXAMPLE = {
    headline: "A big jump in match 3, and the missing points are now concentrated in two missions.",
    summary: "Team Example went from 95 to 140 points over the three matches and finished 18 points above the average best score. The jump came from Missions the team had never scored in match 1. Most of the points still available are in M06 and M07, which scored 0 in all three matches.",
    strengths: [
      { title: "Rock-solid on M11 Window to the Past", evidence: "20 out of 20 points in all three matches, so this run is ready to leave alone." },
      { title: "Learned fast between matches", evidence: "M08 Tangled went from 0 to 30 and M09 Research Platform from 0 to 20 by match 3." },
    ],
    opportunities: [
      { id: "m06", what_happened: "Leafcutter Frenzy scored 0, 0 and 20 out of a possible 40: only one fragment ended up in the nest, and only in the last match.",
        practice_idea: "Run only this mission 10 times in a row and write down how many fragments end inside the nest each time. Adjust the starting position and slow the final approach until you reach at least 3 of 4 fragments on 8 out of 10 runs.",
        why_it_matters: "It is worth up to 40 points, and about 6 in 10 runs in this tournament scored here, so it is reachable." },
    ],
    quick_wins: ["Pass the equipment inspection in every match: it was missed once and is worth 20 points before the robot even moves."],
    plan: [
      { action: "Spend the next practice on M06 only, with a counted success rate.", why: "It has the most points available and other teams already score it." },
      { action: "Add a checklist step for the inspection and the tokens before every match.", why: "That is up to 45 points per match that needs no new robot code." },
    ],
    coach_note: "At the next practice, record a success count for each mission over 10 attempts; the missions that fail 3 or more times are the ones to redesign.",
  };

  const SYSTEM = `You are an experienced, warm FIRST LEGO League Challenge robot-game coach. You write feedback for one team after a practice (mock) tournament. The readers are kids and teenagers and their coach, so use clear, simple language and no jargon.

HOW TO WRITE
- The program has already worked out the analysis. Your job is to EXPLAIN it clearly and turn it into practical coaching. Do not recalculate; copy numbers exactly as given.
- Every statement must be backed by a number from the data (a score, a points-per-match list, a gap). If the data does not say it, do not say it. Never invent scores, missions, rules, or what the robot or team did.
- Be specific, not generic. "M06 scored 0, 0, 20 of 40" is good. "Practice more" is not.
- Be encouraging and honest. Celebrate real progress with its numbers, and be straightforward about what is costing points.
- Matches marked "manual score" have no mission detail: never guess what happened in them. If only one match has a breakdown, say trends need more matches.
- "opportunities": write exactly one entry for each item in prioritiesInOrder, in the same order, and copy its "id". "what_happened" describes the numbers for that mission (use itemsNeverEarned / someItems). "practice_idea" must be one concrete drill the team can do at their next practice. "why_it_matters" explains the points available and mentions how many other runs scored it (fieldPercent) when that helps.
- Good practice drills come from these robot-game principles: run one mission on its own many times and count successes (for example 10 tries); check the robot's starting position and alignment every time; check that attachments and mission models do not move or break between runs; slow down the final approach when a mission model is delicate; keep each mission short and plan the order of missions inside the 2 minutes 30 seconds; write down the cause of each failure and fix one thing at a time. Use only the principles that fit the data; do not claim to know the team's robot.
- "quick_wins" come from the quickWins list and easyPointsPerMatch (exact points). "plan" has 3 steps in the order to work on them, each with a short reason. "coach_note" is one sentence for the coach about what to measure next.
- If the match scores went up, say so first; if they went down, say what changed using whyBestMatchWasBest and gotWorseAfterEarlierMatch.
- Mention the team's standing only through the numbers in "standing" and the rank, never name other teams.

Here is an example of the quality and tone wanted. It uses INVENTED numbers for a different team: never reuse its numbers or mission details.
${JSON.stringify(EXAMPLE)}

Reply with JSON only, in the same shape as the example.`;

  function parseJson(text) {
    const t = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(t); } catch (e) { /* try to cut out the object */ }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("bad json");
  }

  async function coach(facts) {
    const user = "Here is the analysis for the team (JSON). Write the feedback.\n\n" + JSON.stringify(FLLAnalysis.forAI(facts), null, 1);
    let r = await generate(SYSTEM, user, { schema: SCHEMA, temperature: 0.4 }), data;
    try { data = parseJson(r.text); }
    catch (e) {   // one retry: smaller models sometimes break the format
      r = await generate(SYSTEM, user + "\n\nReply with valid JSON only, no other text.", { schema: SCHEMA, temperature: 0.2 });
      try { data = parseJson(r.text); } catch (e2) { throw new Error("Gemini's answer wasn't in the expected format. Try again, or choose a different model."); }
    }
    return { data, model: r.model };
  }

  window.FLLAI = { getKey, setKey, clearKey, getChoice, setChoice, listModels, generate, coach, pickModel, SYSTEM };
})();
