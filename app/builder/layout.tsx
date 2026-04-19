import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function BuilderLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get org and check builder_enabled
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (profile?.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('builder_enabled, name')
      .eq('id', profile.org_id)
      .single()

    if (!org?.builder_enabled) {
      return (
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">Builder Not Included</h1>
            <p className="text-gray-400 text-sm leading-relaxed mb-6">
              The Wilcart Website Builder is available on plans that include the Website feature.
              Contact your account manager to upgrade.
            </p>
            <a
              href="mailto:support@wilcart.com"
              className="inline-flex items-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              Contact Support
            </a>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}
