/** Household navigation is intentionally separate from admin/owner and public routes. */
export const householdNavigation = [
  { label: 'Inicio', href: '/app', icon: 'home' },
  { label: 'Mis recetas', href: '/recipes', icon: 'book' },
  { label: 'Asistente de recetas', href: '/recipes/search', icon: 'sparkles' },
  { label: 'Inventario', href: '/recipes/inventory', icon: 'package' },
  { label: 'Planificador', href: '/meal-planner', icon: 'calendar' },
  { label: 'Compras', href: '/shopping-list', icon: 'cart' },
  { label: 'Biblioteca', href: '/library', icon: 'library' },
  { label: 'Perfil', href: '/profile', icon: 'user' },
  { label: 'Mi plan', href: '/billing', icon: 'card' },
] as const;

export function isHouseholdRoute(pathname: string): boolean {
  const routeRoots = [
    '/app',
    '/recipes',
    '/meal-planner',
    '/shopping-list',
    '/library',
    '/profile',
    '/billing',
    '/members',
    '/premium',
  ];
  return routeRoots.some((root) => pathname === root || pathname.startsWith(root + '/'));
}

/** Route matching must prioritize specific recipe actions over the general recipe library. */
export function activeHouseholdRoute(pathname: string): string | null {
  if (pathname === '/app' || pathname === '/app/') return '/app';
  if (pathname === '/app/cooking-intent' || pathname.startsWith('/app/cooking-intent/'))
    return '/recipes';
  if (
    pathname === '/recipes/search' ||
    pathname.startsWith('/recipes/search/') ||
    pathname === '/recipes/rating'
  )
    return '/recipes/search';
  if (pathname === '/recipes/inventory' || pathname.startsWith('/recipes/inventory/'))
    return '/recipes/inventory';
  if (pathname === '/recipes' || pathname.startsWith('/recipes/')) return '/recipes';
  const exact = householdNavigation.find(
    (item) =>
      item.href !== '/recipes' &&
      item.href !== '/app' &&
      (pathname === item.href || pathname.startsWith(item.href + '/'))
  );
  return exact?.href ?? null;
}
