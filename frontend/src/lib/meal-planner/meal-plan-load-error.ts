const RESTRICTIONS_CHANGED_CODE = 'MEAL_PLAN_RESTRICTIONS_CHANGED';
const RESTRICTIONS_CHANGED_MESSAGE =
  'Tus restricciones cambiaron desde que se creó este menú. Genera uno nuevo para respetarlas.';
const DEFAULT_LOAD_ERROR = 'No se pudo cargar el menú guardado.';

export function mapMealPlanLoadError(error: string | null | undefined): string {
  if (error === RESTRICTIONS_CHANGED_CODE) return RESTRICTIONS_CHANGED_MESSAGE;
  return error || DEFAULT_LOAD_ERROR;
}
