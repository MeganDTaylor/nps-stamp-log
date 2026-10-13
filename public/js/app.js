import { RAW_UNITS } from "./units.js";
import { createStore } from "./store.js";
import { US_STATES } from "./us-states.js";
import { fetchParks, buildList, fetchParkLive, NATIONAL_CAPITAL } from "./nps.js";

/* ---------- reference data ---------- */
const TYPES = {
  NP: { label: "National Park", group: "parks" }, NM: { label: "National Monument", group: "monuments" },
  NHP: { label: "Historical Park", group: "history" }, NHS: { label: "Historic Site", group: "history" },
  MEM: { label: "Memorial", group: "memorials" }, BAT: { label: "Battlefield", group: "battle" },
  REC: { label: "Recreation / Seashore / Lakeshore", group: "rec" }, PRES: { label: "Preserve / Reserve", group: "rec" },
  RIV: { label: "River", group: "rivers" }, TRL: { label: "Trail", group: "rivers" }, PKWY: { label: "Parkway", group: "rivers" },
  OTH: { label: "Park", group: "other" },
};
const GROUPS = [["parks", "National Parks"], ["monuments", "Monuments"], ["memorials", "Memorials"], ["history", "Historic sites"],
  ["battle", "Battlefields"], ["rec", "Seashores, lakes & preserves"], ["rivers", "Rivers, trails & parkways"], ["other", "Other parks"]];
const REGIONS = [
  ["NA", "North Atlantic", "ME NH VT MA RI CT NY NJ"], ["MA", "Mid-Atlantic", "PA DE MD VA WV"], ["NC", "National Capital", "DC"],
  ["SE", "Southeast", "KY TN NC SC GA FL AL MS PR VI"], ["MW", "Midwest", "OH IN IL MI WI MN IA MO NE KS"],
  ["SW", "Southwest", "TX OK NM AZ AR LA"], ["RM", "Rocky Mountain", "CO MT ND SD UT WY"], ["W", "Western", "CA NV HI GU AS MP"], ["PNW", "Pacific NW & Alaska", "AK ID OR WA"],
];
const REGION_OF = {};
REGIONS.forEach(([k, , s]) => s.split(" ").forEach((st) => (REGION_OF[st] = k)));
const STATE_NAMES = { AK: "Alaska", AL: "Alabama", AR: "Arkansas", AS: "American Samoa", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia", GU: "Guam", HI: "Hawaiʻi", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri", MP: "Northern Mariana Islands", MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VI: "U.S. Virgin Islands", VT: "Vermont", WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming" };
// Region colors live in css/app.css as --r-NA, --r-MA, ... so they can be matched to the passport book in one place.
const regionColor = (k) => (k ? `var(--r-${k})` : "var(--ink)");
const regionName = (k) => (REGIONS.find((r) => r[0] === k) || [])[1] || "";
const RATINGS = ["Quick stop", "Good", "Great", "Unforgettable"];
const ME = "__me";

// Regions are worked out here rather than trusted from the saved list, so a fix to NATIONAL_CAPITAL applies
// to an already-refreshed list too.
const toUnits = (rows) => rows.map(([code, name, type, st, lat, lon]) =>
  ({ key: code, code, name, type: TYPES[type] ? type : "OTH", st, lat: +lat, lon: +lon, region: NATIONAL_CAPITAL.has(code) ? "NC" : REGION_OF[st] }));
// The built-in list, replaced by your own copy once you refresh it from the NPS (see "Update park list").
let NPS_UNITS = toUnits(RAW_UNITS);

/* ---------- state ---------- */
const S = {
  store: null, user: null, unsubs: [],
  visits: [], stamps: [],
  list: null, npsKey: "", // list: {refreshedAt, count} when using a list refreshed from the NPS
  info: null, infoState: "idle", // park details and stamp locations, from data/park-info.json
  live: {}, // per park code: {state, info, alerts, at} fetched from the NPS with your key
  f: { q: "", state: "", status: "all", types: new Set(), region: "", near: null, radius: 250 },
  view: "list", here: null, open: null, editing: null, fresh: null,
};

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "value") e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(k)); }
  return e;
};
const pref = { get(k) { try { return localStorage.getItem("stamptrail-pref:" + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem("stamptrail-pref:" + k, v); } catch {} } };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return new Date(+y, +m - 1, +dd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
function miles(a, b) {
  const R = 3958.8, t = Math.PI / 180, dl = (b.lat - a.lat) * t, dn = (b.lon - a.lon) * t;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hasCoords = (u) => u && typeof u.lat === "number" && !isNaN(u.lat) && typeof u.lon === "number";

function allUnits() { return NPS_UNITS; }
const unitByKey = (k) => allUnits().find((u) => u.key === k);
const visitsFor = (key) => S.visits.filter((v) => v.unit === key).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
// One stamp per site, stored at stamps/{unit key} with the date it was collected.
const stampFor = (key) => S.stamps.find((s) => s.id === key);
const has = (u) => !!stampFor(u.key);
const firstDate = (key) => stampFor(key)?.date || "";
async function giveStamp(key, date = todayISO()) {
  if (stampFor(key)) return;
  S.fresh = key;
  await S.store.set("stamps", key, { date });
}
function nearPoint() {
  if (S.f.near === ME) return S.here ? { ...S.here, name: "you" } : null;
  const u = S.f.near ? unitByKey(S.f.near) : null;
  return hasCoords(u) ? u : null;
}
function showNotice(t) { const n = $("#notice"); n.textContent = t || ""; n.hidden = !t; }
function saveFailed(e, box) {
  console.error(e);
  const msg = e?.code === "permission-denied" ? "Your account isn't allowed to save here. Sign out and back in, then try again."
    : e?.message?.includes("private") ? e.message : "Couldn't save. Check your connection and try again.";
  if (box) box.textContent = msg; else showNotice(msg);
}

/* ---------- stamp graphics ---------- */
const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
// Dated like a real cancellation stamp: "Dec 31 2024".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stampDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${MONTHS[+m - 1]} ${+dd} ${y}`; };
function markSVG(u, stamped) {
  const svg = svgEl("svg", { viewBox: "0 0 50 50", class: "mark" + (S.fresh === u.key ? " fresh" : ""), role: "img", "aria-label": stamped ? "Stamped" : "Not yet" });
  const rot = ((u.key.charCodeAt(0) * 7 + u.key.charCodeAt(u.key.length - 1) * 3) % 21) - 10;
  const g = svgEl("g", { transform: `rotate(${stamped ? rot : 0} 25 25)` });
  const ink = regionColor(u.region);
  const ring = (r, dash) => svgEl("circle", { cx: 25, cy: 25, r, fill: "none", stroke: stamped ? ink : "var(--line)", "stroke-width": dash ? 1.5 : 2, ...(dash ? { "stroke-dasharray": "3 3" } : {}) });
  if (stamped) {
    const t = svgEl("text", { x: 25, y: 23, "text-anchor": "middle", "font-size": 9, fill: ink }); t.textContent = u.code || "★";
    // Squeezed to fit the inner ring, the way the date band on a real stamp is narrow.
    const d = svgEl("text", { x: 25, y: 33, "text-anchor": "middle", "font-size": 6, textLength: 29, lengthAdjust: "spacingAndGlyphs", fill: ink }); d.textContent = stampDate(firstDate(u.key));
    g.append(ring(22), ring(17, true), t, d);
  } else g.append(ring(21, true));
  svg.append(g);
  return svg;
}
function drawBigStamp(have, total) {
  const pct = total ? Math.round((have / total) * 100) : 0;
  $("#bigStamp").innerHTML = `<g transform="rotate(-8 75 75)" fill="none" stroke="var(--ink)">
    <circle cx="75" cy="75" r="68" stroke-width="3"/><circle cx="75" cy="75" r="60" stroke-width="1.2" stroke-dasharray="4 3"/>
    <circle cx="75" cy="75" r="40" stroke-width="1.2"/><path id="arc" d="M 23 75 A 52 52 0 0 1 127 75" stroke="none"/>
    <text font-family="var(--mono)" font-size="11" fill="var(--ink)" stroke="none" letter-spacing="2"><textPath href="#arc" startOffset="50%" text-anchor="middle">PARKS STAMPED</textPath></text>
    <text x="75" y="80" text-anchor="middle" font-family="var(--display)" font-weight="800" font-size="34" fill="var(--ink)" stroke="none">${have}</text>
    <text x="75" y="98" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--ink)" stroke="none">OF ${total} · ${pct}%</text></g>`;
}

/* ---------- filtering ---------- */
function filtered() {
  const f = S.f, q = f.q.toLowerCase(), near = nearPoint();
  let list = allUnits().filter((u) => {
    if (q && !(u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q) || (STATE_NAMES[u.st] || "").toLowerCase().includes(q) || u.st.toLowerCase() === q)) return false;
    if (f.state && u.st !== f.state) return false;
    if (f.region && u.region !== f.region) return false;
    if (f.types.size && !f.types.has(TYPES[u.type].group)) return false;
    const h = has(u);
    if (f.status === "have" && !h) return false;
    if (f.status === "need" && h) return false;
    return true;
  });
  if (near) list = list.filter(hasCoords).map((u) => ({ ...u, d: miles(near, u) })).filter((u) => u.d <= f.radius).sort((a, b) => a.d - b.d);
  return { list, near };
}

/* ---------- render ---------- */
function render() {
  const haveN = NPS_UNITS.filter(has).length;
  drawBigStamp(haveN, NPS_UNITS.length);
  $("#summary").replaceChildren(...REGIONS.map(([k, name]) => {
    const us = NPS_UNITS.filter((u) => u.region === k), h = us.filter(has).length;
    return el("button", { class: "region", style: `--rc:${regionColor(k)}`, "aria-pressed": S.f.region === k ? "true" : "false", onclick: () => { S.f.region = S.f.region === k ? "" : k; render(); } },
      el("span", { class: "name" }, name), el("span", { class: "num" }, `${h} / ${us.length}`),
      el("span", { class: "bar" }, el("i", { style: `width:${us.length ? (h / us.length) * 100 : 0}%` })));
  }));
  const { list, near } = filtered();
  $("#count").textContent = `${list.length} site${list.length === 1 ? "" : "s"}`;
  renderActiveFilters();
  $("#mapWrap").hidden = S.view !== "map";
  $("#list").hidden = S.view !== "list";
  if (S.view === "map") renderMap(list);
  else renderList(list, near);
  S.fresh = null;
}

function unitRow(u, near) {
  const h = has(u);
  // Tapping an empty circle stamps the site right from the list; everything else opens the park.
  const mark = el("button", { class: "mark-btn", type: "button", "aria-label": h ? `Stamped ${fmtDate(firstDate(u.key))}` : `Mark ${u.name} as stamped`,
    title: h ? "Stamped" : "Tap to mark as stamped",
    onclick: (e) => { e.stopPropagation(); if (h) openSheet(u.key); else giveStamp(u.key).catch(saveFailed); } }, markSVG(u, h));
  return el("li", { class: "unit", style: `--rc:${regionColor(u.region)}`, tabindex: "0", role: "button", "aria-label": u.name, onclick: () => openSheet(u.key),
    onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(u.key); } } },
    mark,
    el("div", { style: "min-width:0" }, el("div", { class: "nm" }, u.name),
      el("div", { class: "meta" },
        el("span", { class: "tag" + (u.type === "NP" ? " np" : "") }, TYPES[u.type].label),
        u.region ? el("span", { class: "rdot", style: `--rc:${regionColor(u.region)}` }, regionName(u.region)) : null,
        u.code ? el("span", {}, u.code) : null)),
    near ? el("span", { class: "dist" }, u.d < 1 ? "here" : Math.round(u.d) + " mi") : el("span"));
}
function renderList(list, near) {
  const box = $("#list");
  if (!list.length) {
    box.replaceChildren(el("p", { class: "empty-list" }, S.f.status === "have" && !S.stamps.length
      ? "No stamps yet. Switch to All and tap the empty circle next to any park you have." : "Nothing matches these filters."));
    return;
  }
  if (near) {
    box.replaceChildren(el("div", { class: "group-h" }, el("h2", {}, S.f.near === ME ? "Near you" : "Near " + near.name)), el("ul", { class: "units" }, list.map((u) => unitRow(u, true))));
    return;
  }
  const by = {};
  list.forEach((u) => (by[u.st] ||= []).push(u));
  const keys = Object.keys(by).sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b));
  box.replaceChildren(...keys.flatMap((st) => {
    const us = by[st].sort((a, b) => a.name.localeCompare(b.name)), h = us.filter(has).length;
    const rk = REGION_OF[st] || us[0].region;
    return [el("div", { class: "group-h", style: `--rc:${regionColor(rk)}` }, el("h2", {}, STATE_NAMES[st] || st || "Other"), el("span", {}, `${h}/${us.length}`),
        rk ? el("span", { class: "rdot" }, regionName(rk)) : null),
      el("ul", { class: "units" }, us.map((u) => unitRow(u, false)))];
  }));
}

/* ---------- map ---------- */
let map = null, stateLayer = null, markerLayer = null, meMarker = null, lastFitKey = "";
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function stateStyle(f) {
  const c = cssVar(`--r-${REGION_OF[f.properties.st]}`) || cssVar("--muted");
  const on = !S.f.region || REGION_OF[f.properties.st] === S.f.region;
  return { color: c, weight: 1, opacity: 0.7, fillColor: c, fillOpacity: on ? 0.14 : 0.04 };
}
function renderMap(list) {
  if (!window.L) { $("#map").textContent = "The map couldn't load. Check your connection and reload."; return; }
  if (!map) {
    map = L.map("map", { preferCanvas: true, worldCopyJump: true }).setView([39.5, -98.5], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // State outlines tinted by passport region. They also stand in for the map tiles if those can't load.
    stateLayer = L.geoJSON(US_STATES, { interactive: false, style: stateStyle }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  stateLayer.setStyle(stateStyle);
  setTimeout(() => map.invalidateSize(), 0);
  markerLayer.clearLayers();
  const surface = cssVar("--surface");
  const pts = [];
  list.filter(hasCoords).forEach((u) => {
    const h = has(u), c = cssVar(`--r-${u.region}`) || cssVar("--ink");
    const m = L.circleMarker([u.lat, u.lon], {
      radius: u.type === "NP" ? 8 : 6, weight: 2,
      color: c, fillColor: h ? c : surface, fillOpacity: 1,
    });
    const btn = el("button", { class: "linkish", type: "button", onclick: () => openSheet(u.key) }, h ? "Open" : "Open and check off");
    m.bindPopup(el("div", {}, el("b", {}, u.name), el("div", {}, `${TYPES[u.type].label} · ${u.st} · ${regionName(u.region)}`), btn));
    m.bindTooltip(u.name);
    markerLayer.addLayer(m);
    pts.push([u.lat, u.lon]);
  });
  if (meMarker) meMarker.remove();
  if (S.here) {
    meMarker = L.circleMarker([S.here.lat, S.here.lon], { radius: 8, weight: 3, color: cssVar("--surface"), fillColor: cssVar("--fg"), fillOpacity: 1 }).bindTooltip("You are here").addTo(map);
    pts.push([S.here.lat, S.here.lon]);
  }
  // Refit only when the filter set changes, so panning around isn't undone by every save.
  const fitKey = JSON.stringify([S.f.q, S.f.state, S.f.region, [...S.f.types], S.f.status, S.f.near, S.f.radius, !!S.here]);
  if (fitKey !== lastFitKey && pts.length) {
    lastFitKey = fitKey;
    if (pts.length === 1) map.setView(pts[0], 9);
    else if (!S.f.q && !S.f.state && !S.f.region && !S.f.near) map.setView([39.5, -98.5], 4);
    else map.fitBounds(pts, { padding: [30, 30], maxZoom: 10 });
  }
}

/* ---------- park sheet ---------- */
function openSheet(key) {
  S.open = key; S.editing = null;
  loadInfo(); loadLive(unitByKey(key)?.code);
  renderSheet();
  $("#sheet").hidden = false; $("#scrim").hidden = false; $("#sheet").focus();
  map?.closePopup();
}
function closeSheet() { S.open = null; $("#sheet").hidden = true; $("#scrim").hidden = true; }

function armButton(btn, label, action) {
  if (btn.dataset.armed) { action(); return; }
  btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
}

function renderSheet() {
  if (S.open == null) return;
  if (S.open === "__list") return renderListSettings();
  const u = unitByKey(S.open);
  if (!u) { closeSheet(); return; }
  const vs = visitsFor(u.key);
  const nearest = hasCoords(u) ? NPS_UNITS.filter((x) => x.key !== u.key).map((x) => ({ ...x, d: miles(u, x) })).sort((a, b) => a.d - b.d).slice(0, 5) : [];
  const mapsQ = hasCoords(u) ? encodeURIComponent(u.name) : encodeURIComponent(`${u.name} ${STATE_NAMES[u.st] || ""}`);
  $("#sheet").replaceChildren(...[
    el("button", { class: "btn close", type: "button", onclick: closeSheet }, "Close"),
    el("div", { class: "sheet-head", style: `--rc:${regionColor(u.region)}` },
      u.region ? el("span", { class: "rdot" }, regionName(u.region) + " region") : null,
      el("div", { class: "eyebrow" }, [TYPES[u.type].label, STATE_NAMES[u.st] || u.st, u.code].filter(Boolean).join(" · ")),
      el("h3", { id: "sheetTitle", style: "margin-top:6px" }, u.name)),
    el("div", { class: "row" },
      u.code ? el("a", { href: `https://www.nps.gov/${u.code.toLowerCase()}/index.htm`, target: "_blank", rel: "noopener" }, "Park website ↗") : null,
      el("a", { href: `https://www.google.com/maps/search/?api=1&query=${mapsQ}`, target: "_blank", rel: "noopener" }, "Directions ↗"),
      S.here && hasCoords(u) ? el("span", { class: "dist" }, `${Math.round(miles(S.here, u))} mi from you`) : null),
    alertsSection(u),
    stampCard(u),
    whereSection(u),
    el("div", { class: "eyebrow" }, vs.length ? `Visit journal (${vs.length})` : "Visit journal"),
    ...vs.map((v) => el("div", { class: "card visit" },
      el("div", { class: "d" }, fmtDate(v.date) + (v.rating ? " · " + v.rating : "")),
      v.with ? el("div", { style: "font-size:13px;color:var(--muted)" }, "With " + v.with) : null,
      v.notes ? el("p", {}, v.notes) : null,
      el("div", { class: "acts" },
        el("button", { class: "linkish", type: "button", onclick: () => { S.editing = v.id; renderSheet(); } }, "Edit"),
        el("button", { class: "linkish", type: "button", style: "color:var(--warn)", onclick: (e) => armButton(e.target, "Tap again to delete", () => S.store.remove("visits", v.id).catch(saveFailed)) }, "Delete")))),
    visitForm(u),
    nearest.length ? el("div", {}, el("div", { class: "eyebrow", style: "margin-bottom:6px" }, "Closest other sites"),
      el("ul", { class: "units" }, nearest.map((x) => el("li", { class: "unit", style: "grid-template-columns:1fr auto", onclick: () => openSheet(x.key) },
        el("div", { class: "nm" }, x.name, el("div", { class: "meta" }, has(x) ? el("span", { class: "tag np" }, "have") : el("span", { class: "tag" }, "need"))),
        el("span", { class: "dist" }, Math.round(x.d) + " mi"))))) : null,
  ].filter(Boolean));
}

function stampCard(u) {
  const s = stampFor(u.key), err = el("div", { class: "err", role: "status" });
  if (!s) {
    return el("div", { class: "card stamp-card" },
      el("button", { class: "btn primary", type: "button", onclick: () => giveStamp(u.key).catch((x) => saveFailed(x, err)) }, "Got the stamp"),
      el("span", { class: "hint" }, "Checks it off with today's date. Saving a visit below does this too."), err);
  }
  const dateIn = el("input", { class: "field", type: "date", id: "stampDate", value: s.date || "", "aria-label": "Date stamped",
    onchange: (e) => S.store.set("stamps", u.key, { date: e.target.value || todayISO() }).catch((x) => saveFailed(x, err)) });
  return el("div", { class: "card stamp-card" },
    markSVG(u, true),
    el("div", { style: "display:grid;gap:4px" }, el("strong", {}, "Stamped"), dateIn),
    el("button", { class: "linkish", type: "button", style: "color:var(--warn);justify-self:end",
      onclick: (e) => armButton(e.target, "Tap again to unmark", () => S.store.remove("stamps", u.key).catch((x) => saveFailed(x, err))) }, "Unmark"),
    err);
}

function visitForm(u) {
  const ed = S.editing ? S.visits.find((v) => v.id === S.editing) : null;
  let rating = ed?.rating || "";
  const ratingBox = el("div", { class: "rating", role: "group", "aria-label": "How was it" }, RATINGS.map((r) =>
    el("button", { type: "button", "aria-pressed": r === rating ? "true" : "false", onclick: () => {
      rating = rating === r ? "" : r;
      [...ratingBox.children].forEach((b) => b.setAttribute("aria-pressed", b.textContent === rating ? "true" : "false"));
    } }, r)));
  const err = el("div", { class: "err", role: "status" });
  const f = el("form", { class: "log", onsubmit: async (e) => {
      e.preventDefault();
      const body = { unit: u.key, date: f.vdate.value || todayISO(), with: f.vwith.value.trim(), notes: f.vnotes.value.trim(), rating };
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        if (ed) await S.store.update("visits", ed.id, body); else await S.store.add("visits", body);
        if (!stampFor(u.key)) await giveStamp(u.key, body.date);
        S.editing = null; S.fresh = u.key; renderSheet();
      } catch (x) { saveFailed(x, err); } finally { btn.disabled = false; }
    } },
    el("div", { class: "eyebrow" }, ed ? "Edit visit" : "Write about a visit"),
    el("label", {}, "Date", el("input", { class: "field", type: "date", name: "vdate", id: "vdate", value: ed?.date || todayISO(), required: true })),
    el("label", {}, "Who you went with (optional)", el("input", { class: "field", name: "vwith", id: "vwith", value: ed?.with || "", placeholder: "Sam, the dog…" })),
    el("label", {}, "How did it go?", el("textarea", { class: "field", name: "vnotes", id: "vnotes", rows: "4", placeholder: "Saw a moose at dusk. The ranger talk was great.", value: ed?.notes || "" })),
    ratingBox, err,
    el("div", { class: "row" }, el("button", { class: "btn primary", type: "submit" }, ed ? "Save changes" : "Save visit"),
      ed ? el("button", { class: "btn", type: "button", onclick: () => { S.editing = null; renderSheet(); } }, "Cancel") : null));
  return f;
}

/* ---------- where to get the stamp, and alerts ---------- */
async function loadInfo() {
  if (S.infoState !== "idle") return;
  S.infoState = "loading";
  try {
    const res = await fetch("data/park-info.json");
    if (!res.ok) throw new Error(res.status);
    S.info = await res.json(); S.infoState = "ok";
  } catch (e) { console.warn("Park details didn't load", e); S.infoState = "error"; }
  if (S.open && !S.open.startsWith("__")) renderSheet();
}
const LIVE_MAX_AGE = 30 * 60 * 1000;
function loadLive(code) {
  if (!S.npsKey || !code) return;
  const cur = S.live[code];
  if (cur && (cur.state === "loading" || Date.now() - cur.at < LIVE_MAX_AGE)) return;
  S.live[code] = { state: "loading", at: Date.now() };
  fetchParkLive(S.npsKey, code)
    .then((r) => { S.live[code] = { state: "ok", at: Date.now(), ...r }; })
    .catch((e) => { S.live[code] = { state: "error", at: Date.now(), msg: e.message }; })
    .finally(() => { if (S.open === code) renderSheet(); });
}
// Live stamp locations when you have a key, otherwise the copy that ships with the app.
const infoFor = (u) => (u.code ? S.live[u.code]?.info || S.info?.[u.code] || null : null);

function alertsSection(u) {
  if (!u.code || !S.npsKey) return null;
  const live = S.live[u.code];
  if (!live || live.state === "loading") return el("div", { class: "hint" }, "Checking for alerts and closures…");
  if (live.state === "error") return el("div", { class: "hint" }, "Couldn't check for alerts right now. " + (live.msg || ""));
  if (!live.alerts.length) return el("div", { class: "hint" }, "No current alerts for this park.");
  const severe = live.alerts.filter((a) => /closure|danger/i.test(a.cat)).length;
  const n = live.alerts.length;
  return el("details", { class: "alerts" + (severe ? " has-severe" : "") },
    el("summary", {}, `${n} alert${n === 1 ? "" : "s"}` + (severe ? ` · ${severe} closure${severe === 1 ? "" : "s"} or danger` : "")),
    live.alerts.map((a) => el("details", { class: "alert" + (/closure|danger/i.test(a.cat) ? " severe" : "") },
      el("summary", {}, el("span", { class: "acat" }, a.cat || "Alert"), a.title),
      el("p", {}, a.d), a.url ? el("a", { href: a.url, target: "_blank", rel: "noopener" }, "More on nps.gov ↗") : null)));
}

const todayIdx = () => new Date().getDay();
function whereSection(u) {
  if (!u.code) return null;
  const info = infoFor(u);
  if (!info) {
    return S.infoState === "loading" || S.infoState === "idle" ? el("div", { class: "hint" }, "Loading where to find the stamp…")
      : S.infoState === "error" ? el("div", { class: "hint" }, "Couldn't load stamp locations. Check your connection and reopen this park.") : null;
  }
  if (!info.stamps.length) {
    return el("div", { class: "card" }, el("div", { class: "eyebrow" }, "Where to get the stamp"),
      el("p", { class: "hint", style: "margin:0" }, "The Park Service doesn't list a stamp location for this site. Ask at the visitor center or check the park website."));
  }
  const list = el("ul", { class: "spots" });
  const LIMIT = 3, many = info.stamps.length > LIMIT;
  const draw = (all) => list.replaceChildren(...info.stamps.slice(0, all ? undefined : LIMIT).map((s) => spotItem(u, s)));
  draw(false);
  return el("div", { class: "card" },
    el("div", { class: "eyebrow" }, info.stamps.length === 1 ? "Where to get the stamp" : `Where to get the stamps (${info.stamps.length} spots)`),
    list,
    many ? el("button", { class: "linkish", type: "button", style: "justify-self:start", onclick: (e) => { draw(true); e.target.remove(); } }, `Show all ${info.stamps.length}`) : null);
}
function spotItem(u, s) {
  const today = s.hours?.[todayIdx()];
  const dir = s.lat != null ? `${s.lat},${s.lon}` : `${s.n} ${u.name}`;
  return el("li", { class: "spot" + (s.closed ? " closed" : "") },
    el("div", { class: "spot-body" },
      el("div", { class: "spot-name" }, s.n.replace(/\s*\(Temporarily Closed\)/i, ""), s.closed ? el("span", { class: "tag warn" }, "Temporarily closed") : null),
      s.where ? el("p", {}, s.where) : null,
      today ? el("div", { class: "spot-hours" }, `Today: ${today}`) : s.hoursNote ? el("div", { class: "spot-hours" }, s.hoursNote) : null,
      el("div", { class: "row spot-links" },
        el("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}`, target: "_blank", rel: "noopener" }, "Directions ↗"),
        s.url ? el("a", { href: s.url, target: "_blank", rel: "noopener" }, "Hours & info ↗") : null)));
}
/* ---------- park list from the NPS ---------- */
function renderListSettings() {
  const status = el("div", { class: "hint", role: "status" });
  const err = el("div", { class: "err", role: "alert" });
  const key = el("input", { class: "field grow", type: "password", id: "npsKey", autocomplete: "off", spellcheck: "false",
    value: S.npsKey, placeholder: "Paste your NPS API key" });
  const show = el("button", { class: "linkish", type: "button", onclick: () => { key.type = key.type === "password" ? "text" : "password"; show.textContent = key.type === "password" ? "Show" : "Hide"; } }, "Show");
  const go = el("button", { class: "btn primary", type: "submit" }, "Refresh park list");
  const f = el("form", { class: "log", onsubmit: async (e) => {
      e.preventDefault();
      const k = key.value.trim();
      err.textContent = ""; status.textContent = "";
      if (!k) { err.textContent = "Paste your API key first."; return; }
      go.disabled = true; go.textContent = "Refreshing…";
      try {
        if (k !== S.npsKey) await S.store.set("meta", "settings", { npsKey: k });
        const parks = await fetchParks(k, (n, total) => { status.textContent = `Downloading parks… ${n} of ${total}`; });
        const { rows, added, removed, skipped } = buildList(parks, new Set(NPS_UNITS.map((u) => u.code)));
        if (rows.length < 100) throw new Error(`The NPS only returned ${rows.length} parks, so your current list was kept. Try again later.`);
        await S.store.setShared("units", { json: JSON.stringify(rows), refreshedAt: new Date().toISOString(), count: rows.length });
        const lost = removed.filter((c) => stampFor(c));
        status.replaceChildren(...[
          el("strong", {}, `Updated: ${rows.length} park sites.`),
          added.length ? el("div", {}, `New: ${added.slice(0, 12).join(", ")}${added.length > 12 ? ` and ${added.length - 12} more` : ""}.`) : el("div", {}, "No new sites since your last list."),
          removed.length ? el("div", {}, `No longer listed: ${removed.length} (${removed.slice(0, 8).join(", ")}${removed.length > 8 ? "…" : ""}).`) : null,
          lost.length ? el("div", {}, `You have stamps for ${lost.join(", ")}. They're still saved and will show again if those sites come back.`) : null,
          skipped.length ? el("div", {}, `Skipped ${skipped.length} without a location.`) : null,
        ].filter(Boolean));
      } catch (x) {
        err.textContent = x.code === "permission-denied" ? "The database didn't accept the new list. Check that OWNER_UID in firestore.rules is your User UID and the rules are deployed." : x.message || "Something went wrong. Try again.";
      } finally { go.disabled = false; go.textContent = "Refresh park list"; }
    } },
    el("label", { for: "npsKey" }, "NPS API key"),
    el("div", { class: "row" }, key, show),
    el("div", { class: "hint" }, "Saved privately to your account, so you only enter it once. ",
      el("a", { href: "https://www.nps.gov/subjects/developer/get-started.htm", target: "_blank", rel: "noopener" }, "Get a free key ↗")),
    el("div", { class: "row" }, go, S.npsKey ? el("button", { class: "linkish", type: "button", style: "color:var(--warn)",
      onclick: (e) => armButton(e.target, "Tap again to forget the key", () => S.store.remove("meta", "settings").then(() => { key.value = ""; }).catch((x) => saveFailed(x, err))) }, "Forget key") : null),
    status, err);
  $("#sheet").replaceChildren(...[
    el("button", { class: "btn close", type: "button", onclick: closeSheet }, "Close"),
    el("h3", { id: "sheetTitle" }, "Update park list"),
    el("p", { class: "lede", style: "margin:0" }, S.list
      ? `Everyone is using the list from the National Park Service you refreshed ${fmtDate(String(S.list.refreshedAt).slice(0, 10))} (${S.list.count} sites).`
      : `Everyone is using the built-in list (${RAW_UNITS.length} sites). Refresh it to get the latest sites straight from the National Park Service. Only you see this page, and nobody else needs a key.`),
    f,
    S.list ? el("button", { class: "linkish", type: "button", style: "justify-self:start", onclick: (e) => armButton(e.target, "Tap again to switch back",
      () => S.store.removeShared("units").catch((x) => saveFailed(x, err))) }, "Go back to the built-in list") : null,
    el("p", { class: "hint" }, "A refresh updates the list for everyone. It doesn't touch anyone's stamps or journal. They're tied to each park's code, which doesn't change."),
  ].filter(Boolean));
}

/* ---------- location ---------- */
function locate() {
  const btn = $("#locateBtn");
  if (!navigator.geolocation) { showNotice("This browser can't share your location. Pick a park in the Near box instead."); return; }
  btn.disabled = true; btn.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition((pos) => {
    S.here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    S.f.near = ME; $("#near").value = ""; btn.disabled = false; btn.textContent = "Near me ✓"; showNotice(""); render();
  }, (e) => {
    btn.disabled = false; btn.textContent = "Use my location";
    showNotice(e.code === 1 ? "Location is turned off for this site. Allow it in your browser settings, or pick a park in the Near box." : "Couldn't find your location. Try again, or pick a park in the Near box.");
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

/* ---------- controls ---------- */
function setupControls() {
  const st = $("#state");
  fillUnitControls();
  $("#types").replaceChildren(...GROUPS.map(([g, label]) => el("button", { type: "button", "aria-pressed": "false", onclick: (e) => {
    S.f.types.has(g) ? S.f.types.delete(g) : S.f.types.add(g); e.target.setAttribute("aria-pressed", S.f.types.has(g)); render();
  } }, label)));
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.f.q = e.target.value.trim(); render(); }, 120); });
  st.addEventListener("change", (e) => { S.f.state = e.target.value; render(); });
  $("#status").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.f.status = b.dataset.v; [...$("#status").children].forEach((x) => x.setAttribute("aria-pressed", x === b)); render(); });
  $("#view").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setView(b.dataset.v); });
  $("#near").addEventListener("change", (e) => { const u = allUnits().find((x) => x.name === e.target.value); S.f.near = u ? u.key : null; resetLocateBtn(); render(); });
  $("#radius").addEventListener("change", (e) => { S.f.radius = +e.target.value; render(); });
  $("#filterToggle").addEventListener("click", () => setFiltersOpen($("#filterPanel").hidden));
  $("#resetFilters").addEventListener("click", resetFilters);
  $("#locateBtn").addEventListener("click", locate);
  $("#scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closeSheet(); });
  $("#updateListBtn").addEventListener("click", () => { S.open = "__list"; renderSheet(); $("#sheet").hidden = false; $("#scrim").hidden = false; });
}
function setFiltersOpen(open) {
  $("#filterPanel").hidden = !open;
  $("#filterToggle").setAttribute("aria-expanded", open ? "true" : "false");
}
// Chips under the search bar show what's filtering the list, so the panel can stay closed.
function renderActiveFilters() {
  const f = S.f, chips = [];
  const chip = (label, clear, color) => chips.push(el("button", { class: "chip", type: "button", style: color ? `--rc:${color}` : null,
    "aria-label": `Remove filter: ${label}`, onclick: () => { clear(); syncControls(); render(); } }, label, el("span", { "aria-hidden": "true" }, " ×")));
  if (f.region) chip(regionName(f.region), () => (f.region = ""), regionColor(f.region));
  if (f.state) chip(STATE_NAMES[f.state], () => (f.state = ""));
  if (f.status !== "all") chip(f.status === "have" ? "Have" : "Still need", () => (f.status = "all"));
  f.types.forEach((g) => chip(GROUPS.find((x) => x[0] === g)[1], () => f.types.delete(g)));
  if (f.near) chip(f.near === ME ? `Within ${f.radius > 9999 ? "any distance" : f.radius + " mi"} of you` : `Near ${unitByKey(f.near)?.name || "park"}`, () => { f.near = null; });
  if (chips.length > 1) chips.push(el("button", { class: "linkish", type: "button", onclick: resetFilters }, "Clear all"));
  $("#activeFilters").replaceChildren(...chips);
  const n = (f.state ? 1 : 0) + (f.status !== "all" ? 1 : 0) + f.types.size + (f.near ? 1 : 0);
  $("#filterCount").textContent = n; $("#filterCount").hidden = !n;
}
function resetFilters() {
  Object.assign(S.f, { region: "", state: "", status: "all", near: null, radius: 250 }); S.f.types.clear();
  syncControls(); render();
}
function syncControls() {
  $("#state").value = S.f.state;
  $("#radius").value = String(S.f.radius);
  [...$("#status").children].forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === S.f.status));
  [...$("#types").children].forEach((x, i) => x.setAttribute("aria-pressed", S.f.types.has(GROUPS[i][0])));
  if (!S.f.near) $("#near").value = "";
  resetLocateBtn();
}
function resetLocateBtn() { if (S.f.near !== ME) $("#locateBtn").textContent = "Use my location"; }
function setView(v) {
  S.view = v; pref.set("view", v);
  [...$("#view").children].forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v));
  render();
}

/* ---------- auth ---------- */
function setupAuth() {
  const err = $("#authErr");
  const run = async (fn) => {
    err.textContent = "";
    try { await fn(); } catch (e) { err.textContent = authMessage(e); }
  };
  const creds = () => [$("#authEmail").value.trim(), $("#authPw").value];
  $("#authForm").addEventListener("submit", (e) => { e.preventDefault(); run(() => S.store.signIn(...creds())); });
  $("#signUpBtn").addEventListener("click", () => { if ($("#authForm").reportValidity()) run(() => S.store.signUp(...creds())); });
  $("#googleBtn").addEventListener("click", () => run(() => S.store.signInGoogle()));
  $("#resetBtn").addEventListener("click", () => {
    const email = $("#authEmail").value.trim();
    if (!email) { err.textContent = "Type your email above first, then tap Forgot password."; return; }
    run(async () => { await S.store.resetPassword(email); err.textContent = "Check your email for a link to reset your password."; });
  });
}
function authMessage(e) {
  const c = e?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "That email and password don't match. Try again, or tap Create account if you're new.";
  if (c.includes("email-already-in-use")) return "There's already an account with that email. Tap Sign in instead.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email")) return "That email address doesn't look right.";
  if (c.includes("popup-closed")) return "The Google window closed before you finished. Try again.";
  if (c.includes("operation-not-allowed")) return "This sign-in method isn't turned on yet. Enable it in Firebase console → Authentication → Sign-in method.";
  if (c.includes("network")) return "Couldn't reach the server. Check your connection.";
  return "Sign-in didn't work. Please try again.";
}
function onUser(user) {
  S.unsubs.forEach((u) => u()); S.unsubs = [];
  S.visits = []; S.stamps = [];
  applyMeta([]); applyShared(null);
  S.user = user;
  $("#updateListRow").hidden = !(user && S.store.isOwner);
  $("#auth").hidden = !!user;
  $("#app").hidden = !user;
  const acct = $("#account");
  if (!user) { acct.replaceChildren(); closeSheet(); drawBigStamp(0, NPS_UNITS.length); return; }
  if (S.store.mode === "artifact") {
    acct.replaceChildren(el("span", {}, "Preview: your stamps are saved privately to your Claude account."));
  } else if (S.store.mode === "local") {
    acct.replaceChildren(el("span", {}, "Demo mode: saved in this browser only. Add your Firebase settings to sign in and sync."));
  } else {
    acct.replaceChildren(el("span", {}, "Signed in as " + (user.email || user.name)),
      el("button", { class: "linkish", type: "button", onclick: () => S.store.signOut() }, "Sign out"));
  }
  for (const name of ["visits", "stamps"]) {
    S.unsubs.push(S.store.subscribe(name, (rows) => { S[name] = rows; scheduleRender(); },
      (e) => saveFailed(e)));
  }
  S.unsubs.push(S.store.subscribe("meta", applyMeta, (e) => saveFailed(e)));
  S.unsubs.push(S.store.subscribeShared("units", applyShared, (e) => console.warn("Couldn't load the shared park list", e)));
  render();
}
// meta/settings holds your NPS API key.
function applyMeta(rows) {
  const settings = rows.find((r) => r.id === "settings");
  S.npsKey = settings?.npsKey || "";
  scheduleRender();
}
// shared/units holds the park list (as JSON text) the owner last refreshed from the NPS. Everyone uses it.
function applyShared(units) {
  let parsed = null;
  try { parsed = units?.json ? JSON.parse(units.json) : null; } catch { parsed = null; }
  const same = S.list ? !!parsed && S.list.refreshedAt === units.refreshedAt : !parsed;
  S.list = parsed?.length ? { refreshedAt: units.refreshedAt || "", count: parsed.length } : null;
  if (!same) { NPS_UNITS = toUnits(parsed?.length ? parsed : RAW_UNITS); fillUnitControls(); }
  scheduleRender();
}
function fillUnitControls() {
  const st = $("#state"), cur = st.value;
  st.replaceChildren(el("option", { value: "" }, "All states"), ...Object.keys(STATE_NAMES).filter((k) => NPS_UNITS.some((u) => u.st === k))
    .sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])).map((k) => el("option", { value: k }, STATE_NAMES[k])));
  st.value = cur;
  $("#nearList").replaceChildren(...NPS_UNITS.map((u) => el("option", { value: u.name })));
}

let queued = false;
function scheduleRender() {
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false; render();
    // Don't redraw the sheet while someone is typing in it.
    const typing = $("#sheet").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox";
    // The park-list page is a form with its own progress messages; leave it be.
    const formPage = S.open === "__list";
    if (S.open && !S.editing && !typing && !formPage) renderSheet();
  });
}

/* ---------- boot ---------- */
async function boot() {
  setupControls();
  setupAuth();
  drawBigStamp(0, NPS_UNITS.length);
  // Filters start closed so the list gets the screen; the chips under the search bar show what's active.
  setFiltersOpen(false);
  const v = pref.get("view");
  if (v === "map" || v === "list") { S.view = v; [...$("#view").children].forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v)); }
  try { S.store = await createStore(); }
  catch (e) { console.error(e); showNotice("Couldn't connect to the sign-in service. Check your connection and reload."); return; }
  S.store.onAuth(onUser);
}
boot();
