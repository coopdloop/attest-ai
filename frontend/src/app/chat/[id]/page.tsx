'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChatWindow } from '@/components/chat/ChatWindow'

export default function ChatSessionPage() {
  const router = useRouter()
  const params = useParams()
  const chatId = String(params.id)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('auth_token')) {
      router.replace('/login')
      return
    }
    setReady(true)
  }, [router])

  if (!ready) return <div className="h-screen bg-gray-950" />

  return <ChatWindow chatId={chatId} />
}
