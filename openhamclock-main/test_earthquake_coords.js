// Test to understand the coordinate flow

// Sample Dominican Republic earthquake from USGS
const geojsonData = {
  geometry: {
    coordinates: [-68.625, 18.0365, 75.0]  // [lon, lat, depth] - GeoJSON format
  },
  properties: {
    place: "37 km S of Boca de Yuma, Dominican Republic"
  }
};

// Current code extraction
const coords = geojsonData.geometry.coordinates;
const lat = coords[1];  // 18.0365
const lon = coords[0];  // -68.625

console.log("GeoJSON coordinates:", coords);
console.log("Extracted lat:", lat, "(should be 18.0365)");
console.log("Extracted lon:", lon, "(should be -68.625)");
console.log("");
console.log("If we call L.marker([lat, lon]):");
console.log("  L.marker([" + lat + ", " + lon + "])");
console.log("  This should plot at: 18.0365°N, 68.625°W (Dominican Republic)");
console.log("");
console.log("If we call L.marker([lon, lat]):");
console.log("  L.marker([" + lon + ", " + lat + "])");
console.log("  This would plot at: -68.625°S, 18.0365°E (Indian Ocean!)");
