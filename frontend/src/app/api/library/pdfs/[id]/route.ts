import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import type { TenantRole } from '@/lib/auth/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isTenantRole(value: unknown): value is TenantRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id: pdfId } = await context.params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: meRow, error: meError } = await supabase
    .from('users')
    .select('id,role,tenant_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (meError || !meRow?.tenant_id || !isTenantRole(meRow.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: pdfRow, error: selectError } = await supabase
    .from('tenant_pdf_library')
    .select('tenant_book_id,tenant_id,uploaded_by')
    .eq('id', pdfId)
    .eq('tenant_id', meRow.tenant_id)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }
  if (!pdfRow) {
    return NextResponse.json({ error: 'PDF not found.' }, { status: 404 });
  }

  const canDelete = meRow.role === 'owner' || meRow.role === 'admin' || pdfRow.uploaded_by === meRow.id;
  if (!canDelete) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error: deleteError } = await supabase
    .from('tenant_pdf_library')
    .delete()
    .eq('id', pdfId)
    .eq('tenant_id', meRow.tenant_id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (pdfRow.tenant_book_id) {
    const { count, error: countError } = await supabase
      .from('tenant_pdf_library')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', meRow.tenant_id)
      .eq('tenant_book_id', pdfRow.tenant_book_id);
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if ((count ?? 0) === 0) {
      const { error: deleteBookError } = await supabase
        .from('tenant_books')
        .delete()
        .eq('id', pdfRow.tenant_book_id)
        .eq('tenant_id', meRow.tenant_id);
      if (deleteBookError) {
        return NextResponse.json({ error: deleteBookError.message }, { status: 500 });
      }
    }
  }

  return response;
}
