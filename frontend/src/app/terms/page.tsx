import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Términos del servicio - CocinaCore',
  description: 'Términos del servicio de CocinaCore',
};

export default function TermsPage() {
  return (
    <PublicLegalShell current="/terms" title="Términos del servicio">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. Aceptación de los términos
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Al acceder a CocinaCore y utilizarlo, aceptás quedar sujeto a los términos y condiciones
          de este acuerdo.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. Uso del servicio
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Te comprometés a utilizar el servicio únicamente con fines lícitos, sin vulnerar los derechos
          de otras personas ni restringir su uso y disfrute del servicio.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. Cuentas de usuario
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Sos responsable de mantener la confidencialidad de las credenciales de tu cuenta y de todas
          las actividades que se realicen desde ella.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Limitación de responsabilidad
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          CocinaCore no será responsable por daños indirectos, incidentales, especiales, consecuentes
          o punitivos derivados del uso del servicio.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          5. Modificaciones de los términos
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Nos reservamos el derecho de modificar estos términos en cualquier momento. Seguir
          utilizando el servicio después de los cambios implica aceptar los nuevos términos.
        </p>
      </section>
    </PublicLegalShell>
  );
}
