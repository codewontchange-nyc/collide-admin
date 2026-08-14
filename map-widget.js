import { useEffect, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { html } from "./ui.js";

/* Leaflet lazy-loads from CDN (no build, no API key) with clean CARTO tiles —
   the same pattern as the peaches map. One loader promise, shared by every
   map instance on the page. */
const TILE = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
const ATTR = '&copy; OpenStreetMap &copy; CARTO';
let leafletP = null;
export function loadLeaflet() {
  if (leafletP) return leafletP;
  leafletP = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return leafletP;
}

const pinIcon = (L, color) =>
  L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  });

/* pins: [{lat,lng,label,color}] — POIs teal, events pink (callers choose).
   onPick: enables click-to-place; the picked location gets a marker + callback. */
export function MapView({ pins = [], onPick, picked, className = "lmap", center }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pickMarker = useRef(null);

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      map.current = L.map(el.current, { scrollWheelZoom: true, zoomControl: true });
      L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      map.current.setView(center || [36.5, -119.5], center ? 11 : 6);   // default: California
      if (onPick) map.current.on("click", (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }));
      renderPins(L);
    }).catch(() => {});
    return () => { dead = true; try { map.current?.remove(); } catch {} map.current = null; };
  }, []);

  const renderPins = (L) => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts = [];
    for (const p of pins) {
      if (p.lat == null || p.lng == null) continue;
      L.marker([p.lat, p.lng], { icon: pinIcon(L, p.color || "#219a8f") })
        .bindTooltip(p.label || "", { direction: "top", offset: [0, -8] })
        .addTo(layer.current);
      pts.push([p.lat, p.lng]);
    }
    if (pickMarker.current) { try { layer.current.addLayer(pickMarker.current); } catch {} }
    if (pts.length && !onPick) {
      try { map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); } catch {}
    }
  };

  useEffect(() => { loadLeaflet().then(renderPins).catch(() => {}); }, [JSON.stringify(pins)]);

  useEffect(() => {
    if (!picked) return;
    loadLeaflet().then((L) => {
      if (!map.current) return;
      if (pickMarker.current) try { layer.current.removeLayer(pickMarker.current); } catch {}
      pickMarker.current = L.marker([picked.lat, picked.lng], { icon: pinIcon(L, "#17181a") }).addTo(layer.current);
    }).catch(() => {});
  }, [picked?.lat, picked?.lng]);

  return html`<div ref=${el} class=${className}></div>`;
}
