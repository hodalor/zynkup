import { useEffect, useMemo, useState } from 'react';
import { api, clearSession, loadSession, saveSession } from './api.js';

const NAV = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['numbers', 'Blocked numbers'],
  ['marketplace', 'Marketplace'],
  ['payments', 'Payments'],
  ['activity', 'Activity'],
  ['announcements', 'Announcements'],
  ['settings', 'Settings'],
];

const money = (amount, currency) => `${currency || ''} ${Number(amount || 0).toLocaleString()}`;

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@zynkup.app');
  const [password, setPassword] = useState('');
  const [apiBase, setApiBase] = useState(loadSession()?.apiBase || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const session = { apiBase, token: '', email };
    try {
      const payload = await api('/api/admin/login', { method: 'POST', body: { email, password } }, session);
      const next = { apiBase, token: payload.token, email: payload.email };
      saveSession(next);
      onLogin(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div className="logo">Z</div>
        <h1>ZynkAdmin</h1>
        <p className="muted">Sign in to the same database the phones are using.</p>
        <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="API address" />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Admin email" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Admin password" type="password" />
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function Cards({ items }) {
  return (
    <div className="cards">
      {items.map(([label, value]) => (
        <div className="card" key={label}><span>{label}</span><b>{value}</b></div>
      ))}
    </div>
  );
}

function Table({ columns, rows, onRow }) {
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.id} className={onRow ? 'clickable' : ''} role={onRow ? 'button' : undefined} tabIndex={onRow ? 0 : undefined} onClick={() => onRow?.(row)}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
            </tr>
          )) : <tr><td colSpan={columns.length}>Nothing here yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Detail({ row }) {
  return (
    <div className="detail-grid">
      {Object.entries(row).filter(([key]) => key !== 'id').map(([key, value]) => (
        <FragmentRow key={key} label={key} value={value} />
      ))}
    </div>
  );
}

function FragmentRow({ label, value }) {
  const shown = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return (
    <>
      <span className="muted">{label}</span>
      <span>{shown}</span>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession());
  const [page, setPage] = useState('overview');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});

  const load = async (nextPage = page) => {
    if (!session?.token) return;
    setError('');
    const routes = {
      overview: '/api/admin/overview',
      users: `/api/admin/users?q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`,
      numbers: '/api/admin/blocks',
      marketplace: '/api/admin/catalog',
      payments: '/api/admin/payments',
      activity: '/api/admin/activity',
      announcements: '/api/admin/announcements',
      settings: '/api/admin/config',
    };
    try {
      setData(await api(routes[nextPage], {}, session));
    } catch (err) {
      setData(null);
      setError(err.message);
      if (err.status === 401) {
        clearSession();
        setSession(null);
      }
    }
  };

  useEffect(() => {
    void load(page);
  }, [page, session?.token]);

  const title = NAV.find((item) => item[0] === page)?.[1] || 'Overview';
  const rows = useMemo(() => {
    if (!data) return [];
    if (page === 'users') return data.users || [];
    if (page === 'numbers') return data.blocks || [];
    if (page === 'marketplace') return data.items || [];
    if (page === 'payments') return data.payments || [];
    if (page === 'activity') return data.messages || [];
    if (page === 'announcements') return data.announcements || [];
    return [];
  }, [data, page]);

  if (!session?.token) return <Login onLogin={setSession} />;

  const act = async (path, body, method = 'POST') => {
    await api(path, { method, body }, session);
    setModal(null);
    await load();
  };

  return (
    <div className="app-shell">
      <div className="brand">
        <div className="logo">Z</div>
        <div><strong>ZynkAdmin</strong><span>Live operations</span></div>
      </div>
      <header className="topbar">
        <h1>{title}</h1>
        <button className="ghost" onClick={() => { clearSession(); setSession(null); }}>Sign out</button>
      </header>
      <nav className="sidebar">
        {NAV.map(([id, label]) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setQuery(''); setModal(null); }}>{label}</button>
        ))}
      </nav>
      <main className="content">
        {error ? <p className="error">{error}</p> : null}
        {page === 'overview' && data ? (
          <>
            <Cards items={[
              ['Registered users', data.cards.users],
              ['Messages', data.cards.messages],
              ['Calls', data.cards.calls],
              ['Products', data.cards.products],
              ['Statuses', data.cards.statuses],
              ['Pending boosts', data.cards.pendingBoosts],
              ['Blocked numbers', data.cards.blockedNumbers],
              ['Payments', data.cards.payments],
            ]} />
            <div className="charts">
              <section className="panel">
                <h3>Users by country</h3>
                {(data.usersByCountry || []).map((item) => (
                  <div className="bar-row" key={item.name}>
                    <span>{item.name}</span>
                    <div className="bar"><i style={{ width: `${Math.max(8, (item.count / (data.cards.users || 1)) * 100)}%` }} /></div>
                    <b>{item.count}</b>
                  </div>
                ))}
                {data.usersByCountry?.length ? null : <p className="muted">No registered users yet.</p>}
              </section>
              <section className="panel">
                <h3>Messages by day</h3>
                {(data.messagesByDay || []).map((item) => (
                  <div className="bar-row" key={item.day}>
                    <span>{item.day.slice(5)}</span>
                    <div className="bar"><i style={{ width: `${Math.min(100, item.count * 8)}%` }} /></div>
                    <b>{item.count}</b>
                  </div>
                ))}
                {data.messagesByDay?.length ? null : <p className="muted">No messages yet.</p>}
              </section>
            </div>
          </>
        ) : null}

        {page !== 'overview' && page !== 'settings' ? (
          <div className="toolbar">
            <div className="filters">
              {page === 'users' ? (
                <>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, country" />
                  <select value={country} onChange={(event) => setCountry(event.target.value)}>
                    <option value="">All countries</option>
                    {(data?.countries || []).map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <button className="ghost" onClick={() => load()}>Apply</button>
                </>
              ) : <span className="muted">{rows.length} records</span>}
            </div>
            <button className="primary" onClick={() => { setForm({}); setModal({ kind: 'create' }); }}>
              {page === 'numbers' ? 'Block number' : page === 'announcements' ? 'Send notice' : page === 'marketplace' ? 'Review boosts' : 'Refresh'}
            </button>
          </div>
        ) : null}

        {page === 'users' ? (
          <Table
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'phone', label: 'Phone' },
              { key: 'country', label: 'Country' },
              { key: 'messages', label: 'Messages' },
              { key: 'calls', label: 'Calls' },
              { key: 'blocked', label: 'Status', render: (row) => row.blocked ? 'Blocked' : row.presence },
            ]}
            rows={rows}
            onRow={(row) => setModal({ kind: 'user', row })}
          />
        ) : null}
        {page === 'numbers' ? (
          <Table
            columns={[
              { key: 'phone', label: 'Number' },
              { key: 'reason', label: 'Reason' },
              { key: 'until', label: 'Wait ends', render: (row) => row.until ? new Date(row.until).toLocaleString() : 'Permanent' },
            ]}
            rows={rows}
            onRow={(row) => setModal({ kind: 'block', row })}
          />
        ) : null}
        {page === 'marketplace' ? (
          <>
            <Cards items={[['Live products', data?.items?.length || 0], ['Boost requests', (data?.requests || []).length], ['Pending', (data?.requests || []).filter((row) => row.state === 'pending').length], ['Approved', (data?.requests || []).filter((row) => row.state === 'approved').length]]} />
            <Table
              columns={[
                { key: 'title', label: 'Product' },
                { key: 'sellerName', label: 'Seller' },
                { key: 'price', label: 'Price', render: (row) => `${row.currency || ''} ${row.price ?? ''}` },
                { key: 'category', label: 'Category' },
                { key: 'isPublic', label: 'Marketplace', render: (row) => row.takenDown ? 'Taken down' : row.isPublic ? 'Live' : 'Private' },
              ]}
              rows={rows}
              onRow={(row) => setModal({ kind: 'detail', row })}
            />
            <h3>Boost requests</h3>
            <Table
              columns={[
                { key: 'title', label: 'Product' },
                { key: 'sellerName', label: 'Seller' },
                { key: 'days', label: 'Days' },
                { key: 'state', label: 'State' },
                { key: 'note', label: 'Boost text' },
              ]}
              rows={data?.requests || []}
              onRow={(row) => setModal({ kind: 'boost', row })}
            />
          </>
        ) : null}
        {page === 'payments' ? (
          <>
            <Cards items={[['Transactions', data?.count || 0], ['Volume', money(data?.total)], ['Latest', rows[0]?.status || '—'], ['Currency', rows[0]?.currency || '—']]} />
            <Table columns={[{ key: 'createdAt', label: 'When', render: (row) => new Date(row.createdAt).toLocaleString() }, { key: 'action', label: 'Type' }, { key: 'amount', label: 'Amount', render: (row) => money(row.amount, row.currency) }, { key: 'status', label: 'Status' }, { key: 'note', label: 'Note' }]} rows={rows} onRow={(row) => setModal({ kind: 'detail', row })} />
          </>
        ) : null}
        {page === 'activity' ? (
          <>
            <Cards items={[['Messages', rows.length], ['Calls', data?.calls?.length || 0], ['Latest sender', rows[0]?.senderName || '—'], ['Latest call', data?.calls?.[0]?.state || '—']]} />
            <Table columns={[{ key: 'sentAt', label: 'When', render: (row) => new Date(row.sentAt).toLocaleString() }, { key: 'senderName', label: 'From' }, { key: 'kind', label: 'Kind' }, { key: 'text', label: 'Preview' }]} rows={rows} onRow={(row) => setModal({ kind: 'detail', row })} />
            <h3>Calls</h3>
            <Table
              columns={[
                { key: 'startedAt', label: 'When', render: (row) => row.startedAt ? new Date(row.startedAt).toLocaleString() : '' },
                { key: 'initiatorName', label: 'From' },
                { key: 'kind', label: 'Type' },
                { key: 'state', label: 'State' },
                { key: 'durationSeconds', label: 'Seconds' },
              ]}
              rows={data?.calls || []}
              onRow={(row) => setModal({ kind: 'detail', row })}
            />
          </>
        ) : null}
        {page === 'announcements' ? (
          <>
            <Cards items={[['Banner live', data?.config?.bannerActive ? 'Yes' : 'No'], ['Notices', rows.length], ['Anonymous limit', data?.config?.anonymousDailyLimit ?? '—'], ['Banner', data?.config?.bannerText ? 'Set' : 'Empty']]} />
            <Table columns={[{ key: 'title', label: 'Title' }, { key: 'body', label: 'Message' }, { key: 'createdAt', label: 'Sent', render: (row) => new Date(row.createdAt).toLocaleString() }]} rows={rows} onRow={(row) => setModal({ kind: 'detail', row })} />
          </>
        ) : null}
        {page === 'settings' && data?.config ? (
          <section className="panel stack">
            <Cards items={[['Anonymous messages / day', data.config.anonymousDailyLimit], ['Banner', data.config.bannerActive ? 'Showing' : 'Hidden'], ['Text', data.config.bannerText ? 'Ready' : 'None'], ['Applies to', 'Every phone']]} />
            <label>Anonymous allowance per room per day
              <input type="number" min="0" max="100" defaultValue={data.config.anonymousDailyLimit} onChange={(event) => setForm((current) => ({ ...current, anonymousDailyLimit: Number(event.target.value) }))} />
            </label>
            <textarea defaultValue={data.config.bannerText} placeholder="Banner shown inside the app" onChange={(event) => setForm((current) => ({ ...current, bannerText: event.target.value }))} />
            <label><input type="checkbox" defaultChecked={data.config.bannerActive} onChange={(event) => setForm((current) => ({ ...current, bannerActive: event.target.checked }))} /> Show banner to everyone</label>
            <button className="primary" onClick={() => act('/api/admin/config', { ...data.config, ...form }, 'PATCH')}>Save settings</button>
          </section>
        ) : null}
      </main>
      <footer className="footer"><span>ZynkUp control room</span><span>{session.email}</span></footer>

      {modal?.kind === 'user' ? (
        <Modal title={modal.row.name} onClose={() => setModal(null)}>
          <Detail row={modal.row} />
          <div className="toolbar">
            <button className="danger" onClick={() => act(`/api/admin/users/${modal.row.id}/block`, { reason: 'Blocked from admin', until: null })}>Block</button>
            <button className="ghost" onClick={() => act(`/api/admin/users/${modal.row.id}/unblock`, {})}>Unblock</button>
          </div>
          <div className="stack">
            <input placeholder="New 4-6 digit PIN" value={form.pin || ''} onChange={(event) => setForm({ pin: event.target.value })} />
            <button className="primary" onClick={() => act(`/api/admin/users/${modal.row.id}/pin`, { pin: form.pin })}>Reset PIN</button>
          </div>
        </Modal>
      ) : null}
      {modal?.kind === 'create' && page === 'numbers' ? (
        <Modal title="Block a number" onClose={() => setModal(null)}>
          <div className="stack">
            <input placeholder="Phone number" value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <input placeholder="Reason" value={form.reason || ''} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            <input type="datetime-local" onChange={(event) => setForm({ ...form, until: event.target.value ? new Date(event.target.value).toISOString() : null })} />
            <p className="muted">Leave the date empty to block the number from registering at all. A date lets them see a countdown.</p>
            <button className="primary" onClick={() => act('/api/admin/blocks', { phone: form.phone, reason: form.reason, until: form.until || null })}>Block number</button>
          </div>
        </Modal>
      ) : null}
      {modal?.kind === 'create' && page === 'announcements' ? (
        <Modal title="Message every user" onClose={() => setModal(null)}>
          <div className="stack">
            <input placeholder="Title" value={form.title || ''} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <textarea placeholder="This becomes the in-app banner" value={form.body || ''} onChange={(event) => setForm({ ...form, body: event.target.value })} />
            <button className="primary" onClick={() => act('/api/admin/announcements', { title: form.title, body: form.body })}>Publish banner</button>
          </div>
        </Modal>
      ) : null}
      {modal?.kind === 'create' && page !== 'numbers' && page !== 'announcements' ? (
        <Modal title={title} onClose={() => { setModal(null); void load(); }}>
          <p className="muted">This list is loaded from the API. Use a row to open its actions.</p>
          <button className="primary" onClick={() => { setModal(null); void load(); }}>Refresh</button>
        </Modal>
      ) : null}
      {modal?.kind === 'block' ? (
        <Modal title={modal.row.phone} onClose={() => setModal(null)}>
          <Detail row={modal.row} />
          <button className="primary" onClick={() => act(`/api/admin/blocks/${modal.row.id}`, {}, 'DELETE')}>Remove block</button>
        </Modal>
      ) : null}
      {modal?.kind === 'boost' ? (
        <Modal title={modal.row.title || 'Boost'} onClose={() => setModal(null)}>
          <Detail row={modal.row} />
          <div className="stack">
            <input type="number" min="1" max="90" placeholder="Days on top" value={form.days || modal.row.days || 7} onChange={(event) => setForm({ ...form, days: Number(event.target.value) })} />
            <textarea placeholder="Text attached to the featured product" value={form.boostText ?? modal.row.note ?? ''} onChange={(event) => setForm({ ...form, boostText: event.target.value })} />
            <button className="primary" onClick={() => act(`/api/admin/catalog/${modal.row.itemId}/boost`, { days: Number(form.days || modal.row.days || 7), boostText: form.boostText ?? modal.row.note })}>Approve and feature</button>
            <button className="danger" onClick={() => act(`/api/admin/boosts/${modal.row.id}/reject`, {})}>Reject</button>
          </div>
        </Modal>
      ) : null}
      {modal?.kind === 'detail' ? (
        <Modal title="Details" onClose={() => setModal(null)}>
          <Detail row={modal.row} />
        </Modal>
      ) : null}
    </div>
  );
}
