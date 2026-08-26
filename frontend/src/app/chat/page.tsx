'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatWindow } from '@/components/chat/ChatWindow'

export default function ChatPage() {
  const router = useRouter()

  useEffect(() => {
    if (!localStorage.getItem('auth_token')) {
      router.replace('/login')
    }
  }, [router])

  return <ChatWindow />
}
