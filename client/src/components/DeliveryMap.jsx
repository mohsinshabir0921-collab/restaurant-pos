import { useMemo, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./delivery-map.css";

const isValidLat = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= -90 && num <= 90;
};

const isValidLng = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= -180 && num <= 180;
};

const MARKER_KINDS = {
  destination: "delivery-map-pin-destination",
  boy: "delivery-map-pin-boy",
  default: "delivery-map-pin-default",
};

const makeIcon = (kind) =>
  L.divIcon({
    className: "delivery-map-marker",
    html: `<div class="delivery-map-pin ${MARKER_KINDS[kind] || MARKER_KINDS.default}"><span class="delivery-map-pin-dot"></span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });

// Fits the viewport once when markers are first added. Re-fit only when a brand
// new marker appears (e.g. the delivery boy gets their first GPS fix) so the map
// does not jump around as an existing marker moves between polls.
function FitBounds({ points }) {
  const map = useMap();
  const lastCount = useRef(0);

  useEffect(() => {
    if (!points.length) return;
    if (points.length > lastCount.current) {
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 14);
      } else {
        map.fitBounds(
          L.latLngBounds(points.map((p) => [p.lat, p.lng])),
          { padding: [44, 44] }
        );
      }
    }
    lastCount.current = points.length;
  }, [map, points]);

  return null;
}

export default function DeliveryMap({
  destination,
  positions = [],
  height = 360,
  fallback = "Location is not available for this delivery yet.",
}) {
  const points = useMemo(() => {
    const list = [];
    if (
      destination &&
      isValidLat(destination.latitude) &&
      isValidLng(destination.longitude)
    ) {
      list.push({
        lat: Number(destination.latitude),
        lng: Number(destination.longitude),
        kind: "destination",
        label: destination.label || "Delivery destination",
      });
    }
    for (const p of positions) {
      if (p && isValidLat(p.lat) && isValidLng(p.lng)) {
        list.push({
          lat: Number(p.lat),
          lng: Number(p.lng),
          kind: p.kind || "default",
          label: p.label,
        });
      }
    }
    return list;
  }, [destination, positions]);

  if (points.length === 0) {
    return (
      <div className="delivery-map-fallback" style={{ minHeight: height }}>
        <span className="delivery-map-fallback-icon" aria-hidden="true">🗺️</span>
        <p>{fallback}</p>
      </div>
    );
  }

  return (
    <div className="delivery-map-wrap" style={{ height }}>
      <MapContainer
        className="delivery-map"
        center={[points[0].lat, points[0].lng]}
        zoom={14}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p, i) => (
          <Marker
            key={`${p.kind}-${i}`}
            position={[p.lat, p.lng]}
            icon={makeIcon(p.kind)}
          >
            {p.label && <Popup>{p.label}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}