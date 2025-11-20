import { useEffect, useState, useRef } from 'react';

// In dev, point to localhost; in prod, set VITE_API_BASE_URL to your Render URL
const API_BASE = 'https://ai-dm-backend-hdkl.onrender.com';

function App() {
  const [messages, setMessages] = useState([
    { sender: 'system', text: 'Welcome to your AI DM campaign.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stateSummary, setStateSummary] = useState(null);
  const chatEndRef = useRef(null);

  // Scroll to bottom on new message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load initial state summary
  useEffect(() => {
    const loadState = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/state`);
        if (!res.ok) return;
        const data = await res.json();
        setStateSummary({
          party: data.party,
          economy: data.economy
        });
      } catch (err) {
        console.error('Failed to load state', err);
      }
    };
    loadState();
  }, []);

    const sendTurn = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const playerText = input.trim();
    setMessages((msgs) => [
      ...msgs,
      { sender: 'player', text: playerText }
    ]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerInput: playerText })
      });

      const text = await res.text();

      if (!res.ok) {
        console.error('Backend error:', res.status, text);
        setMessages((msgs) => [
          ...msgs,
          {
            sender: 'system',
            text: `Backend error ${res.status}: ${text.slice(0, 200)}`
          }
        ]);
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('Failed to parse JSON from backend:', parseErr, text);
        setMessages((msgs) => [
          ...msgs,
          {
            sender: 'system',
            text: 'Backend returned invalid JSON.'
          }
        ]);
        return;
      }

      setMessages((msgs) => [
        ...msgs,
        { sender: 'dm', text: data.dmOutput }
      ]);

      if (data.stateSummary) {
        setStateSummary(data.stateSummary);
      }
    } catch (err) {
      console.error('Request error:', err);
      setMessages((msgs) => [
        ...msgs,
        { sender: 'system', text: `Network error: ${String(err)}` }
      ]);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={styles.app}>
      <header style={styles.header}>
  <div>
    <h1 style={styles.title}>AI DM Engine</h1>
    <p style={styles.subtitle}>Persistent, drift-proof campaigns</p>
    <p style={{ fontSize: '0.7rem', opacity: 0.7 }}>
      API_BASE: {API_BASE}
    </p>
  </div>
</header>


      <div style={styles.content}>
        <section style={styles.chatSection}>
          <div style={styles.chatBox}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  ...styles.message,
                  ...(msg.sender === 'player'
                    ? styles.playerMessage
                    : msg.sender === 'dm'
                    ? styles.dmMessage
                    : styles.systemMessage)
                }}
              >
                <strong>{msg.sender.toUpperCase()}:</strong> {msg.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendTurn} style={styles.form}>
            <input
              type="text"
              placeholder="What do you do?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={styles.input}
            />
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? '...' : 'Send'}
            </button>
          </form>
        </section>

        <section style={styles.stateSection}>
          <h2 style={styles.sectionTitle}>Campaign State</h2>
          {stateSummary ? (
            <div style={styles.stateContent}>
              <h3>Party</h3>
              <ul style={styles.list}>
                {Object.entries(stateSummary.party || {}).map(([name, info]) => (
                  <li key={name} style={styles.listItem}>
                    <strong>{name}</strong> – {info.class} | HP: {info.hp} | AC: {info.ac}
                  </li>
                ))}
              </ul>
              <h3>Economy</h3>
              <p>Party Gold: {stateSummary.economy?.party_gold}</p>
              {stateSummary.economy?.debts && (
                <ul style={styles.list}>
                  {Object.entries(stateSummary.economy.debts).map(([who, amt]) => (
                    <li key={who} style={styles.listItem}>
                      {who}: {amt}g
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p>Loading state…</p>
          )}
        </section>
      </div>
    </div>
  );
}

const styles = {
  app: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  },
  header: {
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #e5e5e5',
    background: '#111827',
    color: '#f9fafb'
  },
  title: {
    fontSize: '1.25rem',
    margin: 0
  },
  subtitle: {
    fontSize: '0.8rem',
    margin: 0,
    opacity: 0.8
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'row',
    gap: '0.75rem',
    padding: '0.75rem',
    overflow: 'hidden'
  },
  chatSection: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0
  },
  chatBox: {
    flex: 1,
    border: '1px solid #e5e5e5',
    borderRadius: '0.75rem',
    padding: '0.75rem',
    overflowY: 'auto',
    background: '#f9fafb'
  },
  message: {
    padding: '0.4rem 0.55rem',
    marginBottom: '0.3rem',
    borderRadius: '0.5rem',
    fontSize: '0.9rem'
  },
  playerMessage: {
    background: '#dbeafe'
  },
  dmMessage: {
    background: '#fef3c7'
  },
  systemMessage: {
    background: '#e5e7eb',
    fontStyle: 'italic'
  },
  form: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '0.5rem'
  },
  input: {
    flex: 1,
    padding: '0.6rem 0.75rem',
    borderRadius: '999px',
    border: '1px solid #d1d5db',
    fontSize: '0.95rem'
  },
  button: {
    padding: '0.6rem 1rem',
    borderRadius: '999px',
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer'
  },
  stateSection: {
    flex: 1,
    border: '1px solid #e5e5e5',
    borderRadius: '0.75rem',
    padding: '0.75rem',
    minWidth: 0,
    overflowY: 'auto',
    background: '#ffffff'
  },
  sectionTitle: {
    fontSize: '1rem',
    margin: '0 0 0.5rem 0'
  },
  stateContent: {
    fontSize: '0.9rem'
  },
  list: {
    listStyle: 'none',
    paddingLeft: 0,
    margin: '0.25rem 0 0.5rem 0'
  },
  listItem: {
    marginBottom: '0.25rem'
  }
};

export default App;
