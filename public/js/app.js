import { RAW_UNITS } from "./units.js";
import { createStore } from "./store.js";

/* ---------- reference data ---------- */
const TYPES = {
  NP: { label: "National Park", group: "parks" }, NM: { label: "National Monument", group: "monuments" },
  NHP: { label: "Historical Park", group: "history" }, NHS: { label: "Historic Site", group: "history" },
  MEM: { label: "Memorial", group: "memorials" }, BAT: { label: "Battlefield", group: "battle" },
  REC: { label: "Recreation / Seashore / Lakeshore", group: "rec" }, PRES: { label: "Preserve / Reserve", group: "rec" },
  RIV: { label: "River", group: "rivers" }, TRL: { label: "Trail", group: "rivers" }, PKWY: { label: "Parkway", group: "rivers" },
  OTH: { label: "Park", group: "other" }, CUST: { label: "Your place", group: "custom" },
};
const GROUPS = [["parks", "National Parks"], ["monuments", "Monuments"], ["memorials", "Memorials"], ["history", "Historic sites"],
  ["battle", "Battlefields"], ["rec", "Seashores, lakes & preserves"], ["rivers", "Rivers, trails & parkways"], ["other", "Other parks"], ["custom", "Your places"]];
const REGIONS = [
  ["NA", "North Atlantic", "ME NH VT MA RI CT NY NJ"], ["MA", "Mid-Atlantic", "PA DE MD VA WV"], ["NC", "National Capital", "DC"],
  ["SE", "Southeast", "KY TN NC SC GA FL AL MS LA PR VI"], ["MW", "Midwest", "OH IN IL MI WI MN IA MO AR NE KS"],
  ["SW", "Southwest", "TX OK NM AZ"], ["RM", "Rocky Mountain", "CO MT ND SD UT WY"], ["W", "Western", "CA NV HI GU AS MP"], ["PNW", "Pacific NW & Alaska", "AK ID OR WA"],
];
const REGION_OF = {};
REGIONS.forEach(([k, , s]) => s.split(" ").forEach((st) => (REGION_OF[st] = k)));
const STATE_NAMES = { AK: "Alaska", AL: "Alabama", AR: "Arkansas", AS: "American Samoa", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia", GU: "Guam", HI: "Hawaiʻi", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri", MP: "Northern Mariana Islands", MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VI: "U.S. Virgin Islands", VT: "Vermont", WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming" };
const RATINGS = ["Quick stop", "Good", "Great", "Unforgettable"];
const ME = "__me";

const NPS_UNITS = RAW_UNITS.map(([code, name, type, st, lat, lon, reg]) =>
  ({ key: code, code, name, type, st, lat: +lat, lon: +lon, region: reg || REGION_OF[st] }));

/* ---------- state ---------- */
const S = {
  store: null, user: null, unsubs: [],
  visits: [], stamps: [], places: [],
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

function allUnits() {
  return NPS_UNITS.concat(S.places.map((p) => ({
    key: "x-" + p.id, code: "", name: p.name, type: "CUST", st: p.st || "", lat: p.lat ?? NaN, lon: p.lon ?? NaN,
    region: REGION_OF[p.st] || "", custom: true, kind: p.kind,
  })));
}
const unitByKey = (k) => allUnits().find((u) => u.key === k);
const visitsFor = (key) => S.visits.filter((v) => v.unit === key).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const stampsFor = (key) => S.stamps.filter((s) => s.unit === key).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
const has = (u) => S.visits.some((v) => v.unit === u.key) || S.stamps.some((s) => s.unit === u.key && s.got);
function firstDate(key) {
  const ds = [...visitsFor(key).map((v) => v.date), ...stampsFor(key).filter((s) => s.got).map((s) => s.date)].filter(Boolean).sort();
  return ds[0] || "";
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
function markSVG(u, stamped) {
  const svg = svgEl("svg", { viewBox: "0 0 50 50", class: "mark" + (S.fresh === u.key ? " fresh" : ""), role: "img", "aria-label": stamped ? "Stamped" : "Not yet" });
  const rot = ((u.key.charCodeAt(0) * 7 + u.key.charCodeAt(u.key.length - 1) * 3) % 21) - 10;
  const g = svgEl("g", { transform: `rotate(${stamped ? rot : 0} 25 25)` });
  const ring = (r, dash) => svgEl("circle", { cx: 25, cy: 25, r, fill: "none", stroke: stamped ? "var(--ink)" : "var(--line)", "stroke-width": dash ? 1.5 : 2, ...(dash ? { "stroke-dasharray": "3 3" } : {}) });
  if (stamped) {
    const t = svgEl("text", { x: 25, y: 24, "text-anchor": "middle", "font-size": 9, fill: "var(--ink)" }); t.textContent = u.code || "★";
    const d = svgEl("text", { x: 25, y: 34, "text-anchor": "middle", "font-size": 6.5, fill: "var(--ink)" }); d.textContent = firstDate(u.key).slice(2).replace(/-/g, ".");
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
    return el("button", { class: "region", "aria-pressed": S.f.region === k ? "true" : "false", onclick: () => { S.f.region = S.f.region === k ? "" : k; render(); } },
      el("span", { class: "name" }, name), el("span", { class: "num" }, `${h} / ${us.length}`),
      el("span", { class: "bar" }, el("i", { style: `width:${us.length ? (h / us.length) * 100 : 0}%` })));
  }));
  const { list, near } = filtered();
  const region = S.f.region ? " in " + REGIONS.find((r) => r[0] === S.f.region)[1] : "";
  $("#count").textContent = `${list.length} site${list.length === 1 ? "" : "s"}${region}`;
  $("#clearNear").hidden = !S.f.near;
  $("#mapWrap").hidden = S.view !== "map";
  $("#list").hidden = S.view !== "list";
  if (S.view === "map") renderMap(list);
  else renderList(list, near);
  S.fresh = null;
}

function unitRow(u, near) {
  const st = stampsFor(u.key), got = st.filter((s) => s.got).length;
  return el("li", { class: "unit", tabindex: "0", role: "button", "aria-label": u.name, onclick: () => openSheet(u.key),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(u.key); } } },
    markSVG(u, has(u)),
    el("div", { style: "min-width:0" }, el("div", { class: "nm" }, u.name),
      el("div", { class: "meta" },
        el("span", { class: "tag" + (u.type === "NP" ? " np" : "") }, u.custom ? (u.kind || "Your place") : TYPES[u.type].label),
        el("span", {}, u.st), u.code ? el("span", {}, u.code) : null,
        st.length ? el("span", {}, `${got}/${st.length} stamps`) : null)),
    near ? el("span", { class: "dist" }, u.d < 1 ? "here" : Math.round(u.d) + " mi") : el("span"));
}
function renderList(list, near) {
  const box = $("#list");
  if (!list.length) {
    box.replaceChildren(el("p", { class: "empty-list" }, S.f.status === "have" && !S.visits.length && !S.stamps.length
      ? "No stamps yet. Switch to All, tap a park, and check off the stamps you have." : "Nothing matches these filters."));
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
    return [el("div", { class: "group-h" }, el("h2", {}, STATE_NAMES[st] || st || "Other"), el("span", {}, `${h}/${us.length}`)),
      el("ul", { class: "units" }, us.map((u) => unitRow(u, false)))];
  }));
}

/* ---------- map ---------- */
let map = null, markerLayer = null, meMarker = null, lastFitKey = "";
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function renderMap(list) {
  if (!window.L) { $("#map").textContent = "The map couldn't load. Check your connection and reload."; return; }
  if (!map) {
    map = L.map("map", { preferCanvas: true, worldCopyJump: true }).setView([39.5, -98.5], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 0);
  markerLayer.clearLayers();
  const ink = cssVar("--ink"), surface = cssVar("--surface"), custom = cssVar("--custom");
  const pts = [];
  list.filter(hasCoords).forEach((u) => {
    const h = has(u);
    const m = L.circleMarker([u.lat, u.lon], {
      radius: u.type === "NP" ? 8 : 6, weight: 2,
      color: u.custom ? custom : ink, fillColor: u.custom ? custom : h ? ink : surface, fillOpacity: 1,
    });
    const btn = el("button", { class: "linkish", type: "button", onclick: () => openSheet(u.key) }, h ? "Open" : "Open and check off");
    m.bindPopup(el("div", {}, el("b", {}, u.name), el("div", {}, `${u.custom ? u.kind || "Your place" : TYPES[u.type].label} · ${u.st}`), btn));
    m.bindTooltip(u.name);
    markerLayer.addLayer(m);
    pts.push([u.lat, u.lon]);
  });
  if (meMarker) meMarker.remove();
  if (S.here) {
    meMarker = L.circleMarker([S.here.lat, S.here.lon], { radius: 7, weight: 3, color: "#fff", fillColor: "#d33", fillOpacity: 1 }).bindTooltip("You are here").addTo(map);
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
  S.open = key; S.editing = null; renderSheet();
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
  if (S.open === "__add") return renderAddPlace();
  const u = unitByKey(S.open);
  if (!u) { closeSheet(); return; }
  const vs = visitsFor(u.key), st = stampsFor(u.key);
  const nearest = hasCoords(u) ? NPS_UNITS.filter((x) => x.key !== u.key).map((x) => ({ ...x, d: miles(u, x) })).sort((a, b) => a.d - b.d).slice(0, 5) : [];
  const mapsQ = hasCoords(u) && !u.custom ? encodeURIComponent(u.name) : encodeURIComponent(`${u.name} ${STATE_NAMES[u.st] || ""}`);
  $("#sheet").replaceChildren(...[
    el("button", { class: "btn close", type: "button", onclick: closeSheet }, "Close"),
    el("div", {}, el("div", { class: "eyebrow" }, [u.custom ? u.kind || "Your place" : TYPES[u.type].label, STATE_NAMES[u.st] || u.st, u.code].filter(Boolean).join(" · ")),
      el("h3", { id: "sheetTitle", style: "margin-top:6px" }, u.name)),
    el("div", { class: "row" },
      u.code ? el("a", { href: `https://www.nps.gov/${u.code.toLowerCase()}/index.htm`, target: "_blank", rel: "noopener" }, "Park website ↗") : null,
      el("a", { href: `https://www.google.com/maps/search/?api=1&query=${mapsQ}`, target: "_blank", rel: "noopener" }, "Directions ↗"),
      S.here && hasCoords(u) ? el("span", { class: "dist" }, `${Math.round(miles(S.here, u))} mi from you`) : null),
    stampSection(u, st),
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
    u.custom ? el("button", { class: "btn danger", type: "button", onclick: (e) => armButton(e.target, "Tap again to remove", async () => {
      try {
        for (const v of visitsFor(u.key)) await S.store.remove("visits", v.id);
        for (const s of stampsFor(u.key)) await S.store.remove("stamps", s.id);
        await S.store.remove("places", u.key.slice(2)); closeSheet();
      } catch (x) { saveFailed(x); }
    }) }, "Remove this place") : null,
  ].filter(Boolean));
}

function stampSection(u, st) {
  const err = el("div", { class: "err", role: "status" });
  const input = el("input", { class: "field grow", id: "newStamp", placeholder: st.length ? "Add another stamp" : "Stamp name, e.g. " + (u.code ? "Old Faithful Visitor Center" : "Ranger station"), "aria-label": "New stamp name" });
  const addStamp = async (name, got) => {
    if (!name) { err.textContent = "Type the name printed on the stamp."; return; }
    try { await S.store.add("stamps", { unit: u.key, name, got, date: got ? todayISO() : "" }); S.fresh = u.key; input.value = ""; err.textContent = ""; }
    catch (x) { saveFailed(x, err); }
  };
  return el("div", { class: "card" },
    el("div", { class: "eyebrow" }, st.length ? `Stamps (${st.filter((s) => s.got).length} of ${st.length})` : "Stamps"),
    st.length ? null : el("p", { style: "margin:0;font-size:14px;color:var(--muted)" },
      "Most sites have one main stamp, and big parks have several (one per visitor center, plus special and anniversary stamps). Add each one you see, and check it off when you have it."),
    st.length ? null : el("button", { class: "btn primary", type: "button", onclick: () => addStamp(u.name, true) }, "I got the main stamp"),
    st.length ? el("ul", { class: "stamps" }, st.map((s) => el("li", {},
      el("input", { type: "checkbox", checked: !!s.got, "aria-label": s.name,
        onchange: (e) => S.store.update("stamps", s.id, { got: e.target.checked, date: e.target.checked ? s.date || todayISO() : "" }).catch(saveFailed) }),
      el("div", {}, el("div", {}, s.name), s.got && s.date ? el("div", { class: "sd" }, fmtDate(s.date)) : null),
      el("button", { class: "x", type: "button", "aria-label": "Remove " + s.name, title: "Remove",
        onclick: (e) => armButton(e.currentTarget, "×?", () => S.store.remove("stamps", s.id).catch(saveFailed)) }, "×")))) : null,
    el("form", { class: "row", onsubmit: (e) => { e.preventDefault(); addStamp(input.value.trim(), false); } },
      input, el("button", { class: "btn", type: "submit" }, "Add")),
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

function renderAddPlace() {
  const err = el("div", { class: "err", role: "status" });
  const f = el("form", { class: "log", onsubmit: async (e) => {
      e.preventDefault();
      const name = f.pname.value.trim();
      if (!name) { err.textContent = "Give the place a name."; return; }
      const ref = NPS_UNITS.find((x) => x.name === f.pnear.value);
      const loc = f.puseMe.checked && S.here ? S.here : ref;
      try {
        const id = await S.store.add("places", { name, kind: f.pkind.value, st: f.pst.value, lat: loc ? loc.lat : null, lon: loc ? loc.lon : null });
        openSheet("x-" + id);
      } catch (x) { saveFailed(x, err); }
    } },
    el("label", {}, "Name", el("input", { class: "field", name: "pname", id: "pname", required: true, placeholder: "Pisgah National Forest" })),
    el("label", {}, "Kind", el("select", { class: "field", name: "pkind", id: "pkind" }, ["National Forest", "State Park", "Wildlife Refuge", "BLM Land", "Other"].map((k) => el("option", {}, k)))),
    el("label", {}, "State", el("select", { class: "field", name: "pst", id: "pst" }, Object.keys(STATE_NAMES).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])).map((k) => el("option", { value: k }, STATE_NAMES[k])))),
    el("label", {}, "Where is it? Pick the closest park site (optional)", el("input", { class: "field", name: "pnear", id: "pnear", list: "nearList" })),
    el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:500" + (S.here ? "" : ";display:none") },
      el("input", { type: "checkbox", name: "puseMe", id: "puseMe" }), "Use my current location instead"),
    err, el("button", { class: "btn primary", type: "submit" }, "Add place"));
  $("#sheet").replaceChildren(
    el("button", { class: "btn close", type: "button", onclick: closeSheet }, "Close"),
    el("h3", { id: "sheetTitle" }, "Add a place"),
    el("p", { class: "lede", style: "margin:0" }, "For spots outside the National Park Service, like national forests or state parks. They show up under “Your places.”"),
    f);
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
  Object.keys(STATE_NAMES).filter((k) => NPS_UNITS.some((u) => u.st === k)).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])).forEach((k) => st.append(el("option", { value: k }, STATE_NAMES[k])));
  $("#types").replaceChildren(...GROUPS.map(([g, label]) => el("button", { type: "button", "aria-pressed": "false", onclick: (e) => {
    S.f.types.has(g) ? S.f.types.delete(g) : S.f.types.add(g); e.target.setAttribute("aria-pressed", S.f.types.has(g)); render();
  } }, label)));
  $("#nearList").replaceChildren(...NPS_UNITS.map((u) => el("option", { value: u.name })));
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.f.q = e.target.value.trim(); render(); }, 120); });
  st.addEventListener("change", (e) => { S.f.state = e.target.value; render(); });
  $("#status").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.f.status = b.dataset.v; [...$("#status").children].forEach((x) => x.setAttribute("aria-pressed", x === b)); render(); });
  $("#view").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setView(b.dataset.v); });
  $("#near").addEventListener("change", (e) => { const u = allUnits().find((x) => x.name === e.target.value); S.f.near = u ? u.key : null; resetLocateBtn(); render(); });
  $("#radius").addEventListener("change", (e) => { S.f.radius = +e.target.value; render(); });
  $("#clearNear").addEventListener("click", () => { S.f.near = null; $("#near").value = ""; resetLocateBtn(); render(); });
  $("#locateBtn").addEventListener("click", locate);
  $("#scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.open) closeSheet(); });
  $("#addPlaceBtn").addEventListener("click", () => { S.open = "__add"; renderSheet(); $("#sheet").hidden = false; $("#scrim").hidden = false; });
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
  S.visits = []; S.stamps = []; S.places = [];
  S.user = user;
  $("#auth").hidden = !!user;
  $("#app").hidden = !user;
  const acct = $("#account");
  if (!user) { acct.replaceChildren(); closeSheet(); drawBigStamp(0, NPS_UNITS.length); return; }
  if (S.store.mode === "local") {
    acct.replaceChildren(el("span", {}, "Demo mode: saved in this browser only. Add your Firebase settings to sign in and sync."));
  } else {
    acct.replaceChildren(el("span", {}, "Signed in as " + (user.email || user.name)),
      el("button", { class: "linkish", type: "button", onclick: () => S.store.signOut() }, "Sign out"));
  }
  for (const name of ["visits", "stamps", "places"]) {
    S.unsubs.push(S.store.subscribe(name, (rows) => { S[name] = rows; scheduleRender(); },
      (e) => saveFailed(e)));
  }
  render();
}
let queued = false;
function scheduleRender() {
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false; render();
    // Don't redraw the sheet while someone is typing in it.
    const typing = $("#sheet").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox";
    if (S.open && !S.editing && !typing) renderSheet();
  });
}

/* ---------- boot ---------- */
async function boot() {
  setupControls();
  setupAuth();
  drawBigStamp(0, NPS_UNITS.length);
  const v = pref.get("view");
  if (v === "map" || v === "list") { S.view = v; [...$("#view").children].forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v)); }
  try { S.store = await createStore(); }
  catch (e) { console.error(e); showNotice("Couldn't connect to the sign-in service. Check your connection and reload."); return; }
  S.store.onAuth(onUser);
}
boot();
