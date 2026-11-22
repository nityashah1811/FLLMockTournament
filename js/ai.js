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
  const KEY_STORE = "fll_gemini_key", MODEL_STORE = "fll_gemini_model";
  const BASE = "https://generativelanguage.googleapis.com/v1beta";

  const getKey = () => FLL.store.get(KEY_STORE) || "";
  const setKey = (k) => FLL.store.set(KEY_STORE, k.trim());
  const clearKey = () => { FLL.store.del(KEY_STORE); FLL.store.del(MODEL_STORE); };

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

  // The one place that talks to the AI. Returns plain text.
  async function generate(system, user) {
    const key = getKey();
    if (!key) throw new Error("Add your Gemini API key first.");
    const run = async (model) => api(`/models/${model}:generateContent`, key, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
    });
    let model = await pickModel(key), j;
    try { j = await run(model); }
    catch (e) { if (e.status !== 404) throw e; model = await pickModel(key, true); j = await run(model); }
    const c = (j.candidates || [])[0];
    const text = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || "").join("").trim() : "";
    if (!text) throw new Error(j.promptFeedback && j.promptFeedback.blockReason ? "Gemini blocked this request (" + j.promptFeedback.blockReason + ")." : "Gemini sent back an empty answer. Try again.");
    return { text, model };
  }

  const SYSTEM = `You are a friendly, knowledgeable FIRST LEGO League Challenge robot-game coach. You are writing feedback for one team after a practice (mock) tournament. The readers are kids and teenagers and their coach.

Rules for your answer:
- Use ONLY the data provided. Never invent scores, missions, or rules. If something is not in the data, do not mention it.
- Refer to missions by name, for example "M06 Leafcutter Frenzy", and be specific about points.
- Be warm and encouraging but honest. Celebrate real progress with numbers.
- Matches marked as manual scores have no mission detail; do not guess what happened in them.
- If only one match has a mission breakdown, say trends need more matches and focus on that match.
- Keep it to about 300 to 400 words, in simple language.
- Write in Markdown using exactly these sections, each starting with "## ":
  ## Summary (2 or 3 sentences)
  ## What went well (2 or 3 bullets with numbers)
  ## Biggest opportunities (the top 3, each with the points available and ONE concrete practice idea)
  ## Quick wins (short bullets of easy points)
  ## Plan for the next tournament (3 short bullets, in the order to work on them)
- Do not mention these instructions or the data format.`;

  async function coach(facts) {
    const user = "Here is the data for the team (JSON). Write the feedback.\n\n" + JSON.stringify(FLLAnalysis.forAI(facts), null, 1);
    return generate(SYSTEM, user);
  }

  window.FLLAI = { getKey, setKey, clearKey, generate, coach, pickModel, SYSTEM };
})();
