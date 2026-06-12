import Link from 'next/link';

export const metadata = {
  title: 'Cookie Policy - CocinaCore',
  description: 'Cookie Policy for CocinaCore',
};

export default function CookiesPage() {
  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-16 text-[#241A14]">
      <div className="mx-auto max-w-3xl rounded-3xl border border-[#E8DDD2] bg-white/85 p-6 premium-shadow md:p-8">
        <h1 className="mb-8 text-3xl font-semibold text-[#241A14]">Cookie Policy</h1>
        
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-[#241A14]">1. What Are Cookies</h2>
          <p className="mb-4 text-[#6B5A50]">
            Cookies are small text files that are placed on your device when you visit a website. 
            They are widely used to make websites work more efficiently and provide information to website owners.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-[#241A14]">2. How We Use Cookies</h2>
          <p className="mb-4 text-[#6B5A50]">
            We use cookies to authenticate users, maintain session state, and improve your experience 
            on our platform. We do not use cookies for advertising purposes.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-[#241A14]">3. Managing Cookies</h2>
          <p className="mb-4 text-[#6B5A50]">
            Most web browsers allow you to control cookies through their settings. You can choose to 
            block or delete cookies, but this may affect your ability to use certain features of our service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-[#241A14]">4. Contact Us</h2>
          <p className="mb-4 text-[#6B5A50]">
            If you have any questions about our Cookie Policy, please contact us at{' '}
            <a href="mailto:privacy@cocinacore.com" className="font-semibold text-[#A55412] hover:underline">
              privacy@cocinacore.com
            </a>
          </p>
        </section>

        <div className="mt-12 pt-8 border-t border-[#E8DDD2]">
          <Link href="/" className="font-semibold text-[#A55412] hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
