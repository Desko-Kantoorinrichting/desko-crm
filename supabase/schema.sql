-- Desko CRM — database-opzet voor Supabase
-- Plak dit hele bestand in Supabase: SQL Editor → New query → Run.
-- Het is veilig om dit nog een keer te draaien.

-- 1. Alle CRM-gegevens: één rij per document (bedrijf, activiteit, deal, ...)
create table if not exists public.documenten (
  collection      text        not null,
  id              text        not null,
  data            jsonb       not null default '{}'::jsonb,
  aangemaakt_op   timestamptz not null default now(),
  bijgewerkt_op   timestamptz not null default now(),
  bijgewerkt_door uuid        default auth.uid(),
  primary key (collection, id)
);
create index if not exists documenten_bedrijf_idx
  on public.documenten ((data->>'bedrijfId'))
  where collection in ('activiteiten', 'deals');

-- Realtime: volledige oude rij meesturen, zodat ook verwijderingen doorkomen.
alter table public.documenten replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.documenten;
exception when duplicate_object then null; end $$;

-- 2. Toegang: alleen ingelogde gebruikers. Wie mag inloggen, bepaal je in
--    Authentication → Users (nieuwe aanmeldingen staan uit, zie README).
alter table public.documenten enable row level security;
drop policy if exists "ingelogd lezen"    on public.documenten;
drop policy if exists "ingelogd schrijven" on public.documenten;
create policy "ingelogd lezen"    on public.documenten for select to authenticated using (true);
create policy "ingelogd schrijven" on public.documenten for all    to authenticated using (true) with check (true);

-- 3. Velden samenvoegen in een bestaand document (gebruikt door de app).
create or replace function public.doc_merge(p_collection text, p_id text, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.documenten set data = data || p_patch
   where collection = p_collection and id = p_id;
  if not found then raise exception 'Document %/% bestaat niet', p_collection, p_id; end if;
end $$;

create or replace function public.documenten_stempel()
returns trigger language plpgsql as $$
begin
  new.bijgewerkt_op := now();
  new.bijgewerkt_door := auth.uid();
  return new;
end $$;
drop trigger if exists documenten_stempel on public.documenten;
create trigger documenten_stempel before update on public.documenten
  for each row execute function public.documenten_stempel();

-- 4. Wijzigingslog: wie, wat, wanneer (alleen de gewijzigde velden).
create table if not exists public.wijzigingslog (
  id          bigint generated always as identity primary key,
  op          timestamptz not null default now(),
  gebruiker   uuid,
  email       text,
  actie       text not null,
  collection  text not null,
  doc_id      text not null,
  oud         jsonb,
  nieuw       jsonb
);
alter table public.wijzigingslog enable row level security;
drop policy if exists "ingelogd lezen" on public.wijzigingslog;
create policy "ingelogd lezen" on public.wijzigingslog for select to authenticated using (true);

create or replace function public.log_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_oud jsonb; v_nieuw jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, value) into v_nieuw from jsonb_each(new.data) n where n.value is distinct from old.data -> n.key;
    select jsonb_object_agg(key, value) into v_oud   from jsonb_each(old.data) o where o.value is distinct from new.data -> o.key;
    if v_nieuw is null and v_oud is null then return null; end if;
  elsif tg_op = 'INSERT' then v_nieuw := new.data;
  else v_oud := old.data;
  end if;
  insert into public.wijzigingslog (gebruiker, email, actie, collection, doc_id, oud, nieuw)
  values (auth.uid(), auth.jwt() ->> 'email', lower(tg_op),
          coalesce(new.collection, old.collection), coalesce(new.id, old.id), v_oud, v_nieuw);
  return null;
end $$;
drop trigger if exists documenten_log on public.documenten;
create trigger documenten_log after insert or update or delete on public.documenten
  for each row execute function public.log_wijziging();
