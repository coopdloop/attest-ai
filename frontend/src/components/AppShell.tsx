'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV_LINKS = [
  { href: '/chat', label: 'Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { href: '/dashboard', label: 'Command Center', icon: 'M3 3v18h18M7 14l3-3 3 3 5-5' },
  { href: '/trust', label: 'Trust Center', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { href: '/governance', label: 'Governance', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
  { href: '/traces', label: 'Traces', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { href: '/harnesses', label: 'Harnesses', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  { href: '/docs', label: 'Docs', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { href: '/admin', label: 'Admin', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
]

// Full-bleed pages with no app chrome (marketing + auth).
const NO_SHELL_PATHS = ['/', '/login']

const PIN_KEY = 'sidebar_pinned'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  // Transitions stay off until after the persisted pin state is applied, so a
  // pinned sidebar snaps open on navigation instead of sliding in every time.
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    setPinned(localStorage.getItem(PIN_KEY) === '1')
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function togglePin() {
    setPinned(prev => {
      const next = !prev
      localStorage.setItem(PIN_KEY, next ? '1' : '0')
      return next
    })
  }

  const showShell = !NO_SHELL_PATHS.includes(pathname) && !pathname.startsWith('/verify/')

  if (!showShell) {
    return <>{children}</>
  }

  function logout() {
    ['auth_token', 'org_id', 'user_id'].forEach(k => localStorage.removeItem(k))
    router.replace('/login')
  }

  const expanded = pinned || hovered

  return (
    <div className="flex h-screen">
      {/* Spacer keeps layout width; pinned reserves 13rem, otherwise a 3.5rem rail. */}
      <div className={`flex-shrink-0 ${animate ? 'transition-[width] duration-200 ease-out' : ''} ${pinned ? 'w-52' : 'w-14'}`} />
      <nav
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`fixed left-0 top-0 z-30 h-screen bg-gray-900 border-r border-gray-800
                    flex flex-col py-4 gap-2 ${animate ? 'transition-[width] duration-200 ease-out' : ''}
                    ${expanded ? 'w-52 shadow-xl' : 'w-14'}`}
      >
        <div className="flex items-center px-3 mb-4 h-8">
          <a href="/chat" title="attest-ai"
             className="w-8 h-8 flex-shrink-0 bg-blue-600 rounded-lg flex items-center justify-center
                        text-xs font-bold text-white">
            A
          </a>
          <span className={`ml-3 text-sm font-semibold text-gray-100 whitespace-nowrap overflow-hidden
                            transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
            attest-ai
          </span>
          {expanded && (
            <button
              onClick={togglePin}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              className={`ml-auto w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md
                         transition-colors ${pinned ? 'text-blue-400 bg-gray-800' : 'text-gray-500 hover:text-gray-100 hover:bg-gray-800'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
              </svg>
            </button>
          )}
        </div>

        {NAV_LINKS.map(link => {
          const active = pathname === link.href || pathname.startsWith(link.href + '/')
          return (
            <a
              key={link.href}
              href={link.href}
              title={link.label}
              className={`mx-2 h-9 flex items-center rounded-lg transition-colors
                         ${active ? 'text-blue-400 bg-gray-800' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'}`}
            >
              <span className="w-10 flex-shrink-0 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={link.icon} />
                </svg>
              </span>
              <span className={`text-sm whitespace-nowrap overflow-hidden transition-opacity duration-200
                               ${expanded ? 'opacity-100' : 'opacity-0'}`}>
                {link.label}
              </span>
            </a>
          )
        })}

        <button
          onClick={logout}
          title="Sign out"
          className="mt-auto mx-2 h-9 flex items-center rounded-lg
                     text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
        >
          <span className="w-10 flex-shrink-0 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </span>
          <span className={`text-sm whitespace-nowrap overflow-hidden transition-opacity duration-200
                           ${expanded ? 'opacity-100' : 'opacity-0'}`}>
            Sign out
          </span>
        </button>
      </nav>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
