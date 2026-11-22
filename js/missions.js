/* BIOGLOW (2026-27) Robot Game scoresheet + scoring engine.
 *
 * Points and wording come from the official FIRST Robot Game Rulebook:
 * https://firstinspires.blob.core.windows.net/fll/challenge/2026-27/fll-challenge-bioglow-rgr.pdf
 * (the maximum is 530 points). If FIRST issues a Challenge Update, change the numbers here;
 * nothing else needs to change.
 *
 * Item types:
 *   check  - on / off                      (points)
 *   count  - a number from 0 up to `max`   (points each)
 *   choice - pick one option               (options: [{label, points}])
 * Optional on an item:
 *   desc: "..."                      -> small text: what is needed to earn the points
 *   requires: "a"                    -> only available when item "a" of the same mission is on
 *   requiresAny: ["a","b"]           -> only available when at least one of these is on
 *   requiresChoice: {item, map}      -> only available when the chosen option's item is on
 *   maxFrom: "a"                     -> the most you can have is the count entered for item "a"
 *   zeroMission: true                -> if on, the whole mission scores 0
 */
(function () {
  "use strict";

  const SHEET = {
    season: "Bioglow (2026-27)",
    max: 530,
    inspection: {
      label: "Equipment inspection", points: 20,
      desc: "Before the match: your robot and ALL your equipment fit completely in one launch area and under the 12 in (305 mm) height limit.",
    },
    tokens: {
      label: "Precision tokens left at the end", start: 6,
      points: { 0: 0, 1: 10, 2: 15, 3: 25, 4: 35, 5: 50, 6: 50 },
      desc: "You start with six. The referee removes one each time the robot is interrupted outside of home. Points for the number left: 1 = 10, 2 = 15, 3 = 25, 4 = 35, 5 or 6 = 50.",
    },
    missions: [
      { id: "m01", name: "M01 Drone Survey", noTouch: true, items: [
        { id: "a", type: "check", label: "Drone launched", points: 20, desc: "The drone is no longer touching the mat." },
        { id: "b", type: "check", label: "LiDAR map flipped (bonus)", points: 10, requires: "a", desc: "Bonus: the LiDAR map is completely flipped over, with the scan marker at least partly in the survey area." } ] },
      { id: "m02", name: "M02 Exploding Seeds", items: [
        { id: "a", type: "count", label: "Seeds released", points: 10, max: 3, desc: "10 for each seed that is no longer touching the stalk." } ] },
      { id: "m03", name: "M03 Flip the Rock", items: [
        { id: "a", type: "check", label: "Research flag down", points: 20, desc: "The research flag is down." },
        { id: "b", type: "check", label: "Rock back in place (bonus)", points: 10, requires: "a", desc: "Bonus: the rock has been returned to its original starting position." } ] },
      { id: "m04", name: "M04 Lucky Leaves", noTouch: true, items: [
        { id: "a", type: "check", label: "One leaf removed", points: 10, desc: "One leaf is completely removed, no longer touching the nest." },
        { id: "b", type: "check", label: "Second leaf removed (bonus)", points: 20, requires: "a", desc: "Bonus: the second leaf is also completely removed AND the katydid is in its original starting position. If the katydid was completely removed from the nest at any time, there is no bonus." },
        { id: "z", type: "check", label: "Katydid ended outside the leaf habitat", points: 0, zeroMission: true, desc: "If the katydid is outside the leaf habitat at the end of the match, even partly, this whole mission scores 0. The habitat is the nest plus the marked area on the mat around it." } ] },
      { id: "m05", name: "M05 Reaching Roots", noTouch: true, items: [
        { id: "a", type: "choice", label: "Plant root", desc: "Only one can score: partially extended = 10, or completely extended = 20.",
          options: [{ label: "Partly extended", points: 10 }, { label: "Completely extended", points: 20 }] } ] },
      { id: "m06", name: "M06 Leafcutter Frenzy", items: [
        { id: "a", type: "count", label: "Leaf fragments in the nest", points: 10, max: 4, desc: "10 for each leaf fragment contained within the nest while the ant is touching the nest." } ] },
      { id: "m07", name: "M07 Humongous Fungus", noTouch: true, items: [
        { id: "a", type: "check", label: "Mycelium extended", points: 20, desc: "The mycelium is completely extended." },
        { id: "b", type: "count", label: "Connections (bonus)", points: 10, max: 2, requires: "a", desc: "Bonus, 10 each (up to two): your fully extended mycelium connects with the opposing team's fully extended plant root. They do not need to touch. Not possible if there is no opposing team." } ] },
      { id: "m08", name: "M08 Tangled", items: [
        { id: "a", type: "check", label: "Vine on the mat", points: 30, desc: "The vine is touching the mat." } ] },
      { id: "m09", name: "M09 Research Platform", noTouch: true, items: [
        { id: "a", type: "check", label: "Platform raised", points: 10, desc: "The research platform is raised." },
        { id: "b", type: "check", label: "Camera trap deployed", points: 10, desc: "The camera trap is deployed." },
        { id: "c", type: "check", label: "Seed released", points: 10, desc: "The seed is no longer touching the tree." } ] },
      { id: "m10", name: "M10 Fragile Microhabitats", noTouch: true, items: [
        { id: "a", type: "check", label: "Spider habitat untouched", points: 10, desc: "The spider habitat is in its original starting position." },
        { id: "b", type: "check", label: "Snail habitat untouched", points: 10, desc: "The snail habitat is in its original starting position." } ] },
      { id: "m11", name: "M11 Window to the Past", items: [
        { id: "a", type: "check", label: "Root cover down", points: 20, desc: "The root cover is down, touching the mat." } ] },
      { id: "m12", name: "M12 Forest Elder", noTouch: true, items: [
        { id: "a", type: "check", label: "Cane raised", points: 20, desc: "The cane is completely raised, touching the tree." },
        { id: "b", type: "check", label: "Support tie on", points: 10, desc: "The support tie is around the post." } ] },
      { id: "m13", name: "M13 Keystone Species", items: [
        { id: "a", type: "check", label: "Species delivered, trees raised", points: 30, desc: "Your team's keystone species is on the restoration platform AND the young trees are raised." } ] },
      { id: "m14", name: "M14 Seeds of Renewal", items: [
        { id: "a", type: "count", label: "Seeds in the station", points: 5, max: 4, desc: "5 for each seed contained within the replantation station." },
        { id: "b", type: "count", label: "Seeds also touching the mat (bonus)", points: 5, max: 4, maxFrom: "a", desc: "Bonus, 5 more for each of those seeds that is also touching the mat." } ] },
      { id: "m15", name: "M15 Biocentric Architecture", noTouch: true, items: [
        { id: "a", type: "check", label: "Nesting canopy raised", points: 10, desc: "The nesting canopy is raised." },
        { id: "b", type: "check", label: "Garden skylight in", points: 10, desc: "The garden skylight is completely in." },
        { id: "c", type: "check", label: "Compost hatch open", points: 10, desc: "The compost hatch is completely open, touching the mat." },
        { id: "dock", type: "choice", label: "Which dock is the model on?", desc: "Needed for the environmental bonus below.",
          options: [{ label: "Mine", points: 0 }, { label: "City", points: 0 }, { label: "Farm", points: 0 }] },
        { id: "d", type: "check", label: "Environmental bonus", points: 10, requiresChoice: { item: "dock", map: ["a", "b", "c"] },
          desc: "Bonus: the greatest ecological need for the model's dock is done. Mine dock = nesting canopy raised. City dock = garden skylight in. Farm dock = compost hatch open. Only one bonus is possible." } ] },
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
    if (item.requiresChoice) {
      const dv = v[m.id + "." + item.requiresChoice.item];
      if (dv === undefined || dv === null) return false;
      if (!v[m.id + "." + item.requiresChoice.map[dv]]) return false;
    }
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

  function missionPoints(sheet, m) {
    if (m.items.some((i) => i.zeroMission && (sheet.v || {})[key(m, i)])) return 0;
    return m.items.reduce((s, i) => s + itemPoints(sheet, m, i), 0);
  }

  function compute(sheet) {
    let total = sheet.inspect ? SHEET.inspection.points : 0;
    SHEET.missions.forEach((m) => { total += missionPoints(sheet, m); });
    total += SHEET.tokens.points[Math.max(0, Math.min(6, num(sheet.tokens)))] || 0;
    return Math.min(SHEET.max, total);
  }

  window.FLLScore = { SHEET, defaultSheet, clean, compute, itemPoints, missionPoints, available, countMax, key };
})();
