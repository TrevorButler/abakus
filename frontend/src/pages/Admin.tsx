import { useEffect, useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, type AppUser, type UserRole } from '../lib/api'

export default function Admin() {
  const { user } = useAuth()

  // UX only -- the backend's require_admin dependency is the real
  // enforcement, this just avoids flashing the page at a non-admin.
  if (user?.role !== 'admin') return <Navigate to="/" replace />

  return <AdminPanel currentEmail={user.email} />
}

function AdminPanel({ currentEmail }: { currentEmail: string }) {
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('user')
  const [busy, setBusy] = useState(false)

  function load() {
    api.admin
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
  }

  useEffect(load, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.admin.addUser(newEmail.trim(), newRole)
      setNewEmail('')
      setNewRole('user')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add user')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(email: string) {
    setBusy(true)
    setError(null)
    try {
      await api.admin.removeUser(email)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove user')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Admin</h1>
        <p className="text-abakus-light-grey">Manage who can sign in to Abakus.</p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="w-full max-w-xl">
        <ul className="border border-abakus-charcoal/10 rounded-lg bg-white divide-y divide-abakus-charcoal/5">
          {users === null && <li className="px-4 py-3 text-sm text-abakus-light-grey">Loading...</li>}
          {users?.length === 0 && <li className="px-4 py-3 text-sm text-abakus-light-grey">No users yet.</li>}
          {users?.map((u) => (
            <li key={u.email} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-abakus-charcoal">{u.email}</p>
                <p className="text-xs text-abakus-light-grey">{u.role}</p>
              </div>
              <button
                type="button"
                disabled={busy || u.email === currentEmail}
                onClick={() => handleRemove(u.email)}
                className="text-sm text-red-600 hover:underline disabled:opacity-40 disabled:no-underline"
                title={u.email === currentEmail ? "You can't remove yourself" : undefined}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAdd} className="mt-6 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-abakus-light-grey mb-1">Email</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@kbagroup.com"
              className="w-full border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-abakus-charcoal"
            />
          </div>
          <div>
            <label className="block text-xs text-abakus-light-grey mb-1">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-abakus-charcoal"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="bg-abakus-pink text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back home
      </Link>
    </div>
  )
}
