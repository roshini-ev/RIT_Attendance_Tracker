/**
 * Campus Geofencing Module for Rajalakshmi Institute of Technology (RIT).
 * 
 * Modular architecture: coordinate ranges from KML bounding boxes can easily
 * be swapped for point-in-polygon checks without modifying the rest of the application.
 */

export interface CampusZone {
  name: string;
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  // Optional polygon coordinates [[lon, lat], ...] for future precise point-in-polygon
  polygon?: [number, number][];
}

/**
 * Campus coordinate ranges in priority order for overlapping boundary resolution.
 * Coordinate format: Longitude X -> Y | Latitude A -> B
 */
export const CAMPUS_ZONES: CampusZone[] = [
  {
    name: 'Canteen (Calcutta Box)',
    lonMin: 80.0452012,
    lonMax: 80.0453752,
    latMin: 13.0403335,
    latMax: 13.0405236,
  },
  {
    name: 'Canteen (Bill Counter)',
    lonMin: 80.0453383,
    lonMax: 80.0454868,
    latMin: 13.0399611,
    latMax: 13.0403701,
  },
  {
    name: 'Invisible Statue',
    lonMin: 80.0449631,
    lonMax: 80.0452458,
    latMin: 13.0396760,
    latMax: 13.0403240,
  },
  {
    name: 'Steve Jobs',
    lonMin: 80.0445206,
    lonMax: 80.0448954,
    latMin: 13.0395535,
    latMax: 13.0398507,
  },
  {
    name: 'Green Building',
    lonMin: 80.0447137,
    lonMax: 80.0450191,
    latMin: 13.0377332,
    latMax: 13.0381709,
  },
  {
    name: 'C Block',
    lonMin: 80.0454785,
    lonMax: 80.0459096,
    latMin: 13.0388561,
    latMax: 13.0399281,
  },
  {
    name: 'B Block',
    lonMin: 80.0448116,
    lonMax: 80.0450932,
    latMin: 13.0386850,
    latMax: 13.0394490,
  },
  {
    name: 'A / Admin Block',
    lonMin: 80.0452290,
    lonMax: 80.0457286,
    latMin: 13.0381506,
    latMax: 13.0386278,
  },
];

/**
 * Checks if a point falls within a bounding box.
 */
export function isPointInBoundingBox(
  latitude: number,
  longitude: number,
  zone: CampusZone
): boolean {
  return (
    longitude >= zone.lonMin &&
    longitude <= zone.lonMax &&
    latitude >= zone.latMin &&
    latitude <= zone.latMax
  );
}

/**
 * Main geofencing detection function.
 * Matches coordinates against defined campus zones.
 * Returns the detected location string, or 'Outside'.
 */
export function detectLocation(latitude: number, longitude: number): string {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
    return 'Outside';
  }

  for (const zone of CAMPUS_ZONES) {
    if (isPointInBoundingBox(latitude, longitude, zone)) {
      return zone.name;
    }
  }

  return 'Outside';
}
