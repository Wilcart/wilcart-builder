'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/builder')
  }

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img src="/logo.png" alt="Wilcart Builder" className="h-8 w-auto" />
          </div>
          <p className="text-gray-400">Create your account</p>
        </div>

        <form onSubmit={handleSignup} className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Full Name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)} required
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          Already have an account?{' '}
          <a href="/login" className="text-[#22c55e] hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
