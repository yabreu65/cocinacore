-- Migration 013: bounded household culinary context.

alter table public.user_culinary_profiles
    add column available_time_minutes integer null
        check (available_time_minutes is null or available_time_minutes between 5 and 240),
    add column disliked_ingredients text[] not null default '{}',
    add column allergies text[] not null default '{}',
    add column household_members jsonb not null default '[]'::jsonb
        check (jsonb_typeof(household_members) = 'array'
            and jsonb_array_length(household_members) <= 12);
