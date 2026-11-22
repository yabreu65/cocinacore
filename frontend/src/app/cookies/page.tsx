import PublicLegalShell from '../components/PublicLegalShell';

export const metadata = {
  title: 'Cookie Policy - CocinaCore',
  description: 'Cookie Policy for CocinaCore',
};

export default function CookiesPage() {
  return (
    <PublicLegalShell current="/cookies" title="Cookie Policy">
      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          1. What Are Cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Cookies are small text files that are placed on your device when you visit a website. They
          are widely used to make websites work more efficiently and provide information to website
          owners.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          2. How We Use Cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          We use cookies to authenticate users, maintain session state, and improve your experience
          on our platform. We do not use cookies for advertising purposes.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          3. Managing Cookies
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          Most web browsers allow you to control cookies through their settings. You can choose to
          block or delete cookies, but this may affect your ability to use certain features of our
          service.
        </p>
      </section>

      <section className="border-b border-bistro-border pb-6 last:border-b-0 last:pb-0">
        <h2 className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
          4. Contact Us
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
          If you have any questions about our Cookie Policy, please contact us at{' '}
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
