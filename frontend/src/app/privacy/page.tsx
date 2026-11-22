import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Política de privacidad - CocinaCore',
  description: 'Política de privacidad de CocinaCore',
};

export default function PrivacyPolicyPage() {
  return (
    <PublicLegalShell current="/privacy" title="Política de privacidad">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. Información que recopilamos
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Recopilamos la información que nos proporcionás directamente, incluidos tu nombre, dirección
          de correo electrónico y cualquier otro dato que decidas compartir al crear una cuenta
          o utilizar nuestros servicios.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. Cómo usamos tu información
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Utilizamos la información recopilada para prestar, mantener y mejorar nuestros servicios,
          comunicarnos con vos y cumplir con nuestras obligaciones legales.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. Seguridad de los datos
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Implementamos medidas técnicas y organizativas adecuadas para proteger tus datos personales
          frente al acceso, la alteración, la divulgación o la destrucción no autorizados.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Tus derechos
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Tenés derecho a acceder a tus datos personales, rectificarlos o eliminarlos. También podés
          oponerte a determinados tratamientos de tus datos o solicitar su limitación.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          5. Contacto
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Si tenés alguna pregunta sobre esta Política de privacidad, escribinos a{' '}
          <a
            href="mailto:privacy@cocinacore.com"
            className="font-semibold text-bistro-action-primary hover:underline"
          >
            privacy@cocinacore.com
          </a>
        </p>
      </section>
    </PublicLegalShell>
  );
}
