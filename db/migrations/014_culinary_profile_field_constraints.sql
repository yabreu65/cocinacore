-- Migration 014: fail-closed culinary profile bounds and serialized term-group caps.

create or replace function public.is_valid_culinary_profile_text_list(p_values text[], max_items integer)
returns boolean
language sql
immutable
strict
as $$
    select cardinality(p_values) <= max_items
       and not exists (
           select 1
             from unnest(p_values) as item(value)
            where item.value is null
               or char_length(btrim(item.value)) > 80
       );
$$;

create or replace function public.is_valid_culinary_household_members(members jsonb)
returns boolean
language sql
immutable
strict
as $$
    select case
        when jsonb_typeof(members) <> 'array' then false
        else jsonb_array_length(members) <= 12
         and not exists (
             select 1
               from jsonb_array_elements(members) as entry(value)
              where case
                  when jsonb_typeof(entry.value) <> 'object' then true
                  else (select count(*) from jsonb_object_keys(entry.value)) <> 2
                    or not (entry.value ? 'name')
                    or not (entry.value ? 'ageGroup')
                    or jsonb_typeof(entry.value -> 'name') <> 'string'
                    or char_length(btrim(entry.value ->> 'name')) not between 1 and 60
                    or jsonb_typeof(entry.value -> 'ageGroup') <> 'string'
                    or entry.value ->> 'ageGroup' not in ('adult', 'teen', 'child')
              end
         )
    end;
$$;

alter table public.users
    add constraint users_full_name_length_check
    check (full_name is null or char_length(full_name) <= 120);

alter table public.user_culinary_profiles
    add constraint user_culinary_profiles_level_check
    check (level is null or level in ('Principiante', 'Intermedio', 'Chef')),
    add constraint user_culinary_profiles_allergies_bounds_check
    check (public.is_valid_culinary_profile_text_list(allergies, 20)),
    add constraint user_culinary_profiles_disliked_ingredients_bounds_check
    check (public.is_valid_culinary_profile_text_list(disliked_ingredients, 20)),
    add constraint user_culinary_profiles_household_members_shape_check
    check (public.is_valid_culinary_household_members(household_members));

-- Report any pre-existing aggregate violations before installing enforcement.
do $$
declare
    violation record;
begin
    select profiles.user_id, dimensions.key as dimension_key, count(*) as term_count,
           case dimensions.key
               when 'cuisine' then 6
               when 'dietary' then 12
               when 'technique' then 8
               when 'ingredient_type' then 8
               when 'goal' then 6
           end as term_limit
      into violation
      from public.user_culinary_profile_terms as profiles
      join public.culinary_terms as terms on terms.id = profiles.term_id
      join public.culinary_dimensions as dimensions on dimensions.id = terms.dimension_id
     where dimensions.key in ('cuisine', 'dietary', 'technique', 'ingredient_type', 'goal')
     group by profiles.user_id, dimensions.key
    having count(*) > case dimensions.key
               when 'cuisine' then 6
               when 'dietary' then 12
               when 'technique' then 8
               when 'ingredient_type' then 8
               when 'goal' then 6
           end
     limit 1;

    if found then
        raise exception 'Existing culinary profile term group violates limit: user %, dimension %, count %, limit %',
            violation.user_id, violation.dimension_key, violation.term_count, violation.term_limit;
    end if;
end;
$$;

create or replace function public.enforce_culinary_profile_term_group_limit()
returns trigger
language plpgsql
security invoker
as $$
declare
    user_id uuid;
    target_dimension text;
    group_limit integer;
    existing_count integer;
begin
    for user_id in
        select distinct locked_user_id
          from unnest(array[case when tg_op = 'UPDATE' then old.user_id else null end, new.user_id])
               as lock_users(locked_user_id)
         where locked_user_id is not null
         order by locked_user_id
    loop
        perform pg_advisory_xact_lock(hashtextextended('culinary-profile:' || user_id::text, 0));
    end loop;

    perform pg_advisory_xact_lock(hashtextextended('culinary-profile-taxonomy', 0));

    select dimensions.key
      into target_dimension
      from public.culinary_terms as terms
      join public.culinary_dimensions as dimensions on dimensions.id = terms.dimension_id
     where terms.id = new.term_id;

    group_limit := case target_dimension
        when 'cuisine' then 6
        when 'dietary' then 12
        when 'technique' then 8
        when 'ingredient_type' then 8
        when 'goal' then 6
        else null
    end;

    if group_limit is not null then
        select count(*)::integer
          into existing_count
          from public.user_culinary_profile_terms as profile_terms
          join public.culinary_terms as terms on terms.id = profile_terms.term_id
          join public.culinary_dimensions as dimensions on dimensions.id = terms.dimension_id
         where profile_terms.user_id = new.user_id
           and dimensions.key = target_dimension;

        if tg_op = 'UPDATE' and old.user_id = new.user_id and exists (
            select 1
              from public.culinary_terms as old_terms
              join public.culinary_dimensions as old_dimensions on old_dimensions.id = old_terms.dimension_id
             where old_terms.id = old.term_id
               and old_dimensions.key = target_dimension
        ) then
            existing_count := existing_count - 1;
        end if;

        if existing_count + 1 > group_limit then
            raise exception 'Culinary profile term group limit exceeded: user %, dimension %, limit %',
                new.user_id, target_dimension, group_limit;
        end if;
    end if;

    return new;
end;
$$;

create trigger user_culinary_profile_terms_group_limit_trigger
before insert or update on public.user_culinary_profile_terms
for each row execute function public.enforce_culinary_profile_term_group_limit();

create or replace function public.prevent_culinary_profile_taxonomy_reclassification()
returns trigger
language plpgsql
security invoker
as $$
begin
    perform pg_advisory_xact_lock(hashtextextended('culinary-profile-taxonomy', 0));

    if tg_table_name = 'culinary_terms' then
        if new.dimension_id is distinct from old.dimension_id
           and exists (
               select 1
                 from public.user_culinary_profile_terms as profile_terms
                where profile_terms.term_id = old.id
           ) then
            raise exception 'Cannot reclassify culinary term % while selected by a profile', old.id;
        end if;
    elsif tg_table_name = 'culinary_dimensions' then
        if new.key is distinct from old.key
           and exists (
               select 1
                 from public.culinary_terms as terms
                 join public.user_culinary_profile_terms as profile_terms on profile_terms.term_id = terms.id
                where terms.dimension_id = old.id
           ) then
            raise exception 'Cannot rename culinary dimension % while selected by a profile', old.id;
        end if;
    else
        raise exception 'Unexpected trigger table for culinary taxonomy reclassification: %', tg_table_name;
    end if;

    return new;
end;
$$;

create trigger culinary_terms_profile_dimension_immutable_trigger
before update of dimension_id on public.culinary_terms
for each row execute function public.prevent_culinary_profile_taxonomy_reclassification();

create trigger culinary_dimensions_profile_key_immutable_trigger
before update of key on public.culinary_dimensions
for each row execute function public.prevent_culinary_profile_taxonomy_reclassification();
