import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service - CocinaCore',
  description: 'Terms of Service for CocinaCore',
};

export default function TermsPage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-16 text-bistro-text-primary">
      <div className="mx-auto max-w-3xl rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow md:p-8">
        <h1 className="mb-8 text-3xl font-semibold text-bistro-text-primary">Terms of Service</h1>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            1. Acceptance of Terms
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            By accessing and using CocinaCore, you accept and agree to be bound by the terms and
            conditions of this agreement.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">2. Use of Service</h2>
          <p className="mb-4 text-bistro-text-secondary">
            You agree to use the service only for lawful purposes and in a way that does not
            infringe the rights of others or restrict their use and enjoyment of the service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">3. User Accounts</h2>
          <p className="mb-4 text-bistro-text-secondary">
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activities that occur under your account.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            4. Limitation of Liability
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            CocinaCore shall not be liable for any indirect, incidental, special, consequential, or
            punitive damages resulting from your use of the service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-bistro-text-primary">
            5. Changes to Terms
          </h2>
          <p className="mb-4 text-bistro-text-secondary">
            We reserve the right to modify these terms at any time. Continued use of the service
            after changes constitutes acceptance of the new terms.
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
