-- Only the owner email becomes admin automatically; everyone else is a plain user.
create or replace function public.handle_new_user_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_roles(user_id, role) values (new.id, 'user') on conflict do nothing;
  if lower(new.email) = 'sanchit@yeti-dresden.org' then
    insert into public.user_roles(user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end $$;

-- If the owner already has an account, make it admin now.
insert into public.user_roles(user_id, role)
select id, 'admin'::public.app_role from auth.users where lower(email) = 'sanchit@yeti-dresden.org'
on conflict do nothing;