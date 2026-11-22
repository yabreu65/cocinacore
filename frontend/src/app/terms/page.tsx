import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Terms of Service - CocinaCore',
  description: 'Terms of Service for CocinaCore',
};

export default function TermsPage() {
  return (
    <PublicLegalShell current="/terms" title="Terms of Service">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. Acceptance of Terms
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          By accessing and using CocinaCore, you accept and agree to be bound by the terms and
          conditions of this agreement.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. Use of Service
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          You agree to use the service only for lawful purposes and in a way that does not infringe
          the rights of others or restrict their use and enjoyment of the service.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. User Accounts
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          You are responsible for maintaining the confidentiality of your account credentials and
          for all activities that occur under your account.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Limitation of Liability
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          CocinaCore shall not be liable for any indirect, incidental, special, consequential, or
          punitive damages resulting from your use of the service.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          5. Changes to Terms
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          We reserve the right to modify these terms at any time. Continued use of the service after
          changes constitutes acceptance of the new terms.
        </p>
      </section>
    </PublicLegalShell>
  );
}
