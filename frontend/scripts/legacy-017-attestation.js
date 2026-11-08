'use strict';

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const SIGNATURE = deepFreeze(
  Object.freeze({
    columns: Object.freeze([
      ['shopping_list_items.transfer_inventory_item_id', 'uuid', false, ''],
      ['shopping_list_items.transferred_at', 'timestamp with time zone', false, ''],
      ['user_culinary_profiles.allergies', 'text[]', true, "'{}'::text[]"],
      ['user_culinary_profiles.available_time_minutes', 'integer', false, ''],
      ['user_culinary_profiles.disliked_ingredients', 'text[]', true, "'{}'::text[]"],
      ['user_culinary_profiles.household_members', 'jsonb', true, "'[]'::jsonb"],
      ['user_meal_plans.consumption_payload', 'jsonb', true, "'{}'::jsonb"],
      ['user_recipes.archived_at', 'timestamp with time zone', false, ''],
    ]),
    constraints: Object.freeze([
      [
        'shopping_list_items.shopping_list_items_transfer_marker_pair_check',
        'c',
        true,
        'CHECK (((transfer_inventory_item_id IS NULL) = (transferred_at IS NULL)))',
      ],
      [
        'user_culinary_profiles.user_culinary_profiles_allergies_bounds_check',
        'c',
        true,
        'CHECK (is_valid_culinary_profile_text_list(allergies, 20))',
      ],
      [
        'user_culinary_profiles.user_culinary_profiles_available_time_minutes_check',
        'c',
        true,
        'CHECK (((available_time_minutes IS NULL) OR ((available_time_minutes >= 5) AND (available_time_minutes <= 240))))',
      ],
      [
        'user_culinary_profiles.user_culinary_profiles_disliked_ingredients_bounds_check',
        'c',
        true,
        'CHECK (is_valid_culinary_profile_text_list(disliked_ingredients, 20))',
      ],
      [
        'user_culinary_profiles.user_culinary_profiles_household_members_check',
        'c',
        true,
        "CHECK (((jsonb_typeof(household_members) = 'array'::text) AND (jsonb_array_length(household_members) <= 12)))",
      ],
      [
        'user_culinary_profiles.user_culinary_profiles_household_members_shape_check',
        'c',
        true,
        'CHECK (is_valid_culinary_household_members(household_members))',
      ],
      [
        'users.users_email_canonical_check',
        'c',
        true,
        "CHECK (((email = lower(btrim(email))) AND (email <> ''::text)))",
      ],
      [
        'users.users_full_name_length_check',
        'c',
        true,
        'CHECK (((full_name IS NULL) OR (char_length(full_name) <= 120)))',
      ],
      ['user_recipes.user_recipes_pkey', 'p', true, 'PRIMARY KEY (id)'],
      [
        'user_recipes.user_recipes_tenant_id_fkey',
        'f',
        true,
        'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
      ],
      [
        'user_recipes.user_recipes_user_id_fkey',
        'f',
        true,
        'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
      ],
      [
        'user_recipes.user_recipes_tenant_user_membership_fkey',
        'f',
        true,
        'FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE',
      ],
      [
        'user_recipes.user_recipes_id_tenant_id_user_id_key',
        'u',
        true,
        'UNIQUE (id, tenant_id, user_id)',
      ],
      [
        'user_recipes.user_recipes_tags_bounds_check',
        'c',
        true,
        'CHECK (((cardinality(tags) <= 20) AND (array_position(tags, NULL::text) IS NULL)))',
      ],
      ['user_recipe_versions.user_recipe_versions_pkey', 'p', true, 'PRIMARY KEY (id)'],
      [
        'user_recipe_versions.user_recipe_versions_version_number_check',
        'c',
        true,
        'CHECK ((version_number > 0))',
      ],
      [
        'user_recipe_versions.user_recipe_versions_title_nonempty_check',
        'c',
        true,
        'CHECK ((length(btrim(title)) > 0))',
      ],
      [
        'user_recipe_versions.user_recipe_versions_servings_check',
        'c',
        true,
        'CHECK (((servings IS NULL) OR (servings > 0)))',
      ],
      [
        'user_recipe_versions.user_recipe_versions_ingredients_array_check',
        'c',
        true,
        "CHECK ((jsonb_typeof(ingredients) = 'array'::text))",
      ],
      [
        'user_recipe_versions.user_recipe_versions_recipe_id_version_number_key',
        'u',
        true,
        'UNIQUE (recipe_id, version_number)',
      ],
      [
        'user_recipe_versions.user_recipe_versions_recipe_owner_fkey',
        'f',
        true,
        'FOREIGN KEY (recipe_id, tenant_id, user_id) REFERENCES user_recipes(id, tenant_id, user_id) ON DELETE CASCADE',
      ],
      [
        'user_recipe_versions.user_recipe_versions_source_recipe_history_id_fkey',
        'f',
        true,
        'FOREIGN KEY (source_recipe_history_id) REFERENCES recipe_ai_history(id) ON DELETE SET NULL',
      ],
    ]),
    indexes: Object.freeze([
      [
        'idx_user_recipe_versions_recipe_id',
        true,
        true,
        'CREATE INDEX idx_user_recipe_versions_recipe_id ON public.user_recipe_versions USING btree (recipe_id)',
      ],
      [
        'idx_user_recipe_versions_tenant_id',
        true,
        true,
        'CREATE INDEX idx_user_recipe_versions_tenant_id ON public.user_recipe_versions USING btree (tenant_id)',
      ],
      [
        'idx_user_recipe_versions_user_id',
        true,
        true,
        'CREATE INDEX idx_user_recipe_versions_user_id ON public.user_recipe_versions USING btree (user_id)',
      ],
      [
        'idx_user_recipes_tenant_id',
        true,
        true,
        'CREATE INDEX idx_user_recipes_tenant_id ON public.user_recipes USING btree (tenant_id)',
      ],
      [
        'idx_user_recipes_tenant_user_archived_at',
        true,
        true,
        'CREATE INDEX idx_user_recipes_tenant_user_archived_at ON public.user_recipes USING btree (tenant_id, user_id, archived_at)',
      ],
      [
        'idx_user_recipes_user_id',
        true,
        true,
        'CREATE INDEX idx_user_recipes_user_id ON public.user_recipes USING btree (user_id)',
      ],
      [
        'user_recipe_versions_pkey',
        true,
        true,
        'CREATE UNIQUE INDEX user_recipe_versions_pkey ON public.user_recipe_versions USING btree (id)',
      ],
      [
        'user_recipe_versions_recipe_id_version_number_key',
        true,
        true,
        'CREATE UNIQUE INDEX user_recipe_versions_recipe_id_version_number_key ON public.user_recipe_versions USING btree (recipe_id, version_number)',
      ],
      [
        'user_recipes_id_tenant_id_user_id_key',
        true,
        true,
        'CREATE UNIQUE INDEX user_recipes_id_tenant_id_user_id_key ON public.user_recipes USING btree (id, tenant_id, user_id)',
      ],
      [
        'user_recipes_pkey',
        true,
        true,
        'CREATE UNIQUE INDEX user_recipes_pkey ON public.user_recipes USING btree (id)',
      ],
    ]),
    policies: Object.freeze([
      [
        'user_recipe_versions.user_recipe_versions_tenant_user_isolation',
        '*',
        true,
        '{0}',
        "((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))",
        "((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))",
        true,
        true,
      ],
      [
        'user_recipes.user_recipes_tenant_user_isolation',
        '*',
        true,
        '{0}',
        "((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))",
        "((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))",
        true,
        true,
      ],
    ]),
    functions: Object.freeze([
      [
        'public.accept_tenant_invitation(p_user_id uuid, p_invitation_token text)',
        'e629faa29c0d58d60c43e40bab79fb5d9a0a119deed624ae000657c850915fd1',
        false,
      ],
      [
        'public.enforce_culinary_profile_term_group_limit()',
        '77632e61e37183e80a3e5a45c8457f725c418e26fb3e5e0a1e9b07d0c2cffb7f',
        false,
      ],
      [
        'public.enforce_user_recipe_version_invariants()',
        '417893a30e0ef5b215387ebb90fe7d79b7cca1ffa422f4fabb0923acb9649501',
        false,
      ],
      [
        'public.is_valid_culinary_household_members(members jsonb)',
        'd2425afe5d43432b03ae55430e3088496741c107a0708df0ea421ae9d839a123',
        false,
      ],
      [
        'public.is_valid_culinary_profile_text_list(p_values text[], max_items integer)',
        'fffde0832d1fd1851a071a2ce43406667b438d981c21276346f935a153cb036e',
        false,
      ],
      [
        'public.prevent_culinary_profile_taxonomy_reclassification()',
        'aeafbb54cf3e39be471dbdd0f413901462eb9df908d57f55c0b67598c5b5cd21',
        false,
      ],
    ]),
    triggers: Object.freeze([
      [
        'culinary_dimensions_profile_key_immutable_trigger',
        'CREATE TRIGGER culinary_dimensions_profile_key_immutable_trigger BEFORE UPDATE OF key ON public.culinary_dimensions FOR EACH ROW EXECUTE FUNCTION prevent_culinary_profile_taxonomy_reclassification()',
        'O',
      ],
      [
        'culinary_terms_profile_dimension_immutable_trigger',
        'CREATE TRIGGER culinary_terms_profile_dimension_immutable_trigger BEFORE UPDATE OF dimension_id ON public.culinary_terms FOR EACH ROW EXECUTE FUNCTION prevent_culinary_profile_taxonomy_reclassification()',
        'O',
      ],
      [
        'user_culinary_profile_terms_group_limit_trigger',
        'CREATE TRIGGER user_culinary_profile_terms_group_limit_trigger BEFORE INSERT OR UPDATE ON public.user_culinary_profile_terms FOR EACH ROW EXECUTE FUNCTION enforce_culinary_profile_term_group_limit()',
        'O',
      ],
      [
        'user_recipe_versions_invariants',
        'CREATE TRIGGER user_recipe_versions_invariants BEFORE INSERT OR UPDATE ON public.user_recipe_versions FOR EACH ROW EXECUTE FUNCTION enforce_user_recipe_version_invariants()',
        'O',
      ],
    ]),
  })
);

const FUNCTION_NAMES = Object.freeze(
  SIGNATURE.functions.map((entry) => entry[0].split('.')[1].split('(')[0])
);
const CONSTRAINT_NAMES = Object.freeze(
  SIGNATURE.constraints.map((entry) => entry[0].split('.').at(-1))
);
const INDEX_NAMES = Object.freeze(SIGNATURE.indexes.map((entry) => entry[0]));
const TRIGGER_NAMES = Object.freeze(SIGNATURE.triggers.map((entry) => entry[0]));

function assertSignature(actual) {
  for (const section of [
    'columns',
    'constraints',
    'indexes',
    'policies',
    'functions',
    'triggers',
  ]) {
    const orderRows = (rows) =>
      rows.slice().sort((left, right) => {
        const leftIdentity = String(left[0]);
        const rightIdentity = String(right[0]);
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      });
    if (
      JSON.stringify(orderRows(actual[section])) !== JSON.stringify(orderRows(SIGNATURE[section]))
    ) {
      throw new Error(`BASELINE_MISMATCH: production-017 ${section} signature differs.`);
    }
  }
  if (
    actual.dataConditions?.canonicalEmails !== true ||
    actual.dataConditions?.uniqueEmails !== true ||
    actual.dataConditions?.culinaryTermGroupsWithinLimits !== true
  ) {
    throw new Error('BASELINE_MISMATCH: production-017 data invariants are not satisfied.');
  }
}

module.exports = {
  SIGNATURE,
  FUNCTION_NAMES,
  CONSTRAINT_NAMES,
  INDEX_NAMES,
  TRIGGER_NAMES,
  assertSignature,
};
