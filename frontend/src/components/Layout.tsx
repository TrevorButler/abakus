import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import logoFull from '../assets/brand/logo-full.png'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

export default function Layout({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()

  return (
    <div className="min-h-screen flex flex-col bg-abakus-cream">
      <header className="border-b border-abakus-charcoal/10 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="inline-block">
          <img src={logoFull} alt="Abakus" className="h-8 w-auto" />
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm text-abakus-light-grey">
            <span>{user.email}</span>
            {user.role === 'admin' && (
              <Link to="/admin" className="text-abakus-blue hover:underline">
                Admin
              </Link>
            )}
            <a href={api.auth.logoutUrl()} className="text-abakus-blue hover:underline">
              Sign out
            </a>
          </div>
        )}
      </header>
      <main className="flex-1 flex flex-col">
        {loading ? null : user ? children : <SignInScreen />}
      </main>
    </div>
  )
}

function SignInScreen() {
  const denied = new URLSearchParams(window.location.search).get('denied') === '1'

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <p className="text-abakus-charcoal text-lg font-medium">Sign in to continue</p>
      {denied && (
        <p className="text-red-600 text-sm max-w-sm text-center">
          That Google account isn't on the allowlist. Ask an admin to add it, then try again.
        </p>
      )}
      <p className="text-abakus-light-grey text-sm max-w-sm text-center">
        Access is limited to allowlisted accounts. Sign in with the Google account an admin has added.
      </p>
      <a
        href={api.auth.loginUrl()}
        className="bg-abakus-pink text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity"
      >
        Sign in with Google
      </a>
    </div>
  )
}
