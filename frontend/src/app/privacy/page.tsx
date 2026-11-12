import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - CocinaCore',
  description: 'Privacy Policy for CocinaCore',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-16 text-bistro-text-primary">
      <div className="mx-auto max-w-3xl rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow md:p-8">
        <h1 className="mb-8 text-3xl font-semibold text-bistro-text-primary">Privacy Policy</h1>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            1. Information We Collect
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            We collect information you provide directly to us, including your name, email address,
            and any other information you choose to provide when creating an account or using our
            services.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            2. How We Use Your Information
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            We use the information we collect to provide, maintain, and improve our services, to
            communicate with you, and to comply with legal obligations.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">3. Data Security</h2>
          <p className="mb-4 text-bistro-text-secondary">
            We implement appropriate technical and organizational measures to protect your personal
            data against unauthorized access, alteration, disclosure, or destruction.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">4. Your Rights</h2>
          <p className="mb-4 text-bistro-text-secondary">
            You have the right to access, correct, or delete your personal data. You may also object
            to or restrict certain processing of your data.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">5. Contact Us</h2>
          <p className="mb-4 text-bistro-text-secondary">
            If you have any questions about this Privacy Policy, please contact us at{' '}
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
