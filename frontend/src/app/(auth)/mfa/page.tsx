export default function MfaPage() {
  return (
    <form style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#a3a3a3', fontSize: '0.92rem' }}>
        Enter your authenticator code to continue.
      </p>
      <label htmlFor="mfa-code">MFA code</label>
      <input id="mfa-code" type="text" name="code" inputMode="numeric" minLength={6} maxLength={6} required style={{ padding: '0.55rem', borderRadius: '8px', border: '1px solid #404040', background: '#171717' }} />
      <button type="submit" style={{ marginTop: '0.5rem', padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#0a0a0a', fontWeight: 700 }}>
        Verify code
      </button>
    </form>
  );
}
