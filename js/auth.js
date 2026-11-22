/* Password screen for the Admin and Scorer pages.
 *
 * Saving scores needs a GitHub key. Instead of making everybody handle that key, the organizer does a
 * one-time setup: the key is encrypted with a password and stored in auth.json. Everyone else just
 * types the password; the page decrypts the key in the browser tab and uses it.
 *
 * NOTE: a short password only keeps casual visitors out. Anyone determined could still try passwords
 * against auth.json, so use a key that can only touch this one repository (see the setup steps).
 */
(function () {
  "use strict";
  const { esc, CFG } = FLL;
  const GH = FLLGH;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { let s = ""; new Uint8Array(buf).forEach((c) => (s += String.fromCharCode(c))); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(password, token) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 200000;
    const key = await deriveKey(password, salt, iter);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
    return { v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function open(password, vault) {
    const key = await deriveKey(password, unb64(vault.salt), vault.iter);
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(vault.iv) }, key, unb64(vault.data)));
  }

  const card = (inner) => `<div class="card stack" style="margin-top:16px">${inner}</div>`;
  const note = (n) => (n ? `<div class="notice error">${esc(n)}</div>` : "");

  // ---------- the password screen ----------
  function showPassword(el, onReady, vault, notice) {
    el.innerHTML = card(`
      <h2>Enter the password</h2>
      ${note(notice)}
      <form id="pwform" class="stack">
        <label class="field"><span>Password</span><input type="password" id="pw" autocomplete="off" autocapitalize="off" inputmode="text" autofocus></label>
        <button class="btn big" id="go" type="submit">Open</button>
      </form>
      <p class="small muted" style="margin:6px 0 0"><a href="#" id="redo">Organizer: set up or change the saved key</a></p>`);
    document.getElementById("redo").onclick = (e) => { e.preventDefault(); showSetup(el, onReady, ""); };
    document.getElementById("pwform").onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById("pw").value, btn = document.getElementById("go");
      if (!pw) return;
      btn.disabled = true; btn.textContent = "Checking…";
      let token;
      try { token = await open(pw, vault); }
      catch (err) { return showPassword(el, onReady, vault, "That password isn't right. Try again."); }
      GH.setToken(token);
      onReady();
    };
  }

  // ---------- one-time setup (organizer) ----------
  function showSetup(el, onReady, notice, prefill) {
    const legacy = GH.legacyToken();
    el.innerHTML = card(`
      <h2>One-time setup (organizer)</h2>
      <p>Choose the password that scorers and organizers will type (for example <b>20288</b>).${legacy ? " This device already has a working key, so you don't need to make a new one." : ""}</p>
      ${note(notice)}
      <form id="setupform" class="stack">
        <label class="field"><span>Password to use</span><input type="text" id="newpw" autocomplete="off" autocapitalize="off" placeholder="e.g. 20288" value="${esc(prefill || "")}"></label>
        ${legacy ? "" : `
        <details open class="small"><summary><b>Make the key (about 2 minutes)</b></summary>
          <ol class="steps">
            <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> and sign in as <b>${esc(CFG.owner)}</b>.</li>
            <li>Token name: <code>FLL</code>. Expiration: a date just after your tournament.</li>
            <li><b>Repository access</b>: choose <b>Only select repositories</b>, then pick <b>${esc(CFG.repo)}</b>. (The default, “Public repositories”, is read-only and will not work.)</li>
            <li>Scroll to <b>Permissions</b> and click <b>Add permissions</b>. Tick <b>Contents</b>. It appears in the list with “Access: Read-only”: change that to <b>Read and write</b>.</li>
            <li>Click <b>Generate token</b>, copy it, and paste it below.</li>
          </ol>
          <details class="small muted"><summary>Still stuck? Use a classic key instead</summary>
            <p>Open <a href="https://github.com/settings/tokens/new?scopes=public_repo&description=FLL" target="_blank" rel="noopener">this link</a> (the <b>public_repo</b> box is pre-ticked), set an expiration, press <b>Generate token</b> and paste it below. It works, but it is less restricted than the steps above (it can change any of your public repositories), so delete it on GitHub right after the tournament.</p>
          </details>
        </details>
        <label class="field"><span>The key you just made</span><input type="password" id="newkey" autocomplete="off" autocapitalize="off" placeholder="github_pat_…"></label>`}
        <button class="btn big" id="savesetup" type="submit">Save</button>
      </form>
      <p class="small muted" style="margin:0">The key is stored locked with your password. Nobody else ever sees or handles it.</p>`);
    document.getElementById("setupform").onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById("newpw").value.trim();
      const key = legacy || (document.getElementById("newkey") ? document.getElementById("newkey").value.trim() : "");
      if (!pw) return showSetup(el, onReady, "Type the password you want to use.");
      if (!key) return showSetup(el, onReady, "Paste the key you made in step 5.");
      const btn = document.getElementById("savesetup"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        await GH.load(key);                         // can this key read the repository?
        await GH.saveVault(key, await seal(pw, key)); // can it write? (this also stores the locked key)
      } catch (err) {
        const denied = /isn't allowed|isn't valid/.test(err.message);
        if (legacy && denied) {   // the old key saved on this device cannot write: drop it and ask for a new one
          GH.clearLegacy();
          return showSetup(el, onReady, "The key that was saved on this device can't save changes, so it can't be used. Make a new key with the steps below (about 2 minutes).", pw);
        }
        const m = denied
          ? "That key can read the repository but isn't allowed to save. Make a new key and in step 4 set Contents to “Read and write” (and choose only the " + CFG.repo + " repository). GitHub said: " + err.message.replace(/^.*?GitHub says:\s*/, "")
          : err.message;
        return showSetup(el, onReady, m, pw);
      }
      GH.clearLegacy();
      GH.setToken(key);
      el.innerHTML = card(`<h2>All set</h2><p>The password <b>${esc(pw)}</b> now unlocks the Admin and Scorer pages. Other devices can use it in about a minute.</p><button class="btn big" id="cont">Continue</button>`);
      document.getElementById("cont").onclick = onReady;
    };
  }

  // Show the password screen (or first-time setup). Calls onReady() once a working key is loaded.
  async function gate(el, onReady, notice) {
    if (GH.getToken()) return onReady();
    el.innerHTML = '<p class="empty">Loading…</p>';
    let vault;
    try { vault = await GH.fetchVault(); }
    catch (e) { el.innerHTML = card(`<h2>Can't check the password</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button>`); return; }
    if (vault === null) return showSetup(el, onReady, notice || "");
    showPassword(el, onReady, vault, notice || "");
  }

  async function changePassword(newPassword) {
    const token = GH.getToken();
    if (!token) throw new Error("Not signed in.");
    await GH.saveVault(token, await seal(newPassword, token));
  }

  window.FLLAuth = { gate, changePassword };
})();
