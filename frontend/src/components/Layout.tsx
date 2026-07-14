import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import logoFull from '../assets/brand/logo-full.png'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-abakus-cream">
      <header className="border-b border-abakus-charcoal/10 px-6 py-4">
        <Link to="/" className="inline-block">
          <img src={logoFull} alt="Abakus" className="h-8 w-auto" />
        </Link>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  )
}
