import { z } from 'zod';

export const AuthEmailSchema = z.object({
  email: z.string().trim().email('Ingresá un correo válido.').max(254),
});

export const LoginSchema = AuthEmailSchema.extend({
  password: z.string().min(1, 'Ingresá tu contraseña.'),
});

export const SignupSchema = AuthEmailSchema.extend({
  fullName: z.string().trim().min(3, 'Ingresá tu nombre completo.').max(120),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  confirmPassword: z.string().min(8, 'Confirmá la contraseña.'),
  termsAccepted: z.literal(true, {
    error: 'Debés aceptar términos y privacidad.',
  }),
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Las contraseñas no coinciden.',
});

export const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
    confirmPassword: z.string().min(8, 'Confirmá la contraseña.'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  });

export type AuthEmailInput = z.infer<typeof AuthEmailSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type SignupInput = z.infer<typeof SignupSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
