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
        "name": "C Block",
        "lon_min": 80.0454785,
        "lon_max": 80.0459096,
        "lat_min": 13.0388561,
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
        "lon_min": 80.0452290,
        "lon_max": 80.0457286,
        "lat_min": 13.0381506,
        "lat_max": 13.0386278,
    },
]


def is_point_in_bounding_box(latitude: float, longitude: float, zone: dict) -> bool:
    """Check if latitude & longitude fall within the zone's bounding box."""
    return (
        zone["lon_min"] <= longitude <= zone["lon_max"]
        and zone["lat_min"] <= latitude <= zone["lat_max"]
    )


def detect_location(latitude: float, longitude: float) -> str:
    """
    Determine which campus block/place the person is inside.
    If the coordinates fall inside one of the defined campus areas,
    returns that place name. Otherwise returns 'Outside'.
    """
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (ValueError, TypeError):
        return "Outside"

    for zone in CAMPUS_ZONES:
        if is_point_in_bounding_box(lat, lon, zone):
            return zone["name"]

    return "Outside"
