-- One open connectivity enquiry per client, enforced by the database.
--
-- The portal's enquiry action checked for an existing open enquiry and then
-- inserted — two round trips with nothing between them. Concurrent submits
-- (a double-click, or a deliberate burst against the server action endpoint)
-- all pass the check before any insert lands, so the check bought nothing.
-- The database is the only thing that can arbitrate this.
--
-- Deliberately scoped to portal-raised enquiries by their generated title, so
-- the admin RFQ board keeps its existing freedom to create whatever it likes.

create unique index if not exists rfqs_one_open_connectivity_enquiry
  on public.rfqs (client_id)
  where status = 'new'
    and client_id is not null
    and title like 'Connectivity enquiry — %';
