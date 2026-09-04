'use client'

export interface ConversationTurn {
  turn_index: number
  user_message: string
  agent_response: string
  status: string
  model_id?: string
}

export function Conversation({ turns }: { turns: ConversationTurn[] }) {
  if (turns.length === 0) return null
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Conversation</h2>
      <div className="space-y-4">
        {turns.map(t => (
          <div key={t.turn_index} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-blue-600/20 border border-blue-800/50 rounded-lg px-3 py-2 text-xs text-gray-100 whitespace-pre-wrap">
                {t.user_message}
              </div>
            </div>
            {t.agent_response && (
              <div className="flex justify-start">
                <div className="max-w-[80%] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-200 whitespace-pre-wrap">
                  {t.agent_response}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
