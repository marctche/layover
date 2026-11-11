-- Coordinates for a destination, copied from the city search when the city is added.
-- The engine uses them to estimate legs nobody has priced. Nullable: older and free-text
-- destinations have none, and their unpriced legs are then pruned instead of estimated.
alter table public.destinations
  add column lat double precision,
  add column lng double precision,
  add constraint destinations_lat_range check (lat is null or lat between -90 and 90),
  add constraint destinations_lng_range check (lng is null or lng between -180 and 180),
  add constraint destinations_coords_together check ((lat is null) = (lng is null));
