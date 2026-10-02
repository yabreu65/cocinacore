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

interface ResponseCookie {
  name: string;
  value: string;
  url: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
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

async function installResponseCookies(
  page: Page,
  response: Awaited<ReturnType<typeof loginWithCredentials>>
): Promise<void> {
  const header = response.headers()['set-cookie'];
  if (!header) {
    throw new Error('E2E auth response did not include a session cookie.');
  }

  const [pair = '', ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  const name = separator < 0 ? '' : pair.slice(0, separator).trim();
  const value = separator < 0 ? '' : pair.slice(separator + 1);
  if (!name || !value.trim()) {
    throw new Error('E2E auth response contained a malformed session cookie.');
  }

  const cookie: ResponseCookie = {
    name,
    value,
    url: new URL(response.url()).origin,
    httpOnly: false,
    secure: false,
  };
  let maxAge: number | undefined;
  let expires: number | undefined;

  for (const attribute of attributes) {
    const [key, ...parts] = attribute.trim().split('=');
    const attributeValue = parts.join('=').trim();
    switch (key?.toLowerCase()) {
      case 'httponly': cookie.httpOnly = true; break;
      case 'secure': cookie.secure = true; break;
      case 'max-age': maxAge = Number(attributeValue); break;
      case 'expires': expires = Date.parse(attributeValue) / 1000; break;
      case 'samesite':
        if (attributeValue.toLowerCase() === 'strict') cookie.sameSite = 'Strict';
        else if (attributeValue.toLowerCase() === 'lax') cookie.sameSite = 'Lax';
        else if (attributeValue.toLowerCase() === 'none') cookie.sameSite = 'None';
        break;
    }
  }

  if (maxAge !== undefined && Number.isFinite(maxAge)) {
    cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
  } else if (expires !== undefined && Number.isFinite(expires)) {
    cookie.expires = Math.floor(expires);
  }
  await page.context().addCookies([cookie]);
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

  await installResponseCookies(page, response);
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

  await installResponseCookies(page, response);
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
