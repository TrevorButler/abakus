import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import logoFull from '../assets/brand/logo-full.png'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

// Same 5 domains as Landing.tsx's DOMAINS, reduced to a nav-bar shape --
// lets a user jump straight from inside one module (e.g. /acs/single/123)
// to another without backing out to "/" first.
const MODULES = [
  { to: '/acs', label: 'ACS' },
  { to: '/bls', label: 'BLS' },
  { to: '/pums', label: 'PUMS' },
  { to: '/costar', label: 'CoStar' },
  { to: '/smartre', label: 'SmartRE' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col bg-abakus-cream">
      <header className="border-b border-abakus-charcoal/10 px-6 py-4 flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-6 flex-wrap">
          <Link to="/" className="inline-block">
            <img src={logoFull} alt="Abakus" className="h-8 w-auto" />
          </Link>
          {user && (
            <nav className="flex items-center gap-4 text-sm flex-wrap">
              <Link
                to="/"
                className={location.pathname === '/' ? 'text-abakus-charcoal font-medium' : 'text-abakus-light-grey hover:text-abakus-charcoal transition-colors'}
              >
                Home
              </Link>
              {MODULES.map((mod) => (
                <Link
                  key={mod.to}
                  to={mod.to}
                  className={
                    location.pathname.startsWith(mod.to)
                      ? 'text-abakus-charcoal font-medium'
                      : 'text-abakus-light-grey hover:text-abakus-charcoal transition-colors'
                  }
                >
                  {mod.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
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
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-8">
      <img src={logoFull} alt="Abakus" className="h-48 md:h-60 w-auto" />

      <div className="flex flex-col items-center gap-2 text-center max-w-lg">
        <h1 className="font-sans text-2xl md:text-3xl text-abakus-charcoal font-medium tracking-tight">
          because the data shouldn't be the hard part
        </h1>
        <p className="text-abakus-light-grey text-sm max-w-sm">
          Abakus helps planners and civic professionals see the forest for the trees.
        </p>
      </div>

      {denied && (
        <p className="text-abakus-warm-400 text-sm max-w-xs text-center bg-abakus-warm-50 border border-abakus-warm-200 rounded-lg px-4 py-3">
          That Google account isn't on the allowlist. Ask an admin to add it, then try again.
        </p>
      )}

      <a
        href={api.auth.loginUrl()}
        className="flex items-center justify-center gap-3 bg-abakus-charcoal text-white font-medium px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
      >
        <GoogleGlyph />
        Sign in with Google
      </a>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  )
}
