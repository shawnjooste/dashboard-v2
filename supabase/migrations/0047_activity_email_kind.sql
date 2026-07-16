-- Activity feed also records outbound email (invites, onboarding, quotes,
-- admin alerts). kind 'email': profile_id stays null (system-sent), section
-- is the email category, detail is "subject → recipient".
alter table public.portal_activity drop constraint portal_activity_kind_check;
alter table public.portal_activity add constraint portal_activity_kind_check
  check (kind in ('visit','login','action','email'));
