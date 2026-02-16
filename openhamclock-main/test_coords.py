# Test coordinate wrapping for Kamchatka, Russia
# Kamchatka is around: 56°N, 162°E

lat = 56.0  # Correct latitude
lon = 162.0  # Correct longitude (Eastern hemisphere)

print(f"Kamchatka, Russia:")
print(f"  Correct coordinates: lat={lat}, lon={lon}")
print(f"  Leaflet marker: L.marker([{lat}, {lon}])")
print(f"  This should plot in: Eastern Russia (Kamchatka Peninsula)")
print()

# What if longitude is negative?
lon_neg = -162.0
print(f"If longitude was negative:")
print(f"  L.marker([{lat}, {lon_neg}])")
print(f"  This would plot in: Western Alaska (near Bering Strait)")
print()

# Peru example
peru_lat = -15.6
peru_lon = -70.6
print(f"Peru earthquake:")
print(f"  Correct coordinates: lat={peru_lat}, lon={peru_lon}")
print(f"  Leaflet marker: L.marker([{peru_lat}, {peru_lon}])")
print(f"  This should plot in: Peru, South America")
