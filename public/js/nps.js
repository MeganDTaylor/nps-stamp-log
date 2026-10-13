// Turns NPS Data API park records into the app's park-list rows. Used by the app's
// "Update park list" page and by tools/fetch-nps-units.mjs.
import { US_STATES } from "./us-states.js";

// Sites the passport book files under National Capital even though they sit in MD, VA or WV.
const NATIONAL_CAPITAL = new Set(["LYBA", "GWMP", "ARHO", "CHOH", "CLBA", "GLEC", "WOTR", "PRWI", "MANA", "HAFE",
  "ANTI", "MONO", "CATO", "FOWA", "GREE", "PISC", "OXHI", "APPA", "NACC", "NAMA", "ROCR", "WHHO"]);

// The API lists a multi-state park's states alphabetically, so file each site under the state
// that contains its coordinates. A few long trails and parkways keep a hand-picked home.
const STATE_FIX = { APPA: "WV", NATR: "MS", BLRI: "NC", LECL: "NE", TRTE: "TN" };

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function stateAt(lon, lat) {
  for (const f of US_STATES.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some((poly) => inRing([lon, lat], poly[0]) && !poly.slice(1).some((hole) => inRing([lon, lat], hole)))) return f.properties.st;
  }
  return null;
}

export function typeFor(designation, name) {
  const d = `${designation || ""} ${designation ? "" : name}`;
  if (/^National Parks?( (&|and) Preserve)?$|^National and State Parks$/i.test((designation || "").trim())) return "NP";
  if (!designation && /\bNational Park\b/i.test(name) && !/Historical|Performing/i.test(name)) return "NP";
  if (/Historical Park/i.test(d)) return "NHP";
  if (/Historic Site/i.test(d)) return "NHS";
  if (/Battlefield|Military Park/i.test(d)) return "BAT";
  if (/Memorial/i.test(d)) return "MEM";
  if (/Monument/i.test(d)) return "NM";
  if (/Recreation Area|Seashore|Lakeshore/i.test(d)) return "REC";
  if (/River|Riverway/i.test(d)) return "RIV";
  if (/Trail/i.test(d)) return "TRL";
  if (/Parkway/i.test(d)) return "PKWY";
  if (/Preserve|Reserve/i.test(d)) return "PRES";
  return "OTH";
}

export function toRow(p) {
  const code = String(p.parkCode || "").toUpperCase();
  const states = String(p.states || "").split(",").map((s) => s.trim()).filter(Boolean);
  const lat = Number.parseFloat(p.latitude), lon = Number.parseFloat(p.longitude);
  const here = Number.isNaN(lat) ? null : stateAt(lon, lat);
  const st = (STATE_FIX[code] && states.includes(STATE_FIX[code]) && STATE_FIX[code])
    || (here && (states.includes(here) || !states.length) && here) || states[0] || "";
  if (!code || !p.fullName || !st || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  const row = [code, p.fullName.trim(), typeFor(p.designation, p.fullName), st, lat.toFixed(3), lon.toFixed(3)];
  if (NATIONAL_CAPITAL.has(code)) row.push("NC");
  return row;
}

// Fetches every park from the API. onProgress(done, total) is called after each page.
export async function fetchParks(key, onProgress) {
  const parks = [];
  for (let start = 0; ; start += 100) {
    const url = `https://developer.nps.gov/api/v1/parks?limit=100&start=${start}&fields=`;
    let res;
    try { res = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" } }); }
    catch { throw new Error("Couldn't reach the National Park Service. Check your connection and try again."); }
    if (res.status === 401 || res.status === 403) throw new Error("The NPS didn't accept that API key. Check it and try again.");
    if (res.status === 429) throw new Error("Too many requests with this key right now. Wait an hour and try again.");
    if (!res.ok) throw new Error(`The NPS answered with an error (${res.status}). Try again later.`);
    const body = await res.json();
    parks.push(...body.data);
    onProgress?.(parks.length, Number(body.total));
    if (parks.length >= Number(body.total) || body.data.length === 0) return parks;
  }
}

// Builds the sorted park list, plus what changed compared with the codes you had before.
export function buildList(parks, oldCodes = new Set()) {
  const rows = parks.map(toRow).filter(Boolean).sort((a, b) => a[3].localeCompare(b[3]) || a[1].localeCompare(b[1]));
  const newCodes = new Set(rows.map((r) => r[0]));
  return {
    rows,
    added: rows.filter((r) => oldCodes.size && !oldCodes.has(r[0])).map((r) => r[1]),
    removed: [...oldCodes].filter((c) => !newCodes.has(c)),
    skipped: parks.filter((p) => !toRow(p)).map((p) => p.fullName || p.parkCode),
  };
}
