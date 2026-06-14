import { Resend } from 'resend';

interface SendPasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || apiKey === 'CHANGE_ME') {
    throw new Error('RESEND_API_KEY is required for transactional email.');
  }
  return new Resend(apiKey);
}

function getEmailFrom(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from || from === 'CHANGE_ME') {
    throw new Error('EMAIL_FROM is required for transactional email.');
  }
  return from;
}

export function getAppPublicUrl(): string {
  const value = process.env.APP_PUBLIC_URL?.trim();
  if (!value || value === 'CHANGE_ME') {
    throw new Error('APP_PUBLIC_URL is required for email links.');
  }
  return value.replace(/\/$/, '');
}

export async function sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void> {
  const resend = getResendClient();
  const result = await resend.emails.send({
    from: getEmailFrom(),
    to: input.to,
    subject: 'Restablecé tu contraseña de CocinaCore',
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña de CocinaCore.</p>
      <p><a href="${input.resetUrl}">Restablecer contraseña</a></p>
      <p>Este enlace vence pronto. Si no solicitaste este cambio, podés ignorar este correo.</p>
    `,
    text: `Recibimos una solicitud para restablecer tu contraseña de CocinaCore. Abrí este enlace: ${input.resetUrl}`,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}
