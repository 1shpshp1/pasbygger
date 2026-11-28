-- For the tests only: the parts of Supabase that supabase/schema.sql builds on (the auth schema, auth.uid() and the
-- roles), so the schema can be tried on a plain PostgreSQL. The test sets request.jwt.claim.sub to act as a user.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
