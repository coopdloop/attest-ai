'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createConversationWithMessage } from '@/components/chat/ChatWindow'
import { ChatStarter } from '@/components/chat/ChatStarter'

const DEFAULT_MODEL = 'openrouter/ox-alpha'
const STORAGE_KEY = 'attest-ai:conversations'

interface StoredConvo {
  id: string
  messages?: { meta?: { session_id?: string } }[]
}

function ChatIndex() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionParam = searchParams.get('session')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.replace('/login'); return }

    // Deep-link from a trace: resolve the backend session_id to a local chat slug.
    if (sessionParam) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const convos: StoredConvo[] = raw ? JSON.parse(raw) : []
        const match = convos.find(c =>
          (c.messages ?? []).some(m => m.meta?.session_id === sessionParam)
        )
        if (match) { router.replace(`/chat/${match.id}`); return }
      } catch { /* fall through to starter */ }
    }
    setReady(true)
  }, [router, sessionParam])

  function start(text: string, model: string) {
    const id = createConversationWithMessage(model || DEFAULT_MODEL, text)
    router.push(`/chat/${id}`)
  }

  if (!ready) return <div className="h-screen bg-gray-950" />

  return <ChatStarter onStart={start} />
}

export default function ChatIndexPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-gray-950" />}>
      <ChatIndex />
    </Suspense>
  )
}
