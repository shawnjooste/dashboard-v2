-- A short technical line under each hop on the path graphic, e.g.
-- "MZB-EDGE-04 · sector B3" or "LHG-5 radio · 41.76.212.44". Staff-entered:
-- whatever shows here has to be something we actually know, so it is nullable
-- and simply omitted when blank.
alter table public.connectivity_path_hops add column detail text;
