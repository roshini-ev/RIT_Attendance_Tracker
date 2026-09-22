"""
Campus Geofencing Module for Rajalakshmi Institute of Technology (RIT).

Derived from RIT_Campus_Coordinates_Updated.pdf (KML bounding ranges).
The structure allows bounding-box checks to be replaced with 
point-in-polygon checks without modifying the rest of the application.
"""

# Format: Longitude X -> Y | Latitude A -> B
# Ordered by priority for overlapping boundary resolution
CAMPUS_ZONES = [
    {
        "name": "Canteen (Calcutta Box)",
        "lon_min": 80.0452012,
        "lon_max": 80.0453752,
        "lat_min": 13.0403335,
        "lat_max": 13.0405236,
    },
    {
        "name": "Canteen (Bill Counter)",
        "lon_min": 80.0453383,
        "lon_max": 80.0454868,
        "lat_min": 13.0399611,
        "lat_max": 13.0403701,
    },
    {
        "name": "Invisible Statue",
        "lon_min": 80.0449631,
        "lon_max": 80.0452458,
        "lat_min": 13.0396760,
        "lat_max": 13.0403240,
    },
    {
        "name": "Steve Jobs",
        "lon_min": 80.0445206,
        "lon_max": 80.0448954,
        "lat_min": 13.0395535,
        "lat_max": 13.0398507,
    },
    {
        "name": "Green Building",
        "lon_min": 80.0447137,
        "lon_max": 80.0450191,
        "lat_min": 13.0377332,
        "lat_max": 13.0381709,
    },
    {
        "name": "C-Block",
        "lon_min": 80.0454785,
        "lon_max": 80.0459096,
        "lat_min": 13.0388523,
        "lat_max": 13.0399281,
    },
    {
        "name": "B Block",
        "lon_min": 80.0448116,
        "lon_max": 80.0450932,
        "lat_min": 13.0386850,
        "lat_max": 13.0394490,
    },
    {
        "name": "A / Admin Block",
        "lon_min": 80.0452364,
        "lon_max": 80.0457732,
        "lat_min": 13.0381457,
        "lat_max": 13.0386539,
    },
]


def distance_to_zone_box(latitude: float, longitude: float, zone: dict) -> float:
    """
    Calculate the shortest distance in meters from (latitude, longitude)
    to the zone's bounding box (returns 0.0 if inside).
    """
    clamped_lat = max(zone["lat_min"], min(latitude, zone["lat_max"]))
    clamped_lon = max(zone["lon_min"], min(longitude, zone["lon_max"]))
    d_lat = (latitude - clamped_lat) * 111000.0
    d_lon = (longitude - clamped_lon) * 108000.0
    return (d_lat * d_lat + d_lon * d_lon) ** 0.5


def is_point_in_bounding_box(latitude: float, longitude: float, zone: dict) -> bool:
    """Check if latitude & longitude fall within the zone's bounding box."""
    return (
        zone["lon_min"] <= longitude <= zone["lon_max"]
        and zone["lat_min"] <= latitude <= zone["lat_max"]
    )


# Maximum indoor GPS drift tolerance in meters.
# When staff are inside classrooms, steel-roof labs, or corridors,
# phone GPS drifts by 5 to 25 meters. This ensures staff inside a block
# are correctly recognized instead of falsely marked 'Outside'.
INDOOR_DRIFT_TOLERANCE_METERS = 25.0


def detect_location(latitude: float, longitude: float) -> str:
    """
    Determine which campus block/place the person is inside.
    1. First checks for an exact hit inside the official KML bounding boxes.
    2. If slightly outside due to indoor smartphone GPS drift, finds the closest
       campus block within INDOOR_DRIFT_TOLERANCE_METERS (25 meters).
    3. If beyond 25m from any campus building, returns 'Outside'.
    """
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (ValueError, TypeError):
        return "Outside"

    # Pass 1: Exact bounding box match
    for zone in CAMPUS_ZONES:
        if is_point_in_bounding_box(lat, lon, zone):
            return zone["name"]

    # Pass 2: Nearest block within indoor GPS drift tolerance
    closest_zone = None
    min_distance = float("inf")

    for zone in CAMPUS_ZONES:
        dist = distance_to_zone_box(lat, lon, zone)
        if dist < min_distance:
            min_distance = dist
            closest_zone = zone

    if closest_zone and min_distance <= INDOOR_DRIFT_TOLERANCE_METERS:
        return closest_zone["name"]

    return "Outside"
