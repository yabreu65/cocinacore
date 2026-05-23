interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  return (
    <form style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#a3a3a3', fontSize: '0.92rem' }}>
        Invitation token: <code>{token}</code>
      </p>
      <button type="submit" style={{ marginTop: '0.5rem', padding: '0.6rem', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#0a0a0a', fontWeight: 700 }}>
        Accept invitation
      </button>
    </form>
  );
}
