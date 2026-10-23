import { useEffect, useRef, useState } from 'react';

import Avatar from './Avatar';

// Live chat styled like YouTube's: header with viewer count, coloured avatars, Host/Mod tags,
// grey system lines ("X joined"), and an input pinned at the bottom. Messages arrive over the
// socket, so they appear for everyone the moment they are sent.
// React escapes text, so a message like "<script>" is shown literally, never executed.
export default function Chat({ messages, participants, myId, connected, onSend }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const stickToBottomRef = useRef(true);

  // Follow new messages, but only if the reader hasn't scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const roleOf = (userId) => participants.find((p) => p.id === userId)?.role;

  const submit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    stickToBottomRef.current = true;
    onSend(trimmed);
    setText('');
  };

  const me = participants.find((p) => p.id === myId);

  return (
    <section className="chat">
      <header className="chat-header">
        <span>Live chat</span>
        <span className="chat-count">{participants.length} watching</span>
      </header>

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && <p className="chat-empty">Welcome to the live chat! Say hi 👋</p>}
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="chat-row">
              <Avatar small name={m.username} src={participants.find((p) => p.id === m.userId)?.avatar} />
              <div className="chat-body">
                <span className={`chat-author role-${roleOf(m.userId) ?? 'participant'}`}>
                  {m.username}
                  {roleOf(m.userId) === 'host' && <span className="tag tag-host">Host</span>}
                  {roleOf(m.userId) === 'moderator' && <span className="tag tag-mod">🔧 Mod</span>}
                </span>
                <span className="chat-text">{m.text}</span>
              </div>
            </div>
          ),
        )}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <div className="chat-as">
          {me && <Avatar small name={me.username} src={me.avatar} />}
          <span>{me?.username ?? ''}</span>
          {!connected && <span className="chat-offline">offline</span>}
        </div>
        <div className="chat-input-row">
          <input
            type="text"
            value={text}
            maxLength={500}
            placeholder="Chat…"
            onChange={(e) => setText(e.target.value)}
            aria-label="Chat message"
          />

          <button className="icon-btn" type="submit" disabled={text.trim() === ''} aria-label="Send message">
            ➤
          </button>
        </div>
      </form>
    </section>
  );
}
