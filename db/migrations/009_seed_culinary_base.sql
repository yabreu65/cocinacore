-- Migration 009: Seed culinary taxonomy (dimensions and terms)
-- Replace or extend this seed with the full taxonomy as needed.

insert into public.culinary_dimensions (id, key, label, sort_order) values
    ('11111111-1111-1111-1111-111111111111', 'cuisine', 'Cocina', 1),
    ('22222222-2222-2222-2222-222222222222', 'dietary', 'Restricciones y dietas', 2),
    ('33333333-3333-3333-3333-333333333333', 'technique', 'Técnica', 3),
    ('44444444-4444-4444-4444-444444444444', 'ingredient_type', 'Tipo de ingrediente', 4),
    ('55555555-5555-5555-5555-555555555555', 'goal', 'Objetivo', 5)
on conflict (id) do update set
    key = excluded.key,
    label = excluded.label,
    sort_order = excluded.sort_order;

insert into public.culinary_terms (id, dimension_id, label, is_active) values
    -- Cuisine
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Argentina', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', '11111111-1111-1111-1111-111111111111', 'Italiana', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', '11111111-1111-1111-1111-111111111111', 'Mexicana', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaad', '11111111-1111-1111-1111-111111111111', 'Asiática', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaae', '11111111-1111-1111-1111-111111111111', 'Mediterránea', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaf', '11111111-1111-1111-1111-111111111111', 'Vegetariana', true),

    -- Dietary
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Sin TACC', true),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc', '22222222-2222-2222-2222-222222222222', 'Vegano', true),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbd', '22222222-2222-2222-2222-222222222222', 'Bajo en sodio', true),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbe', '22222222-2222-2222-2222-222222222222', 'Sin lactosa', true),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbf', '22222222-2222-2222-2222-222222222222', 'Keto', true),

    -- Technique
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'Ahumado', true),
    ('cccccccc-cccc-cccc-cccc-cccccccccccd', '33333333-3333-3333-3333-333333333333', 'Fermentación', true),
    ('cccccccc-cccc-cccc-cccc-ccccccccccce', '33333333-3333-3333-3333-333333333333', 'Sous vide', true),
    ('cccccccc-cccc-cccc-cccc-cccccccccccf', '33333333-3333-3333-3333-333333333333', 'Cocción lenta', true),

    -- Ingredient type
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', 'Proteína', true),
    ('dddddddd-dddd-dddd-dddd-ddddddddddde', '44444444-4444-4444-4444-444444444444', 'Vegetal', true),
    ('dddddddd-dddd-dddd-dddd-dddddddddddf', '44444444-4444-4444-4444-444444444444', 'Carbohidrato', true),
    ('dddddddd-dddd-dddd-dddd-ddddddddddda', '44444444-4444-4444-4444-444444444444', 'Lácteo', true),

    -- Goal
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '55555555-5555-5555-5555-555555555555', 'Bajar de peso', true),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef', '55555555-5555-5555-5555-555555555555', 'Ganar músculo', true),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeed', '55555555-5555-5555-5555-555555555555', 'Ahorrar tiempo', true),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeec', '55555555-5555-5555-5555-555555555555', 'Reducir desperdicio', true)
on conflict (id) do update set
    dimension_id = excluded.dimension_id,
    label = excluded.label,
    is_active = excluded.is_active;
