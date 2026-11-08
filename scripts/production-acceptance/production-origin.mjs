export const PRODUCTION_ORIGIN = "https://cocinacore.31-220-98-21.sslip.io";

export function validateProductionOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("E2E_PRODUCTION_URL is required.");
  }

  const candidate = value.endsWith("/") ? value.slice(0, -1) : value;
  if (candidate !== PRODUCTION_ORIGIN) {
    throw new Error(
      "E2E_PRODUCTION_URL is not the authorized production origin.",
    );
  }

  return PRODUCTION_ORIGIN;
}
