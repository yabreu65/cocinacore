import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Política de cookies - CocinaCore',
  description: 'Política de cookies de CocinaCore',
};

export default function CookiesPage() {
  return (
    <PublicLegalShell current="/cookies" title="Política de cookies">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. Qué son las cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Las cookies son pequeños archivos de texto que se almacenan en tu dispositivo cuando visitás
          un sitio web. Se utilizan ampliamente para que los sitios funcionen de manera más eficiente
          y para proporcionar información a sus propietarios.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. Cómo utilizamos las cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Utilizamos cookies para autenticar a los usuarios, mantener el estado de la sesión y mejorar
          tu experiencia en nuestra plataforma. No utilizamos cookies con fines publicitarios.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. Administración de cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          La mayoría de los navegadores permiten controlar las cookies desde su configuración. Podés
          bloquearlas o eliminarlas, pero esto podría afectar tu capacidad para utilizar algunas
          funciones del servicio.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Contacto
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Si tenés alguna pregunta sobre nuestra Política de cookies, escribinos a{' '}
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
