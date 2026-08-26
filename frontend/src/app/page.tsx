'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.replace('/login')
      return
    }

    // Verify the token is still valid before trusting it
    fetch('/auth/tokens/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.active) {
          router.replace('/chat')
        } else {
          localStorage.removeItem('auth_token')
          localStorage.removeItem('org_id')
          localStorage.removeItem('user_id')
          router.replace('/login')
        }
      })
      .catch(() => {
        router.replace('/login')
      })
  }, [router])

  return null
}
