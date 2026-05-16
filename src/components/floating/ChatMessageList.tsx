import { useEffect, useRef } from 'react';
import ChatBubble, { type ChatMessage } from './ChatBubble';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

export default function ChatMessageList({ messages }: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      data-tauri-drag-region="false"
      onPointerDown={(e) => e.stopPropagation()}
      className="w-full flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 scroll-smooth pointer-events-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="flex min-h-full flex-col justify-end gap-2">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
      </div>
    </div>
  );
}
