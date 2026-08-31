'use client'

import { useState, useEffect } from 'react'

interface OrgUser {
  id: string
  email: string
  display_name: string
  role: 'admin' | 'member' | 'viewer' | 'auditor'
  is_active: boolean
  created_at: string
}

interface APIKey {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  revoked_at: string | null
}

function getAuth(): { token: string; orgId: string } | null {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('auth_token')
  const orgId = localStorage.getItem('org_id')
  if (!token || !orgId) return null
  return { token, orgId }
}

export default function AdminPage() {
  const [users, setUsers] = useState<OrgUser[]>([])
  const [apiKeys, setApiKeys] = useState<APIKey[]>([])
  const [activeTab, setActiveTab] = useState<'users' | 'keys'>('users')
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyBudget, setNewKeyBudget] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const auth = getAuth()

  useEffect(() => {
    if (!auth) { setLoading(false); return }
    const { token, orgId } = auth
    const h = { Authorization: `Bearer ${token}` }

    Promise.all([
      fetch(`/auth/orgs/${orgId}/users`, { headers: h }).then(r => r.json()),
      fetch(`/auth/orgs/${orgId}/api-keys`, { headers: h }).then(r => r.json()),
    ])
      .then(([u, k]) => {
        setUsers(Array.isArray(u) ? u : (u.users ?? []))
        setApiKeys(Array.isArray(k) ? k : (k?.keys ?? []))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function revokeKey(id: string) {
    if (!auth) return
    const { token, orgId } = auth
    await fetch(`/auth/orgs/${orgId}/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setApiKeys(prev => prev.map(k => k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k))
  }

  async function createKey() {
    if (!auth || !newKeyName.trim()) return
    const { token, orgId } = auth
    const budget = parseFloat(newKeyBudget)
    const res = await fetch(`/auth/orgs/${orgId}/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newKeyName,
        scopes: ['chat', 'trace:read'],
        ...(isFinite(budget) && budget > 0 ? { budget_usd: budget } : {}),
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    setCreatedKey(data.key ?? null)
    setNewKeyName('')
    setNewKeyBudget('')
    setApiKeys(prev => [{ id: data.id, name: newKeyName, key_prefix: (data.key ?? '').slice(0, 8), scopes: ['chat', 'trace:read'], created_at: new Date().toISOString(), revoked_at: null }, ...prev])
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>
  if (!auth) return (
    <div className="p-8 text-yellow-400">
      Not authenticated. Log in and ensure <code className="text-xs bg-gray-800 px-1 rounded">auth_token</code> and <code className="text-xs bg-gray-800 px-1 rounded">org_id</code> are set in localStorage.
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="text-sm text-gray-400 mt-1">Manage users and API keys for your organization</p>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {createdKey && (
        <div className="mx-6 mt-4 px-4 py-3 bg-green-900/30 border border-green-800 rounded">
          <p className="text-green-300 text-sm font-medium mb-1">API key created — copy it now, it won't be shown again:</p>
          <code className="text-green-200 text-xs break-all">{createdKey}</code>
          <button
            className="ml-3 text-xs text-green-400 hover:text-green-200"
            onClick={() => { navigator.clipboard.writeText(createdKey); setCreatedKey(null) }}
          >
            Copy & dismiss
          </button>
        </div>
      )}

      <div className="flex gap-1 px-6 pt-4">
        {(['users', 'keys'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm rounded-t border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab === 'users' ? 'Users' : 'API Keys'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {activeTab === 'users' && (
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2 pr-4">Email</th>
                <th className="text-left py-2 pr-4">Name</th>
                <th className="text-left py-2 pr-4">Role</th>
                <th className="text-left py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-2 pr-4 text-gray-200">{u.email}</td>
                  <td className="py-2 pr-4 text-gray-300">{u.display_name || '—'}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      u.role === 'admin' ? 'bg-purple-900/60 text-purple-300' :
                      u.role === 'auditor' ? 'bg-yellow-900/60 text-yellow-300' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={`text-xs ${u.is_active ? 'text-green-400' : 'text-red-400'}`}>
                      {u.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-gray-500">No users found</td></tr>
              )}
            </tbody>
          </table>
        )}

        {activeTab === 'keys' && (
          <div className="mt-4">
            <div className="flex gap-2 mb-4">
              <input
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                placeholder="Key name (e.g. ci-pipeline)"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                           text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                value={newKeyBudget}
                onChange={e => setNewKeyBudget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                type="number"
                min="0"
                step="0.5"
                placeholder="Budget $ (optional)"
                className="w-40 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm
                           text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={createKey}
                disabled={!newKeyName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                           text-sm rounded transition-colors"
              >
                Create
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800">
                  <th className="text-left py-2 pr-4">Name</th>
                  <th className="text-left py-2 pr-4">Prefix</th>
                  <th className="text-left py-2 pr-4">Scopes</th>
                  <th className="text-left py-2 pr-4">Created</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map(k => (
                  <tr key={k.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="py-2 pr-4 text-gray-200">{k.name}</td>
                    <td className="py-2 pr-4 font-mono text-gray-400 text-xs">{k.key_prefix}…</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {(k.scopes ?? []).map(s => (
                          <span key={s} className="px-1.5 py-0.5 bg-gray-800 rounded text-xs text-gray-400">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      {k.revoked_at ? (
                        <span className="text-xs text-red-400">revoked</span>
                      ) : (
                        <button
                          onClick={() => revokeKey(k.id)}
                          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-500">No API keys</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
