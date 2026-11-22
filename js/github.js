/* Shared GitHub storage helpers (used by the admin page and the scorer page).
 *
 * The tournament data lives in data.json in the GitHub repo. Several people can save at the same time
 * (two scorers, plus the organizer), so every save works like this:
 *   1. read the newest data.json from GitHub
 *   2. apply ONLY this person's change on top of it
 *   3. save; if someone else saved a moment earlier, go back to step 1
 * That way nobody's scores are ever overwritten by somebody else's older copy.
 */
(function () {
  "use strict";
  const CFG = FLL.CFG;
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.dataFile}`;
  const TOKEN_KEY = "fll_admin_token";

  const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64dec = (b64) => decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const getToken = () => FLL.store.get(TOKEN_KEY) || "";
  const setToken = (t) => FLL.store.set(TOKEN_KEY, t);
  const clearToken = () => FLL.store.del(TOKEN_KEY);
  const headers = (token) => ({ Authorization: "Bearer " + (token || getToken()), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

  function apiError(res, body) {
    const why = body && body.message ? ` (GitHub says: “${body.message}”)` : "";
    if (/rate limit/i.test((body && body.message) || "")) return "GitHub is limiting requests right now. Wait a minute, then try again.";
    if (res.status === 401) return "GitHub says the key isn't valid or has expired. Ask the organizer for a new one." + why;
    if (res.status === 403 || res.status === 404)
      return `GitHub wouldn't let this key save ${CFG.dataFile} in ${CFG.owner}/${CFG.repo} (branch “${CFG.branch}”)${why}. ` +
        `The key needs permission to write to this repository. Ask the organizer for a new key.`;
    return "GitHub error " + res.status + why;
  }

  async function load(token) {
    const res = await fetch(`${API}?ref=${encodeURIComponent(CFG.branch)}&_=${Date.now()}`, { headers: headers(token), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiError(res, body));
    return { data: FLL.normalize(JSON.parse(b64dec(body.content))), sha: body.sha };
  }

  async function put(data, sha, message) {
    data.updatedAt = new Date().toISOString();
    const res = await fetch(API, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({ message, content: b64enc(JSON.stringify(data, null, 2) + "\n"), sha, branch: CFG.branch }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 || (res.status === 422 && /sha/i.test(body.message || ""))) {
      const err = new Error("conflict");
      err.conflict = true;
      throw err;
    }
    if (!res.ok) throw new Error(apiError(res, body));
    return { sha: body.content.sha, stamp: data.updatedAt };
  }

  // Read newest -> let `mutator` change it -> save. Retries if somebody else saved at the same moment.
  async function update(mutator, message) {
    for (let i = 0; i < 8; i++) {
      const { data, sha } = await load();
      const out = mutator(data) || data;
      try {
        const r = await put(out, sha, message);
        return { data: out, sha: r.sha, stamp: r.stamp };
      } catch (e) {
        if (!e.conflict) throw e;
        await sleep(150 + Math.random() * 450);
      }
    }
    throw new Error("Lots of people are saving at once. Wait a few seconds and press Save again.");
  }

  // ---------- 3-way merge: keep other people's changes AND mine ----------
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const isIdList = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => isObj(x) && x.id !== undefined);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // base = what I loaded, local = what I have now, remote = newest on GitHub.
  function merge3(base, local, remote) {
    if (isIdList(local) || isIdList(remote) || isIdList(base)) {
      const arr = (x) => (Array.isArray(x) ? x : []);
      const byId = (x) => Object.fromEntries(arr(x).map((i) => [i.id, i]));
      const B = byId(base), L = byId(local), R = byId(remote);
      const order = [];
      arr(local).forEach((i) => order.push(i.id));
      arr(remote).forEach((i) => { if (!order.includes(i.id)) order.push(i.id); });
      const out = [];
      order.forEach((id) => {
        const b = B[id], l = L[id], r = R[id];
        if (l === undefined) { if (r !== undefined && !(b !== undefined && same(b, r))) out.push(r); return; } // I deleted it
        if (r === undefined) { if (b === undefined || !same(b, l)) out.push(l); return; }                      // someone else deleted it, or I added it
        out.push(merge3(b, l, r));
      });
      return out;
    }
    if (isObj(local) && isObj(remote)) {
      const b = isObj(base) ? base : {};
      const out = {};
      new Set([...Object.keys(local), ...Object.keys(remote)]).forEach((k) => {
        const v = merge3(b[k], local[k], remote[k]);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    return same(local, base) ? remote : local; // I changed it -> mine wins; otherwise take the newest
  }

  // Save my version on top of whatever is newest on GitHub.
  async function pushMerged(base, local, message) {
    for (let i = 0; i < 8; i++) {
      const { data: remote, sha } = await load();
      const merged = merge3(base, local, remote);
      try {
        const r = await put(merged, sha, message);
        return { data: merged, sha: r.sha, stamp: r.stamp };
      } catch (e) {
        if (!e.conflict) throw e;
        await sleep(150 + Math.random() * 450);
      }
    }
    throw new Error("Lots of people are saving at once. Wait a few seconds and try again.");
  }

  window.FLLGH = { getToken, setToken, clearToken, load, update, pushMerged, merge3, clone, apiError };
})();
