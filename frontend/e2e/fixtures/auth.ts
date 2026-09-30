import { Page } from '@playwright/test';
import type { Cookie } from '@playwright/test';

interface LoginPayload {
  email: string;
  password: string;
}

interface SignupPayload extends LoginPayload {
  confirmPassword: string;
  fullName: string;
  termsAccepted: true;
}

interface AuthOptions {
  allowSignup?: boolean;
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const RAW_E2E_EMAIL = process.env.E2E_USER_EMAIL;
const RAW_E2E_PASSWORD = process.env.E2E_USER_PASSWORD;
const RAW_E2E_OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
const RAW_E2E_OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD;
const TEST_EMAIL = RAW_E2E_EMAIL ?? 'test@cocinacore.local';
const TEST_PASSWORD = RAW_E2E_PASSWORD ?? 'TestPassword123!';
const OWNER_EMAIL = RAW_E2E_OWNER_EMAIL ?? RAW_E2E_EMAIL;
const OWNER_PASSWORD = RAW_E2E_OWNER_PASSWORD ?? RAW_E2E_PASSWORD;
const TEST_FULL_NAME = process.env.E2E_USER_FULL_NAME ?? 'E2E Owner';
let cachedAuthCookies: Cookie[] | null = null;
let cachedAuthCookiesFromSignup: boolean | null = null;
let cachedOwnerAuthCookies: Cookie[] | null = null;

export function hasExplicitE2ECredentials(
  email: string | undefined,
  password: string | undefined
): boolean {
  return email !== undefined || password !== undefined;
}

export function hasExplicitOwnerCredentials(): boolean {
  return Boolean(RAW_E2E_OWNER_EMAIL && RAW_E2E_OWNER_PASSWORD);
}

async function loginWithCredentials(page: Page, email: string, password: string) {
  const payload: LoginPayload = {
    email,
    password,
  };

  return page.request.post('/api/auth/login', {
    data: payload,
  });
}

async function login(page: Page) {
  return loginWithCredentials(page, TEST_EMAIL, TEST_PASSWORD);
}

async function signup(page: Page) {
  const payload: SignupPayload = {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    confirmPassword: TEST_PASSWORD,
    fullName: TEST_FULL_NAME,
    termsAccepted: true,
  };

  return page.request.post('/api/auth/signup', {
    data: payload,
  });
}

/**
 * Authenticate through the app login API so the server issues real session cookies.
 */
export async function injectAuth(
  page: Page,
  userId: string = TEST_USER_ID,
  options: AuthOptions = {}
): Promise<void> {
  const allowSignup =
    options.allowSignup ?? !hasExplicitE2ECredentials(RAW_E2E_EMAIL, RAW_E2E_PASSWORD);

  if (cachedAuthCookies) {
    if (allowSignup || cachedAuthCookiesFromSignup !== true) {
      await page.context().addCookies(cachedAuthCookies);
      return;
    }

    cachedAuthCookies = null;
    cachedAuthCookiesFromSignup = null;
  }

  let response = await login(page);
  let authenticatedBySignup = false;

  if (!response.ok() && allowSignup) {
    const signupResponse = await signup(page);
    if (signupResponse.ok()) {
      response = signupResponse;
      authenticatedBySignup = true;
    }
  }

  if (!response.ok()) {
    throw new Error(
      `E2E login failed for ${TEST_EMAIL} (${userId}). Seed an application user with npm run db:bootstrap or set E2E_USER_EMAIL/E2E_USER_PASSWORD.`
    );
  }

  cachedAuthCookies = await page.context().cookies();
  cachedAuthCookiesFromSignup = authenticatedBySignup;
}

export async function injectOwnerAuth(page: Page): Promise<void> {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    throw new Error('Set E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD for owner E2E tests.');
  }

  if (cachedOwnerAuthCookies) {
    await page.context().addCookies(cachedOwnerAuthCookies);
    return;
  }

  const response = await loginWithCredentials(page, OWNER_EMAIL, OWNER_PASSWORD);

  if (!response.ok()) {
    throw new Error(
      `E2E owner login failed for ${OWNER_EMAIL}. Seed a platform owner with npm run db:bootstrap or set valid E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD.`
    );
  }

  cachedOwnerAuthCookies = await page.context().cookies();
}

/**
 * Clear auth cookies (for testing unauthenticated flows)
 */
export async function clearAuth(page: Page): Promise<void> {
  cachedAuthCookies = null;
  cachedAuthCookiesFromSignup = null;
  cachedOwnerAuthCookies = null;
  await page.context().clearCookies();
}
