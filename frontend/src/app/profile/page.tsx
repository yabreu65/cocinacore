'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { safeFetch } from '@/lib/api';
import {
  EMPTY_CULINARY_SELECTIONS,
  termsForDimension,
  type CulinaryProfileApiData,
  type CulinaryProfileTerm,
  type CulinaryHouseholdMember,
  type CulinarySelectionKey,
  type CulinarySelections,
} from '@/lib/profile/culinary-profile-contract';
import {
  createCulinaryProfileUpdatePayload,
  profileFormFromApi,
  PROFILE_ALLERGEN_OPTIONS,
  isProfileAllergenSelected,
  toggleProfileAllergen,
  type CulinaryProfileFormState,
} from '@/lib/profile/culinary-profile-form';

// Keep the submitted lists within the existing /api/profile TextListSchema.
// Validate the same trimmed, non-empty entries that the payload sends.
const PROFILE_LIST_MAX_ITEMS = 20;
const PROFILE_LIST_MAX_LENGTH = 80;

function ingredientListError(values: string[], label: string): string | null {
  if (values.length > PROFILE_LIST_MAX_ITEMS) {
    return `${label}: escribe como máximo ${PROFILE_LIST_MAX_ITEMS} ingredientes.`;
  }
  const invalidIndex = values.findIndex((value) => value.length > PROFILE_LIST_MAX_LENGTH);
  if (invalidIndex !== -1) {
    return `${label}: el ingrediente ${invalidIndex + 1} supera los ${PROFILE_LIST_MAX_LENGTH} caracteres.`;
  }
  return null;
}

type PreferenceGroupProps = {
  title: string;
  description: string;
  terms: CulinaryProfileTerm[];
  selectedIds: string[];
  max: number;
  onToggle: (termId: string) => void;
};

function PreferenceGroup({
  title,
  description,
  terms,
  selectedIds,
  max,
  onToggle,
}: PreferenceGroupProps) {
  const limitReached = selectedIds.length >= max;

  return (
    <fieldset className="rounded-2xl border border-bistro-border bg-white/70 p-4">
      <legend className="px-1 text-lg font-semibold text-bistro-text-primary">{title}</legend>
      <p className="mb-3 text-sm text-bistro-text-secondary">{description}</p>
      <div className="flex flex-wrap gap-2">
        {terms.map((term) => {
          const active = selectedIds.includes(term.id);
          return (
            <button
              key={term.id}
              type="button"
              aria-pressed={active}
              disabled={!active && limitReached}
              onClick={() => onToggle(term.id)}
              className={
                active
                  ? 'rounded-full border border-bistro-action-primary bg-bistro-action-primary/10 px-3 py-2 text-sm font-semibold text-bistro-action-primary'
                  : 'rounded-full border border-bistro-border bg-white px-3 py-2 text-sm text-bistro-text-primary transition hover:border-bistro-action-primary/50 disabled:cursor-not-allowed disabled:opacity-40'
              }
            >
              {term.label}
            </button>
          );
        })}
        {terms.length === 0 ? (
          <span className="text-sm text-bistro-text-secondary">
            No hay opciones configuradas todavía.
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-bistro-text-secondary">
        {selectedIds.length} de {max} seleccionadas
      </p>
    </fieldset>
  );
}

export default function ProfilePage() {
  const [profileData, setProfileData] = useState<CulinaryProfileApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('');
  const [selections, setSelections] = useState<CulinarySelections>(EMPTY_CULINARY_SELECTIONS);
  const [detailedForm, setDetailedForm] = useState<CulinaryProfileFormState>(() =>
    profileFormFromApi(null)
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await safeFetch<CulinaryProfileApiData>('/api/profile', {
          credentials: 'same-origin',
        });
        if (!result.ok) throw new Error(result.error);

        setEmail(result.data.user.email ?? '');
        setFullName(result.data.user.fullName ?? '');
        setLevel(result.data.profile?.level ?? '');
        setSelections(result.data.selections);
        setDetailedForm(profileFormFromApi(result.data.profile));
        setProfileData(result.data);
      } catch (caughtError) {
        setProfileData(null);
        setError(caughtError instanceof Error ? caughtError.message : 'No se pudo cargar perfil.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const taxonomyGroups = useMemo(() => {
    if (!profileData) {
      return {
        cuisine: [],
        dietary: [],
        technique: [],
        ingredientType: [],
        goal: [],
      };
    }

    return {
      cuisine: termsForDimension(profileData, 'cuisine'),
      dietary: termsForDimension(profileData, 'dietary'),
      technique: termsForDimension(profileData, 'technique'),
      ingredientType: termsForDimension(profileData, 'ingredient_type'),
      goal: termsForDimension(profileData, 'goal'),
    };
  }, [profileData]);

  const toggleSelection = (key: CulinarySelectionKey, termId: string, max: number) => {
    setSelections((current) => {
      const values = current[key];
      const active = values.includes(termId);
      if (!active && values.length >= max) return current;

      return {
        ...current,
        [key]: active ? values.filter((id) => id !== termId) : [...values, termId],
      };
    });
  };

  const formDisabled = loading || saving || profileData === null;
  const payload = createCulinaryProfileUpdatePayload({
    fullName,
    level,
    selections,
    ...detailedForm,
  });
  const dislikedError = ingredientListError(
    payload.dislikedIngredients,
    'Ingredientes que no te gustan'
  );
  const allergiesError = ingredientListError(payload.allergies, 'Alergias');

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (formDisabled) return;
    setError(null);
    setMessage(null);
    if (dislikedError || allergiesError) {
      setError('Corrige los campos indicados antes de guardar el perfil.');
      return;
    }
    setSaving(true);

    try {
      const result = await safeFetch<{
        user: CulinaryProfileApiData['user'];
        profile: CulinaryProfileApiData['profile'];
        selections: CulinarySelections;
      }>('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      if (!result.ok) throw new Error(result.error ?? 'No se pudo guardar perfil.');

      setFullName(result.data.user.fullName ?? '');
      setLevel(result.data.profile?.level ?? '');
      setSelections(result.data.selections);
      setDetailedForm(profileFormFromApi(result.data.profile));
      setMessage('Perfil culinario guardado. CocinaCore ya usará estas preferencias.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo guardar perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-bistro-champagne">
              TU CONTEXTO CULINARIO
            </p>
            <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
              Mi perfil culinario
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bistro-cream sm:text-base">
              Estas preferencias alimentan el Planificador y las recetas conectadas de tu hogar.
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex min-h-11 items-center rounded-xl border border-white/40 px-3 text-sm font-semibold text-white"
          >
            Volver
          </Link>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-4 rounded-xl border border-bistro-action-secondary/30 bg-bistro-action-secondary/10 px-3 py-2 text-sm text-bistro-action-secondary">
            {message}
          </p>
        ) : null}

        <form onSubmit={onSave} className="grid gap-4">
          <fieldset disabled={formDisabled} className="contents">
            <div className="grid gap-3 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm md:grid-cols-3 md:p-5">
              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                Nombre completo
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  maxLength={120}
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
                />
              </label>

              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                Correo
                <input
                  value={email}
                  disabled
                  className="h-11 rounded-xl border border-bistro-border bg-bistro-surface-warm px-3 text-bistro-text-secondary"
                />
              </label>

              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                Nivel culinario
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
                >
                  <option value="">Sin preferencia</option>
                  <option value="Principiante">Principiante</option>
                  <option value="Intermedio">Intermedio</option>
                  <option value="Chef">Chef</option>
                </select>
              </label>
            </div>

            <PreferenceGroup
              title="Cocinas favoritas"
              description="Cocinas que CocinaCore debe priorizar al proponerte ideas."
              terms={taxonomyGroups.cuisine}
              selectedIds={selections.favoriteCuisineTermIds}
              max={6}
              onToggle={(termId) => toggleSelection('favoriteCuisineTermIds', termId, 6)}
            />

            <PreferenceGroup
              title="Restricciones y dietas"
              description="Elige las restricciones que CocinaCore debe respetar. Las recetas y los nombres de ingredientes se trabajan en español."
              terms={taxonomyGroups.dietary}
              selectedIds={selections.dietaryAvoidTermIds}
              max={12}
              onToggle={(termId) => toggleSelection('dietaryAvoidTermIds', termId, 12)}
            />

            <fieldset className="grid gap-3 rounded-2xl border border-bistro-border bg-white/70 p-4">
              <legend className="px-1 text-lg font-semibold text-bistro-text-primary">
                Alergias alimentarias
              </legend>
              <p className="text-sm text-bistro-text-secondary">
                Selecciona los alérgenos que necesitas evitar. Maní y frutos secos de árbol son
                opciones distintas.
              </p>
              <div className="flex flex-wrap gap-2">
                {PROFILE_ALLERGEN_OPTIONS.map((option) => {
                  const active = isProfileAllergenSelected(
                    detailedForm.selectedAllergies,
                    option.id
                  );
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      disabled={!active && payload.allergies.length >= PROFILE_LIST_MAX_ITEMS}
                      onClick={() =>
                        setDetailedForm((current) => ({
                          ...current,
                          selectedAllergies: toggleProfileAllergen(
                            current.selectedAllergies,
                            option.id
                          ),
                        }))
                      }
                      className={
                        active
                          ? 'rounded-full border border-bistro-action-primary bg-bistro-action-primary/10 px-3 py-2 text-sm font-semibold text-bistro-action-primary'
                          : 'rounded-full border border-bistro-border bg-white px-3 py-2 text-sm text-bistro-text-primary disabled:opacity-40'
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-bistro-text-secondary">
                {payload.allergies.length} de {PROFILE_LIST_MAX_ITEMS} alergias registradas
                (incluidas las adicionales).
              </p>
              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                Alergias adicionales
                <span id="allergies-language-hint" className="text-xs font-normal">
                  Si falta alguna, escríbela en español, una por línea. Conservamos las alergias
                  guardadas previamente. Hasta {PROFILE_LIST_MAX_LENGTH} caracteres por ingrediente.
                  Revisa siempre ingredientes, etiquetas y contaminación cruzada: el filtro no
                  certifica ausencia de alérgenos.
                </span>
                <textarea
                  aria-invalid={Boolean(allergiesError)}
                  aria-describedby={
                    allergiesError
                      ? 'allergies-language-hint allergies-error'
                      : 'allergies-language-hint'
                  }
                  rows={3}
                  value={detailedForm.allergiesText}
                  onChange={(event) =>
                    setDetailedForm((current) => ({
                      ...current,
                      allergiesText: event.target.value,
                    }))
                  }
                  placeholder="Otra alergia, una por línea"
                  className="rounded-xl border border-bistro-border bg-white px-3 py-2 outline-none"
                />
                {allergiesError ? (
                  <span id="allergies-error" className="text-xs text-bistro-danger">
                    {allergiesError}
                  </span>
                ) : null}
              </label>
            </fieldset>

            <div className="grid gap-4 lg:grid-cols-2">
              <PreferenceGroup
                title="Técnicas que disfrutas"
                description="Ayudan a orientar el estilo de las recetas cuando sean apropiadas."
                terms={taxonomyGroups.technique}
                selectedIds={selections.techniqueTermIds}
                max={8}
                onToggle={(termId) => toggleSelection('techniqueTermIds', termId, 8)}
              />
              <PreferenceGroup
                title="Ingredientes que prefieres"
                description="Tipos de ingredientes que suelen encajar mejor contigo."
                terms={taxonomyGroups.ingredientType}
                selectedIds={selections.ingredientTypeTermIds}
                max={8}
                onToggle={(termId) => toggleSelection('ingredientTypeTermIds', termId, 8)}
              />
            </div>

            <PreferenceGroup
              title="Objetivos"
              description="Qué quieres optimizar en tu cocina cotidiana."
              terms={taxonomyGroups.goal}
              selectedIds={selections.goalTermIds}
              max={6}
              onToggle={(termId) => toggleSelection('goalTermIds', termId, 6)}
            />

            <section className="grid gap-4 rounded-2xl border border-bistro-border bg-white/70 p-4">
              <h2 className="text-lg font-semibold text-bistro-text-primary">
                Detalles para cocinar
              </h2>
              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary md:max-w-xs">
                Tiempo disponible (minutos)
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={1}
                  inputMode="numeric"
                  placeholder="30"
                  value={detailedForm.availableTimeMinutes}
                  onChange={(event) =>
                    setDetailedForm((current) => ({
                      ...current,
                      availableTimeMinutes: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
                />
                <span className="text-xs font-normal text-bistro-text-secondary">
                  Deja vacío si no tienes un tiempo preferido (5–240 minutos).
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                  Ingredientes que no te gustan
                  <span id="disliked-ingredients-hint" className="text-xs font-normal">
                    Un ingrediente por línea en español. Hasta {PROFILE_LIST_MAX_ITEMS}{' '}
                    ingredientes, con {PROFILE_LIST_MAX_LENGTH} caracteres por ingrediente.
                  </span>
                  <textarea
                    aria-invalid={Boolean(dislikedError)}
                    aria-describedby={
                      dislikedError
                        ? 'disliked-ingredients-hint disliked-ingredients-error'
                        : 'disliked-ingredients-hint'
                    }
                    rows={4}
                    value={detailedForm.dislikedIngredientsText}
                    onChange={(event) =>
                      setDetailedForm((current) => ({
                        ...current,
                        dislikedIngredientsText: event.target.value,
                      }))
                    }
                    placeholder={'Un ingrediente por línea'}
                    className="rounded-xl border border-bistro-border bg-white px-3 py-2 outline-none"
                  />
                  {dislikedError ? (
                    <span id="disliked-ingredients-error" className="text-xs text-bistro-danger">
                      {dislikedError}
                    </span>
                  ) : null}
                </label>
              </div>

              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-bistro-text-secondary">
                    Comensales del hogar
                  </h3>
                  <button
                    type="button"
                    disabled={detailedForm.householdMembers.length >= 12}
                    onClick={() =>
                      setDetailedForm((current) => ({
                        ...current,
                        householdMembers: [
                          ...current.householdMembers,
                          { name: '', ageGroup: 'adult' },
                        ],
                      }))
                    }
                    className="rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-text-secondary disabled:opacity-50"
                  >
                    Añadir comensal
                  </button>
                </div>
                {detailedForm.householdMembers.length === 0 ? (
                  <p className="text-sm text-bistro-text-secondary">
                    Aún no has añadido comensales.
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  {detailedForm.householdMembers.map((member: CulinaryHouseholdMember, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-bistro-border p-3"
                    >
                      <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                        Nombre
                        <input
                          value={member.name}
                          maxLength={60}
                          onChange={(event) =>
                            setDetailedForm((current) => ({
                              ...current,
                              householdMembers: current.householdMembers.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, name: event.target.value } : row
                              ),
                            }))
                          }
                          className="h-10 rounded-xl border border-bistro-border bg-white px-3 outline-none"
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                        Grupo de edad
                        <select
                          value={member.ageGroup}
                          onChange={(event) =>
                            setDetailedForm((current) => ({
                              ...current,
                              householdMembers: current.householdMembers.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      ageGroup: event.target
                                        .value as CulinaryHouseholdMember['ageGroup'],
                                    }
                                  : row
                              ),
                            }))
                          }
                          className="h-10 rounded-xl border border-bistro-border bg-white px-3 outline-none"
                        >
                          <option value="adult">Adulto</option>
                          <option value="teen">Adolescente</option>
                          <option value="child">Niño/a</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setDetailedForm((current) => ({
                            ...current,
                            householdMembers: current.householdMembers.filter(
                              (_, rowIndex) => rowIndex !== index
                            ),
                          }))
                        }
                        className="justify-self-start text-sm font-semibold text-bistro-action-primary"
                      >
                        Quitar comensal
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-bistro-text-secondary">
                  Los comensales no tienen cuenta ni acceso al sistema. Sus nombres solo se guardan
                  para organizar tu hogar; puedes añadir hasta 12 comensales.
                </p>
              </div>
            </section>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={formDisabled}
                className="min-h-12 w-full rounded-xl bg-bistro-action-primary px-4 py-3 font-semibold text-white disabled:opacity-60 sm:w-auto"
              >
                {saving ? 'Guardando...' : 'Guardar perfil culinario'}
              </button>
              <Link
                href="/mfa"
                className="inline-flex h-11 items-center rounded-xl border border-bistro-border px-4 text-sm font-semibold text-bistro-text-secondary hover:border-bistro-action-primary/40"
              >
                Seguridad (MFA)
              </Link>
            </div>
          </fieldset>
        </form>

        {loading ? (
          <p className="mt-3 text-sm text-bistro-text-secondary">Cargando perfil...</p>
        ) : profileData === null ? (
          <p className="mt-3 text-sm text-bistro-text-secondary">
            No puedes modificar el perfil hasta que se cargue correctamente. Recarga la página para
            volver a intentarlo.
          </p>
        ) : null}
      </section>
    </main>
  );
}
