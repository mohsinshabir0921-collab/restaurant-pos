const Settings = require("../models/Settings");

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Great-circle (straight-line) distance between two coordinates using the
// Haversine formula. The public website treats delivery distance in km as a
// straight-line measure, so this preserves the existing pricing intent without
// relying on an external routing/maps API.
const haversineDistanceKm = (latitude1, longitude1, latitude2, longitude2) => {
  const dLat = toRadians(latitude2 - latitude1);
  const dLng = toRadians(longitude2 - longitude1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latitude1)) *
      Math.cos(toRadians(latitude2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

const isValidLatitude = (value) =>
  Number.isFinite(value) && value >= -90 && value <= 90;

const isValidLongitude = (value) =>
  Number.isFinite(value) && value >= -180 && value <= 180;

// Progressive website delivery pricing:
//   First 5 km: ₹10/km, then ₹15/km beyond (progressive).
//   3 km = 30, 5 km = 50, 6 km = 65, 8 km = 95, 10 km = 125.
const calculateDeliveryFee = (distanceKm) => {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const fee = Math.min(km, 5) * 10 + Math.max(0, km - 5) * 15;
  return Math.round(fee);
};

// Restaurant coordinates are configured through the Settings collection
// (admin → Settings → Restaurant). Returns null when not configured so
// callers can decide how to respond. Coordinates are never hardcoded here.
const getRestaurantCoordinates = async () => {
  const [latitude, longitude] = await Promise.all([
    Settings.getValue("restaurant_latitude", null),
    Settings.getValue("restaurant_longitude", null),
  ]);
  if (latitude == null || longitude == null) return null;
  if (String(latitude).trim() === "" || String(longitude).trim() === "") return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  return { latitude: lat, longitude: lng };
};

// Configurable base/minimum delivery fee. Admins set `delivery_fee` in
// Settings; it acts as a floor so the final fee is never below this amount,
// while the distance-based progressive fee still applies for longer distances.
// A value of 0 (the default) preserves the existing pure distance-based pricing
// and is not surfaced as a separate "flat fee".
const getBaseDeliveryFee = async () => {
  const value = await Settings.getValue("delivery_fee", 0);
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Pure distance + fee calculation for known customer and restaurant
// coordinates. Kept separate from the validation/loading so it can be shared
// by the estimate endpoint and reused in tests.
const computeDeliveryDistanceAndFee = (customerLatitude, customerLongitude, restaurant) => {
  const distanceKm =
    Math.round(
      haversineDistanceKm(
        customerLatitude,
        customerLongitude,
        restaurant.latitude,
        restaurant.longitude
      ) * 100
    ) / 100;
  return { distanceKm, deliveryFee: calculateDeliveryFee(distanceKm) };
};

// Computes the authoritative delivery distance and fee for a delivery order.
// Only the customer's coordinates are accepted from the client; the distance
// is always calculated server-side against the restaurant's configured
// location, so a customer cannot tamper with the distance or the delivery fee.
const computeDeliveryFeeForOrder = async ({ latitude, longitude }) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    const error = new Error("A valid delivery location is required to calculate the delivery fee");
    error.status = 400;
    throw error;
  }

  const restaurant = await getRestaurantCoordinates();
  if (!restaurant) {
    const error = new Error(
      "Delivery is unavailable because the restaurant has not configured its location"
    );
    error.status = 400;
    throw error;
  }

  const baseFee = await getBaseDeliveryFee();
  const delivery = computeDeliveryDistanceAndFee(lat, lng, restaurant);
  return {
    distanceKm: delivery.distanceKm,
    deliveryFee: Math.max(baseFee, delivery.deliveryFee),
  };
};

module.exports = {
  haversineDistanceKm,
  calculateDeliveryFee,
  getRestaurantCoordinates,
  getBaseDeliveryFee,
  computeDeliveryDistanceAndFee,
  computeDeliveryFeeForOrder,
  isValidLatitude,
  isValidLongitude,
};