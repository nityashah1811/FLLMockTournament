/* BIOGLOW (2026-27) Robot Game scoresheet + scoring engine.
 *
 * !! The point values below were copied from the unofficial Komurobo scoresheet
 * !! (https://komurobo.com/fll/2026-bioglow/) and add up to the 530-point maximum.
 * !! Have your head referee compare them with the official Robot Game Rulebook before the event.
 * !! To fix a value, change the number here; nothing else needs to change.
 *
 * Item types:
 *   check  - on / off                      (points)
 *   count  - a number from 0 up to `max`   (points each)
 *   choice - pick one option               (options: [{label, points}])
 * Optional: requires: "a"          -> only available when item "a" of the same mission is on
 *           requiresAny: ["a","b"] -> only available when at least one of these is on
 *           maxFrom: "a"           -> the most you can have is the count entered for item "a"
 */
(function () {
  "use strict";

  const SHEET = {
    season: "Bioglow (2026-27)",
    max: 530,
    inspection: { label: "All equipment fits in one launch area", points: 20 },
    tokens: { label: "Precision tokens left at the end", start: 6, points: { 0: 0, 1: 10, 2: 15, 3: 25, 4: 35, 5: 50, 6: 50 } },
    missions: [
      { id: "m01", name: "M01 Drone Survey", noTouch: true, items: [
        { id: "a", type: "check", label: "Drone is no longer touching the mat", points: 20 },
        { id: "b", type: "check", label: "Lidar map flipped over, marker in the survey area", points: 10, requires: "a" } ] },
      { id: "m02", name: "M02 Exploding Seeds", items: [
        { id: "a", type: "count", label: "Seeds no longer touching the stalk", points: 10, max: 3 } ] },
      { id: "m03", name: "M03 Flip the Rock", items: [
        { id: "a", type: "check", label: "Research flag is down", points: 20 },
        { id: "b", type: "check", label: "Rock is back in its starting position", points: 10, requires: "a" } ] },
      { id: "m04", name: "M04 Lucky Leaves", noTouch: true,
        note: "If the katydid ends completely outside the leaf habitat, this mission scores 0.", items: [
        { id: "a", type: "check", label: "One leaf completely removed from the nest", points: 10 },
        { id: "b", type: "check", label: "Second leaf removed, katydid in its original place", points: 20, requires: "a" } ] },
      { id: "m05", name: "M05 Reaching Roots", noTouch: true, items: [
        { id: "a", type: "choice", label: "Plant root is…", options: [{ label: "Partly extended", points: 10 }, { label: "Completely extended", points: 20 }] } ] },
      { id: "m06", name: "M06 Leafcutter Frenzy", items: [
        { id: "a", type: "count", label: "Leaf fragments inside the nest (ant touching the nest)", points: 10, max: 4 } ] },
      { id: "m07", name: "M07 Humongous Fungus", noTouch: true, items: [
        { id: "a", type: "check", label: "Mycelium completely extended", points: 20 },
        { id: "b", type: "count", label: "Connections to the other team's plant root", points: 10, max: 2, requires: "a" } ] },
      { id: "m08", name: "M08 Tangled", items: [
        { id: "a", type: "check", label: "Vine is touching the mat", points: 30 } ] },
      { id: "m09", name: "M09 Research Platform", noTouch: true, items: [
        { id: "a", type: "check", label: "Research platform raised", points: 10 },
        { id: "b", type: "check", label: "Camera trap deployed", points: 10 },
        { id: "c", type: "check", label: "Seed no longer touching the tree", points: 10 } ] },
      { id: "m10", name: "M10 Fragile Microhabitats", noTouch: true, items: [
        { id: "a", type: "check", label: "Spider habitat in its starting position", points: 10 },
        { id: "b", type: "check", label: "Snail habitat in its starting position", points: 10 } ] },
      { id: "m11", name: "M11 Window to the Past", items: [
        { id: "a", type: "check", label: "Root cover is down, touching the mat", points: 20 } ] },
      { id: "m12", name: "M12 Forest Elder", noTouch: true, items: [
        { id: "a", type: "check", label: "Cane completely raised, touching the tree", points: 20 },
        { id: "b", type: "check", label: "Support tie is around the post", points: 10 } ] },
      { id: "m13", name: "M13 Keystone Species", items: [
        { id: "a", type: "check", label: "Keystone species on the restoration platform and young trees raised", points: 30 } ] },
      { id: "m14", name: "M14 Seeds of Renewal", items: [
        { id: "a", type: "count", label: "Seeds inside the replantation station", points: 5, max: 4 },
        { id: "b", type: "count", label: "Of those seeds, touching the mat", points: 5, max: 4, maxFrom: "a" } ] },
      { id: "m15", name: "M15 Biocentric Architecture", noTouch: true, items: [
        { id: "a", type: "check", label: "Nesting canopy raised", points: 10 },
        { id: "b", type: "check", label: "Garden skylight completely in", points: 10 },
        { id: "c", type: "check", label: "Compost hatch completely open, touching the mat", points: 10 },
        { id: "d", type: "check", label: "Environmental bonus (the need for this dock is done)", points: 10, requiresAny: ["a", "b", "c"] } ] },
    ],
  };

  const key = (m, i) => m.id + "." + i.id;
  const num = (x) => { const n = Math.floor(Number(x)); return isNaN(n) ? 0 : n; };

  function defaultSheet() { return { inspect: false, tokens: SHEET.tokens.start, v: {} }; }

  // Is this item allowed to score right now?
  function available(sheet, m, item) {
    const v = sheet.v || {};
    if (item.requires && !v[m.id + "." + item.requires]) return false;
    if (item.requiresAny && !item.requiresAny.some((id) => v[m.id + "." + id])) return false;
    return true;
  }
  function countMax(sheet, m, item) {
    let max = item.max;
    if (item.maxFrom) max = Math.min(max, Math.max(0, num((sheet.v || {})[m.id + "." + item.maxFrom])));
    return max;
  }

  // Remove anything that is no longer allowed (e.g. a bonus whose main item was switched off).
  function clean(sheet) {
    sheet.v = sheet.v || {};
    for (let pass = 0; pass < 3; pass++) {
      SHEET.missions.forEach((m) => m.items.forEach((i) => {
        const k = key(m, i);
        if (!available(sheet, m, i)) { delete sheet.v[k]; return; }
        if (i.type === "count" && sheet.v[k] !== undefined) {
          const n = Math.max(0, Math.min(countMax(sheet, m, i), num(sheet.v[k])));
          if (n === 0) delete sheet.v[k]; else sheet.v[k] = n;
        }
      }));
    }
    sheet.tokens = Math.max(0, Math.min(6, num(sheet.tokens === undefined ? SHEET.tokens.start : sheet.tokens)));
    return sheet;
  }

  function itemPoints(sheet, m, i) {
    const val = (sheet.v || {})[key(m, i)];
    if (!available(sheet, m, i)) return 0;
    if (i.type === "check") return val ? i.points : 0;
    if (i.type === "count") return Math.max(0, Math.min(countMax(sheet, m, i), num(val))) * i.points;
    if (i.type === "choice") return val === undefined || val === null || !i.options[val] ? 0 : i.options[val].points;
    return 0;
  }

  function missionPoints(sheet, m) { return m.items.reduce((s, i) => s + itemPoints(sheet, m, i), 0); }

  function compute(sheet) {
    let total = sheet.inspect ? SHEET.inspection.points : 0;
    SHEET.missions.forEach((m) => { total += missionPoints(sheet, m); });
    total += SHEET.tokens.points[Math.max(0, Math.min(6, num(sheet.tokens)))] || 0;
    return Math.min(SHEET.max, total);
  }

  window.FLLScore = { SHEET, defaultSheet, clean, compute, itemPoints, missionPoints, available, countMax, key };
})();
