import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchDomains } from '@/lib/builder/namecom'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  try {
    const results = await searchDomains(q)
    return NextResponse.json(results)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Domain search failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
