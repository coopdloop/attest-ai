'use client'

import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/traces', label: 'Traces', icon: '🔍' },
  { href: '/harnesses', label: 'Harnesses', icon: '⚙️' },
  { href: '/admin', label: 'Admin', icon: '🔑' },
]

const NO_SIDEBAR_PATHS = ['/login', '/chat']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const showSidebar = !NO_SIDEBAR_PATHS.includes(pathname)

  if (!showSidebar) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen">
      <nav className="w-14 flex-shrink-0 bg-gray-900 border-r border-gray-800
                      flex flex-col items-center py-4 gap-2">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center
                        text-xs font-bold mb-4">
          A
        </div>
        {NAV_LINKS.map(link => (
          <a
            key={link.href}
            href={link.href}
            title={link.label}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-lg
                       text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            {link.icon}
          </a>
        ))}
      </nav>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
