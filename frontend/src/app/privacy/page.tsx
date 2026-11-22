import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Privacy Policy - CocinaCore',
  description: 'Privacy Policy for CocinaCore',
};

export default function PrivacyPolicyPage() {
  return (
    <PublicLegalShell current="/privacy" title="Privacy Policy">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. Information We Collect
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          We collect information you provide directly to us, including your name, email address, and
          any other information you choose to provide when creating an account or using our
          services.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. How We Use Your Information
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          We use the information we collect to provide, maintain, and improve our services, to
          communicate with you, and to comply with legal obligations.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. Data Security
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          We implement appropriate technical and organizational measures to protect your personal
          data against unauthorized access, alteration, disclosure, or destruction.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Your Rights
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          You have the right to access, correct, or delete your personal data. You may also object
          to or restrict certain processing of your data.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          5. Contact Us
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          If you have any questions about this Privacy Policy, please contact us at{' '}
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
