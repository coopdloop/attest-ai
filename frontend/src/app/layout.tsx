import type { Metadata } from 'next'
import './globals.css'
import { AppShell } from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'attest-ai',
  description: 'Every thought, tool call, and decision — signed, timestamped, and yours to verify.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
