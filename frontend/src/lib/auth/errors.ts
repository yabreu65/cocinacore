export type AuthErrorContext = 'login' | 'signup' | 'oauth' | 'password-reset' | 'mfa';

const DEFAULT_AUTH_ERROR = 'No pudimos completar la operación. Intentá nuevamente.';

const AUTH_ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /invalid login credentials|invalid credentials/i,
    message: 'Correo o contraseña incorrectos.',
  },
  {
    pattern: /email not confirmed|not confirmed/i,
    message: 'Confirmá tu correo antes de ingresar.',
  },
  {
    pattern: /rate limit|too many|429/i,
    message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.',
  },
  {
    pattern: /password/i,
    message: 'La contraseña no cumple los requisitos de seguridad.',
  },
  {
    pattern: /expired|invalid.*link|invalid.*token/i,
    message: 'El enlace no es válido o expiró. Pedí uno nuevo.',
  },
  {
    pattern: /network|fetch|timeout/i,
    message: 'No pudimos conectar con autenticación. Revisá tu conexión e intentá nuevamente.',
  },
];

export function mapAuthError(error: unknown, context?: AuthErrorContext): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const match = AUTH_ERROR_PATTERNS.find(({ pattern }) => pattern.test(raw));
  if (match) return match.message;

  if (context === 'oauth') return 'No pudimos continuar con el proveedor seleccionado.';
  if (context === 'password-reset') return 'No pudimos procesar el pedido de recuperación.';
  if (context === 'mfa') return 'No pudimos verificar el código MFA.';
  return DEFAULT_AUTH_ERROR;
}
