import Link from 'next/link';

export const metadata = {
  title: 'Cookie Policy - CocinaCore',
  description: 'Cookie Policy for CocinaCore',
};

export default function CookiesPage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-16 text-bistro-text-primary">
      <div className="mx-auto max-w-3xl rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow md:p-8">
        <h1 className="mb-8 text-3xl font-semibold text-bistro-text-primary">Cookie Policy</h1>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            1. What Are Cookies
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            Cookies are small text files that are placed on your device when you visit a website.
            They are widely used to make websites work more efficiently and provide information to
            website owners.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            2. How We Use Cookies
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            We use cookies to authenticate users, maintain session state, and improve your
            experience on our platform. We do not use cookies for advertising purposes.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            3. Managing Cookies
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            Most web browsers allow you to control cookies through their settings. You can choose to
            block or delete cookies, but this may affect your ability to use certain features of our
            service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">4. Contact Us</h2>
          <p className="mb-4 text-bistro-text-secondary">
            If you have any questions about our Cookie Policy, please contact us at{' '}
            <a
              href="mailto:privacy@cocinacore.com"
              className="font-semibold text-bistro-action-primary hover:underline"
            >
              privacy@cocinacore.com
            </a>
          </p>
        </section>

        <div className="mt-12 pt-8 border-t border-bistro-border">
          <Link href="/" className="font-semibold text-bistro-action-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
