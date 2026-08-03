-- Not every path is a straight line. Two routers hanging off the same Mikrotik
-- are one *step* with two legs, not two steps: losing one must not read as an
-- outage of everything after it. A hop flagged parallel_with_previous joins the
-- step before it rather than starting a new one.
--
-- Only sibling grouping is modelled, not arbitrary trees — the shapes we
-- actually sell are chains with the occasional redundant pair, and a general
-- graph would cost far more to render honestly than it would ever earn.
alter table public.connectivity_path_hops
  add column parallel_with_previous boolean not null default false;

comment on column public.connectivity_path_hops.parallel_with_previous is
  'True when this hop shares an upstream with the preceding hop (same step, redundant leg) rather than following it.';
