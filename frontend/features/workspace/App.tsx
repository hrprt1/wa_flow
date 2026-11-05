'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Moon,
  Package,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { api } from './api';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from '@/lib/theme';
import { IntegrationSettings, BillingPanel } from './Integrations';
import { Customers } from './Customers';
import { Campaigns } from './Campaigns';
import type { Conversation, User, Workspace } from './types';

const navigation = [
  ['Overviews', LayoutDashboard],
  ['Inbox', MessageCircle],
  ['Customers', Users],
  ['Automations', Workflow],
  ['Knowledge base', BookOpen],
  ['Products', Package],
  ['Campaigns', Megaphone],
] as const;
type Page = (typeof navigation)[number][0] | 'Settings' | 'Usage & plan';
const paths: Record<Page, string> = {
  Overviews: '',
  Inbox: 'inbox',
  Customers: 'customers',
  Automations: 'automations',
  'Knowledge base': 'knowledge',
  Products: 'products',
  Campaigns: 'campaigns',
  Settings: 'settings',
  'Usage & plan': 'billing',
};
type Modal =
  | 'customers'
  | 'products'
  | 'automations'
  | 'knowledge'
  | 'campaigns'
  | 'simulate'
  | 'help'
  | null;
const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('');
const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
const time = (value: string) =>
  new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toLocaleTimeString(
    'en-IN',
    { hour: 'numeric', minute: '2-digit' },
  );

function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <MessageCircle size={30} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export default function App() {
  const router = useRouter();
  const pathname = usePathname();
  const pageNames: Record<string, Page> = {
    inbox: 'Inbox',
    customers: 'Customers',
    automations: 'Automations',
    knowledge: 'Knowledge base',
    products: 'Products',
    campaigns: 'Campaigns',
    settings: 'Settings',
    billing: 'Usage & plan',
  };
  const workspacePage = pageNames[pathname.split('/')[2]] || 'Overviews';
  const [darkMode, setDarkMode] = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const page = workspacePage;
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const selectedConversation = useRef<number | null>(null);
  selectedConversation.current = selected;
  const [mobile, setMobile] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLButtonElement>('.sidebar-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobile(false);
      }
      if (event.key === 'Tab' && sidebar) {
        const controls = Array.from(
          sidebar.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),input,select,textarea,[tabindex='0']",
          ),
        ).filter(
          (element) =>
            element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden',
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const desktop = window.matchMedia('(min-width:761px)');
    const onResize = () => {
      if (desktop.matches) setMobile(false);
    };
    document.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onResize);
      menuButton.current?.focus({ preventScroll: true });
    };
  }, [mobile]);
  const [days, setDays] = useState(14);

  async function refresh() {
    const conversationId = selectedConversation.current;
    const next = await api<Workspace>(
      conversationId ? `workspace?conversation_id=${conversationId}` : 'workspace',
    );
    // An older background response must not discard a conversation just opened from a later contact page.
    if (selectedConversation.current === conversationId) setWorkspace(next);
  }
  async function session() {
    const data = await api<{ user: User | null; demo_available: boolean }>('session');
    if (!data.user) {
      router.replace('/login');
      return;
    }
    setUser(data.user);
    await refresh();
  }
  useEffect(() => {
    session()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    if (workspace && !workspace.conversations.some((c) => c.id === selected)) {
      setSelected(workspace.conversations[0]?.id ?? null);
    }
  }, [workspace, selected]);
  useEffect(() => {
    if (!user || !workspace?.integrations.whatsapp) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [user?.id, workspace?.integrations.whatsapp?.phone_number_id]);
  async function mutate(path: string, method: string, body: unknown, message = 'Changes saved') {
    setBusy(true);
    setError('');
    try {
      await api(path, method, body);
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page) {
    router.push(`/app/${paths[next]}`);
    setQuery('');
    setMobile(false);
    setError('');
  }
  async function openConversation(c: Conversation) {
    setSelected(c.id);
    navigate('Inbox');
    if (c.unread)
      await mutate(`conversations/${c.id}`, 'PATCH', { unread: 0 }, 'Conversation marked as read');
  }
  async function logout() {
    setBusy(true);
    try {
      await api('auth/logout', 'POST');
      router.replace('/login');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <div className="brand-icon">
          <MessageCircle />
        </div>
        <h2>Opening your workspace…</h2>
      </div>
    );
  if (!workspace || !user)
    return (
      <div className="loading">
        <h2>We couldn’t load your workspace</h2>
        <p>{error}</p>
        <button onClick={() => session().catch((e) => setError(e.message))}>Try again</button>
        <button onClick={logout}>Sign out</button>
      </div>
    );
  const w = workspace;
  const current = w.conversations.find((c) => c.id === selected) || w.conversations[0];
  const filtered = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const pageInfo: Record<Page, [string, string]> = {
    Overviews: [
      'A little overview. A lot of possibility.',
      'Here’s what’s happening with your business today.',
    ],
    Inbox: ['Good conversations start here.', 'A shared space for every customer conversation.'],
    Customers: [
      'People, not just contacts.',
      'Build lasting relationships, one conversation at a time.',
    ],
    Automations: [
      'A helping hand, on autopilot.',
      'Create keyword replies and test them in your demo inbox.',
    ],
    'Knowledge base': [
      'Your business, in the know.',
      'Keep approved business information together for your team.',
    ],
    Products: ['Your collection, all together.', 'A little organisation for everything you sell.'],
    Campaigns: [
      'Something worth sharing.',
      'Prepare thoughtful messages for customers who opted in.',
    ],
    Settings: ['Make yourself at home.', 'Manage your business profile and connection status.'],
    'Usage & plan': [
      'Room for your next chapter.',
      'Keep track of your local workspace and its limits.',
    ],
  };
  const createMap: Partial<Record<Page, [Modal, string]>> = {
    Customers: ['customers', 'Add customer'],
    Products: ['products', 'Add product'],
    Automations: ['automations', 'Create automation'],
    'Knowledge base': ['knowledge', 'Add knowledge'],
    Campaigns: ['campaigns', 'Create campaign'],
  };
  async function openCustomerConversation(customerId: number) {
    const conversation = await api<{ id: number }>(`customers/${customerId}/conversation`);
    const next = await api<Workspace>(`workspace?conversation_id=${conversation.id}`);
    selectedConversation.current = conversation.id;
    setWorkspace(next);
    setSelected(conversation.id);
    navigate('Inbox');
  }
  return (
    <div className="app-shell">
      {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
      <aside
        id="workspace-navigation"
        ref={sidebarRef}
        aria-label="Workspace navigation"
        className={`sidebar ${mobile ? 'show' : ''}`}
      >
        <button
          className="icon-button sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X size={19} />
        </button>
        <div className="sidebar-scroll">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate('Overviews');
            }}
          >
            <div className="brand-icon">
              <MessageCircle size={23} />
              <span />
            </div>
            wa<span>flow</span>
            <span className="brand-dot">.</span>
          </a>
          <button className="workspace-picker" onClick={() => navigate('Settings')}>
            <span className="store-avatar">
              L<span>✦</span>
            </span>
            <span>
              <strong>{w.business.name}</strong>
              <small>Business workspace</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <span className="nav-caption">WORKSPACE</span>
          <nav>
            {navigation.map(([name, Icon]) => (
              <Link
                key={name}
                className={page === name ? 'nav-item active' : 'nav-item'}
                href={`/app/${paths[name]}`}
                aria-current={page === name ? 'page' : undefined}
                onClick={() => {
                  setQuery('');
                  setMobile(false);
                  setError('');
                }}
              >
                <Icon size={19} />
                <span>{name}</span>
                {name === 'Inbox' && w.metrics.open > 0 && <b>{w.metrics.open}</b>}
                {name === 'Automations' && <span className="tiny-spark">✧</span>}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="plan-card">
              <div>
                <Sparkles size={17} />
                <strong>A little more possibility</strong>
              </div>
              <p>
                Your next customer connection
                <br />
                starts with a conversation.
              </p>
              <button onClick={() => navigate('Usage & plan')}>
                Explore your workspace <ArrowUpRight size={14} />
              </button>
            </div>
            <button
              className={`nav-item ${page === 'Settings' ? 'active' : ''}`}
              onClick={() => navigate('Settings')}
            >
              <Settings size={19} />
              Settings
            </button>
            <button
              className={`nav-item ${page === 'Usage & plan' ? 'active' : ''}`}
              onClick={() => navigate('Usage & plan')}
            >
              <CreditCard size={19} />
              Billing & usage
            </button>
            <button className="nav-item" onClick={() => setModal('help')}>
              <CircleHelp size={19} />
              Help & getting started
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        <div className="sidebar-user">
          <span className="avatar peach">{initials(user.name)}</span>
          <span>
            <strong>{user.name}</strong>
            <small>Workspace owner</small>
          </span>
          <button className="icon-button" aria-label="Sign out" onClick={logout} disabled={busy}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              ref={menuButton}
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button theme-toggle"
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <span className="connection-dot" />
            {w.business.demo
              ? 'Demo workspace'
              : w.integrations.whatsapp
                ? 'WhatsApp connected'
                : 'WhatsApp not connected'}
            <span className="top-divider" />
            <button className="icon-button" aria-label="Help" onClick={() => setModal('help')}>
              <CircleHelp size={19} />
            </button>
            <span className="avatar small peach">{initials(user.name)}</span>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'Overviews'
                  ? `YOUR BUSINESS AT A GLANCE`
                  : `YOUR WORKSPACE / ${page.toUpperCase()}`}
              </div>
              <h1>{pageInfo[page][0]}</h1>
              <p>{pageInfo[page][1]}</p>
            </div>
            <div className="heading-actions">
              {page === 'Overviews' ? (
                <>
                  <select
                    aria-label="Activity range"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value="14">Last 14 days</option>
                    <option value="7">Last 7 days</option>
                  </select>
                  <button
                    className="primary"
                    onClick={() => {
                      setError('');
                      setModal('campaigns');
                    }}
                  >
                    <Plus size={17} />
                    Create campaign
                  </button>
                </>
              ) : createMap[page] ? (
                <>
                  <button
                    className="primary"
                    onClick={() => {
                      setError('');
                      setModal(createMap[page]![0]);
                    }}
                  >
                    <Plus size={17} />
                    {createMap[page]![1]}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {page === 'Overviews' && (
            <>
              <section
                className="card"
                style={{ padding: 24, marginBottom: 24 }}
                aria-label="Get started"
              >
                <h2>Your first WhatsApp campaign</h2>
                <p className="muted">
                  Follow these three steps to reach customers who want to hear from you.
                </p>
                <div className="tile-grid" style={{ marginTop: 16 }}>
                  <button onClick={() => navigate('Settings')}>
                    <span>{w.integrations.whatsapp ? '✓' : '1.'}</span> Connect WhatsApp{' '}
                    <ArrowRight size={16} />
                  </button>
                  <button onClick={() => navigate('Customers')}>
                    <span>{w.customers.some((c) => c.opted_in) ? '✓' : '2.'}</span> Import customers
                    & record consent <ArrowRight size={16} />
                  </button>
                  <button onClick={() => navigate('Campaigns')}>
                    <span>3.</span> Review & send a campaign <ArrowRight size={16} />
                  </button>
                </div>
              </section>
              <div className="welcome-banner">
                <div className="welcome-art">
                  <MessageCircle size={31} />
                  <span>✦</span>
                </div>
                <div>
                  <strong>More connection. Less busywork.</strong>
                  <p>Your conversations, customers, and automations. Happily in one place.</p>
                </div>
                <button onClick={() => navigate('Automations')}>
                  Meet your automations <ArrowRight size={16} />
                </button>
              </div>
              <div className="stats-grid">
                {[
                  [
                    MessageCircle,
                    'Total messages',
                    w.metrics.messages,
                    'All-time conversation activity',
                    'sage',
                  ],
                  [
                    Users,
                    'Your customers',
                    w.metrics.customers,
                    'People in your community',
                    'peach',
                  ],
                  [
                    CheckCheck,
                    'Resolved conversations',
                    w.metrics.resolved,
                    'Customers taken care of',
                    'lavender',
                  ],
                  [
                    Zap,
                    'Active automations',
                    w.metrics.automations,
                    'Ready to lend a helping hand',
                    'yellow',
                  ],
                ].map(([Icon, label, value, caption, color]) => {
                  const I = Icon as typeof MessageCircle;
                  return (
                    <div className="stat-card" key={String(label)}>
                      <div className="stat-top">
                        <span>{String(label)}</span>
                        <span className={`stat-icon ${color}`}>
                          <I size={18} />
                        </span>
                      </div>
                      <strong>{String(value)}</strong>
                      <small>{String(caption)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="overview-middle">
                <section className="card activity-card">
                  <div className="card-heading">
                    <div>
                      <h2>Every conversation counts</h2>
                      <p>A little look at your message activity.</p>
                    </div>
                    <span className="chart-legend">
                      <i />
                      Messages
                    </span>
                  </div>
                  <ActivityChart activity={w.activity} days={days} />
                </section>
                <section className="assistant-card">
                  <div className="assistant-top">
                    <span className="bot-icon">
                      <Bot size={25} />
                    </span>
                    <Badge tone="white">
                      {w.business.demo ? '✧ Rule-based demo' : '✧ AI & automation'}
                    </Badge>
                  </div>
                  <h2>
                    A little help.
                    <br />A big difference.
                  </h2>
                  <p>
                    Let approved replies handle the familiar questions, so you can focus on the
                    human ones.
                  </p>
                  <div className="assistant-metric">
                    <span>
                      <b>{w.automations.reduce((sum, a) => sum + a.runs, 0)}</b>
                      <small>Replies automated</small>
                    </span>
                    <span>
                      <b>{w.metrics.automations}</b>
                      <small>Active workflows</small>
                    </span>
                  </div>
                  <button onClick={() => navigate('Automations')}>
                    Manage automations <ArrowUpRight size={17} />
                  </button>
                </section>
              </div>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>
                      Your latest conversations{' '}
                      <span className="count-pill">{w.conversations.length}</span>
                    </h2>
                    <p>A few people who would love to hear from you.</p>
                  </div>
                  <button className="text-button" onClick={() => navigate('Inbox')}>
                    Go to inbox <ArrowRight size={15} />
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>CUSTOMER</th>
                        <th>LATEST MESSAGE</th>
                        <th>HANDLED BY</th>
                        <th>STATUS</th>
                        <th>LAST ACTIVE</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {w.conversations.slice(0, 4).map((c, i) => (
                        <tr key={c.id} onClick={() => openConversation(c)}>
                          <td>
                            <div className="person">
                              <span
                                className={`avatar ${['peach', 'lavender', 'sage', 'yellow'][i % 4]}`}
                              >
                                {initials(c.name)}
                              </span>
                              <span>
                                <strong>{c.name}</strong>
                                <small>{c.phone}</small>
                              </span>
                            </div>
                          </td>
                          <td className="message-preview">
                            {w.messages
                              .filter((m) => m.conversation_id === c.id && m.direction !== 'note')
                              .at(-1)?.body || 'No messages yet'}
                          </td>
                          <td>
                            <span className="handler">
                              {c.mode === 'ai' ? <Bot size={15} /> : <Users size={15} />}{' '}
                              {c.mode === 'ai' ? 'Automation' : c.assignee || 'Unassigned'}
                            </span>
                          </td>
                          <td>
                            <Badge tone={c.status === 'resolved' ? 'gray' : 'green'}>
                              {c.status === 'resolved' ? 'Resolved' : 'Open'}
                            </Badge>
                          </td>
                          <td className="muted">{time(c.updated_at)}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Open conversation with ${c.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openConversation(c);
                              }}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!w.conversations.length && (
                  <Empty
                    title="Your first conversation is waiting"
                    body="Add a customer to start organising conversations."
                  />
                )}
              </section>
              <div className="footer-note">
                <ShieldCheck size={14} />
                Built for thoughtful businesses. Made for meaningful connections.
                <span>
                  {w.business.demo
                    ? 'Sample data · No live messages are sent'
                    : w.integrations.whatsapp
                      ? 'WhatsApp Cloud API connected'
                      : 'Connect WhatsApp in Settings'}
                </span>
              </div>
            </>
          )}
          {page === 'Inbox' && (
            <div className="inbox card">
              <aside className="conversation-list">
                <div className="list-head">
                  <h2>
                    Conversations <span className="count-pill">{w.metrics.open}</span>
                  </h2>
                  <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder="Search conversations…"
                  />
                </div>
                {w.conversations
                  .filter((c) => filtered(c.name + c.phone))
                  .map((c, i) => (
                    <button
                      key={c.id}
                      className={`conversation-item ${current?.id === c.id ? 'selected' : ''}`}
                      onClick={() => openConversation(c)}
                    >
                      <span className={`avatar ${i % 2 ? 'lavender' : 'peach'}`}>
                        {initials(c.name)}
                      </span>
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {w.messages.filter((m) => m.conversation_id === c.id).at(-1)?.body ||
                            'Start a conversation'}
                        </small>
                        <Badge tone={c.status === 'resolved' ? 'gray' : 'green'}>{c.status}</Badge>
                      </span>
                      {c.unread > 0 && <i className="unread-dot" />}
                    </button>
                  ))}
                {!w.conversations.length && (
                  <Empty title="No conversations yet" body="Add a customer to get started." />
                )}
              </aside>
              {current ? (
                <Chat
                  key={current.id}
                  c={current}
                  w={w}
                  user={user}
                  busy={busy}
                  mutate={mutate}
                  onSimulate={() => setModal('simulate')}
                />
              ) : (
                <Empty
                  title="A home for your conversations"
                  body="Your customer conversations will appear here."
                />
              )}
            </div>
          )}
          {page === 'Customers' && (
            <Customers
              version={w.metrics.customers}
              refresh={refresh}
              openConversation={openCustomerConversation}
            />
          )}
          {page === 'Automations' && (
            <>
              <div className="info-strip">
                <Sparkles size={18} />
                <span>
                  Test your replies in the demo inbox. A matching keyword sends your approved reply;
                  unmatched questions are handed to a human.
                </span>
              </div>
              <div className="tile-grid">
                {w.automations.map((a, i) => (
                  <section className="card workflow-card" key={a.id}>
                    <div className="tile-top">
                      <span className={`tile-icon ${i % 2 ? 'peach' : 'sage'}`}>
                        <Workflow size={23} />
                      </span>
                      <button
                        role="switch"
                        aria-checked={!!a.active}
                        aria-label={`Activate ${a.name}`}
                        disabled={busy}
                        className={`switch ${a.active ? 'on' : ''}`}
                        onClick={() =>
                          mutate(`automations/${a.id}`, 'PATCH', {
                            active: !a.active,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <h2>{a.name}</h2>
                    <p>{a.response}</p>
                    <div className="rule-flow">
                      <MessageCircle size={15} />
                      <span>Contains “{a.keyword}”</span>
                      <ArrowRight size={14} />
                      <Send size={15} />
                    </div>
                    <div className="tile-footer">
                      <Badge tone={a.active ? 'green' : 'gray'}>
                        {a.active ? 'Active' : 'Paused'}
                      </Badge>
                      <span>{a.runs} runs</span>
                    </div>
                  </section>
                ))}
              </div>
              {!w.automations.length && (
                <Empty
                  title="Give your team a helping hand"
                  body="Create a keyword automation to get started."
                />
              )}
            </>
          )}
          {page === 'Products' && (
            <>
              <div className="section-toolbar">
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="Search your collection…"
                />
                <span>{w.products.length} products in your catalogue</span>
              </div>
              <div className="product-grid">
                {w.products
                  .filter((p) => filtered(p.name + p.sku + p.category))
                  .map((p, i) => (
                    <section className="card product-card" key={p.id}>
                      <div className={`product-art product-${i % 4}`}>
                        <Garment index={i} />
                        <span>{p.category}</span>
                      </div>
                      <div className="product-details">
                        <small>{p.sku}</small>
                        <h2>{p.name}</h2>
                        <div>
                          <strong>{money(p.price_paise)}</strong>
                          <Badge tone={p.stock < 10 ? 'amber' : 'green'}>{p.stock} in stock</Badge>
                        </div>
                      </div>
                    </section>
                  ))}
              </div>
              {!w.products.filter((p) => filtered(p.name + p.sku + p.category)).length && (
                <Empty
                  title="Your collection starts here"
                  body="Add a product or try a different search."
                />
              )}
            </>
          )}
          {page === 'Knowledge base' && (
            <>
              <div className="info-strip">
                <BookOpen size={18} />
                <span>
                  Approved reference material for your team and AI assistant. Enable live AI in
                  Settings to use this knowledge.
                </span>
              </div>
              <div className="tile-grid">
                {w.knowledge.map((k) => (
                  <section className="card knowledge-card" key={k.id}>
                    <span className="tile-icon sage">
                      <BookOpen size={23} />
                    </span>
                    <h2>{k.title}</h2>
                    <p>{k.content}</p>
                    <Badge>Saved reference</Badge>
                  </section>
                ))}
              </div>
              {!w.knowledge.length && (
                <Empty
                  title="A little knowledge goes a long way"
                  body="Add your policies, product information, or frequently asked questions."
                />
              )}
            </>
          )}
          {page === 'Campaigns' && <Campaigns w={w} refresh={refresh} />}
          {page === 'Settings' && (
            <>
              <section className="card settings-card business-profile">
                <h2>Business profile</h2>
                <form
                  key={w.business.name}
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate(
                      `businesses/${w.business.id}`,
                      'PATCH',
                      Object.fromEntries(new FormData(e.currentTarget)),
                    );
                  }}
                >
                  <div className="form-row">
                    <label>
                      Business name
                      <input name="name" defaultValue={w.business.name} required maxLength={100} />
                    </label>
                    <label>
                      Industry
                      <input
                        name="industry"
                        defaultValue={w.business.industry}
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      Business email
                      <input name="email" defaultValue={w.business.email || ''} type="email" />
                    </label>
                  </div>
                  <button className="primary" disabled={busy}>
                    Save changes
                  </button>
                </form>
              </section>
              <IntegrationSettings w={w} busy={busy} mutate={mutate} refresh={refresh} />
            </>
          )}
          {page === 'Usage & plan' && (
            <BillingPanel w={w} busy={busy} mutate={mutate} refresh={refresh} />
          )}
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <ModalView
          modal={modal}
          busy={busy}
          error={error}
          onClose={() => {
            setModal(null);
            setError('');
          }}
          onSubmit={async (data) => {
            if (modal === 'help') return;
            if (modal === 'products') {
              data.price_paise = Math.round(Number(data.price) * 100);
              delete data.price;
              data.stock = Number(data.stock);
            }
            if (modal === 'customers') data.opted_in = data.opted_in === 'on';
            const path = modal === 'simulate' ? `conversations/${current?.id}/simulate` : modal;
            if (
              await mutate(
                path,
                'POST',
                data,
                modal === 'simulate' ? 'Demo message received' : 'Saved to your workspace',
              )
            )
              setModal(null);
          }}
        />
      )}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}

function ActivityChart({ activity, days }: { activity: Workspace['activity']; days: number }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(700);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(Math.max(200, entry.contentRect.width)),
    );
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);
  const plotWidth = chartWidth - 70;
  const plotEnd = chartWidth - 25;
  const entries = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days + i + 1);
    const key = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      count: Number(activity.find((a) => a.day === key)?.count || 0),
    };
  });
  const max = Math.max(4, ...entries.map((e) => e.count));
  const points = entries
    .map((e, i) => `${45 + (i * plotWidth) / (days - 1)},${185 - (e.count / max) * 150}`)
    .join(' ');
  return (
    <div className="chart" ref={chartRef}>
      <svg
        viewBox={`0 0 ${chartWidth} 228`}
        role="img"
        aria-label={`Message activity over the last ${days} days`}
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7aaf91" stopOpacity=".26" />
            <stop offset="100%" stopColor="#7aaf91" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="45"
              y1={35 + i * 50}
              x2={plotEnd}
              y2={35 + i * 50}
              stroke="#e9ece7"
              strokeDasharray="4 5"
            />
            <text x="26" y={39 + i * 50} textAnchor="end">
              {Math.round(max * (1 - i / 3))}
            </text>
          </g>
        ))}
        <polygon points={`45,185 ${points} ${plotEnd},185`} fill="url(#area)" />
        <polyline
          points={points}
          fill="none"
          stroke="#438b64"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {entries.map((e, i) => (
          <g key={i}>
            <circle
              cx={45 + (i * plotWidth) / (days - 1)}
              cy={185 - (e.count / max) * 150}
              r="4"
              fill="#438b64"
              stroke="white"
              strokeWidth="2"
            >
              <title>
                {e.label}: {e.count} messages
              </title>
            </circle>
            {(i % (chartWidth < 480 ? (days === 14 ? 5 : 3) : days === 14 ? 3 : 2) === 0 ||
              i === days - 1) && (
              <text x={45 + (i * plotWidth) / (days - 1)} y="216" textAnchor="middle">
                {e.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Chat({
  c,
  w,
  user,
  busy,
  mutate,
  onSimulate,
}: {
  c: Conversation;
  w: Workspace;
  user: User;
  busy: boolean;
  mutate: (path: string, method: string, body: unknown, message?: string) => Promise<boolean>;
  onSimulate: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const requestKey = useRef(crypto.randomUUID());
  const messages = w.messages.filter((m) => m.conversation_id === c.id);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  return (
    <div className="chat">
      <div className="chat-header">
        <div className="person">
          <span className="avatar peach">{initials(c.name)}</span>
          <span>
            <strong>{c.name}</strong>
            <small>{c.phone}</small>
          </span>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            mutate(`conversations/${c.id}`, 'PATCH', {
              status: c.status === 'open' ? 'resolved' : 'open',
            })
          }
        >
          <CheckCheck size={16} />
          {c.status === 'open' ? 'Resolve' : 'Reopen'}
        </button>
      </div>
      <div className="chat-controls">
        <select
          aria-label="Conversation handler"
          value={c.mode}
          disabled={busy}
          onChange={(e) => mutate(`conversations/${c.id}`, 'PATCH', { mode: e.target.value })}
        >
          <option value="human">Human handling</option>
          <option value="ai">{w.business.demo ? 'Automation demo' : 'AI & automation'}</option>
        </select>
        <select
          aria-label="Assign conversation"
          value={c.assignee || ''}
          disabled={busy}
          onChange={(e) =>
            mutate(`conversations/${c.id}`, 'PATCH', {
              assignee: e.target.value || null,
            })
          }
        >
          <option value="">Unassigned</option>
          <option value={user.name}>{user.name}</option>
        </select>
        {!!w.business.demo && (
          <button className="text-button" onClick={onSimulate}>
            Simulate incoming <Plus size={14} />
          </button>
        )}
      </div>
      <div className="messages">
        <div className="chat-date">
          {w.business.demo
            ? 'Demo conversation · messages stay in this workspace'
            : w.integrations.whatsapp
              ? 'Live WhatsApp conversation'
              : 'Customer conversation · WhatsApp not connected'}
        </div>
        {messages.map((m) => (
          <div className={`message ${m.direction}`} key={m.id}>
            <p>{m.body}</p>
            <small>
              {m.direction === 'note' ? 'Internal note · ' : ''}
              {time(m.created_at)}
              {m.direction === 'outbound' && ` · ${m.status}`}{' '}
              {m.error_code && ` · ${m.error_code}`}
            </small>
          </div>
        ))}
        {!messages.length && (
          <Empty title="Start the conversation" body="Save a note to keep your team in the loop." />
        )}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            draft.trim() &&
            (await mutate(
              `conversations/${c.id}/messages`,
              'POST',
              {
                body: draft.trim(),
                direction: note ? 'note' : 'outbound',
                client_key: requestKey.current,
              },
              note
                ? 'Internal note saved'
                : w.business.demo
                  ? 'Demo reply saved'
                  : 'Reply queued for WhatsApp',
            ))
          )
            setDraft('');
        }}
      >
        <div className="composer-tabs">
          <button type="button" className={!note ? 'chosen' : ''} onClick={() => setNote(false)}>
            Reply
          </button>
          <button type="button" className={note ? 'chosen' : ''} onClick={() => setNote(true)}>
            Internal note
          </button>
        </div>
        <textarea
          aria-label={note ? 'Internal note' : 'Message'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            requestKey.current = crypto.randomUUID();
          }}
          placeholder={note ? 'Leave a note for your team…' : 'Write a thoughtful reply…'}
          required
          maxLength={4000}
        />
        <div className="composer-bottom">
          <span>
            {note
              ? 'Only visible to your team'
              : w.business.demo
                ? 'Demo replies are not sent to WhatsApp'
                : 'Live replies require a customer message within 24 hours'}
          </span>
          <button className="primary" disabled={busy || !draft.trim()}>
            <Send size={15} />
            {note ? 'Save note' : w.business.demo ? 'Send demo reply' : 'Send WhatsApp reply'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalView({
  modal,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  modal: Exclude<Modal, null>;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const titles = {
    customers: 'Meet your next customer.',
    products: 'Add to your collection.',
    automations: 'A little less busywork.',
    knowledge: 'Share what you know.',
    campaigns: 'Create something worth sharing.',
    simulate: 'Try a customer message.',
    help: 'A good place to start.',
  };
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onClose();
      }}
    >
      <div className="modal-head">
        <span className="tile-icon sage">
          <Sparkles size={21} />
        </span>
        <button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <h2>{titles[modal]}</h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {modal === 'help' ? (
        <div className="help-content">
          <p>Welcome to WaFlow, your local business workspace.</p>
          <ol>
            <li>
              <strong>Add your customers.</strong> Create a contact with an international phone
              number.
            </li>
            <li>
              <strong>Try the inbox.</strong> Send demo replies, add notes, assign conversations,
              and mark them resolved.
            </li>
            <li>
              <strong>Test an automation.</strong> Enable a keyword reply, choose “Automation demo”
              in the inbox, then simulate an incoming message containing its keyword.
            </li>
            <li>
              <strong>Build your collection.</strong> Add products, business knowledge, and campaign
              drafts.
            </li>
          </ol>
          <p>
            Configure live WhatsApp, OpenAI, and Razorpay in Settings and Billing. A permanent
            account, provider credentials, public HTTPS webhooks, and a running queue worker are
            required. Campaigns use approved text templates and opted-in customers. Media campaigns
            are not supported.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          {modal === 'customers' && (
            <>
              <label>
                Full name
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="e.g. Priya Sharma"
                  autoFocus
                />
              </label>
              <label>
                Phone number
                <input
                  name="phone"
                  required
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+919876543210"
                />
                <small>Include the country code, with no spaces.</small>
              </label>
              <label>
                Email (optional)
                <input name="email" type="email" />
              </label>
              <label>
                Tag
                <select name="tag">
                  <option>New</option>
                  <option>VIP</option>
                  <option>Returning</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input name="opted_in" type="checkbox" />
                Customer has agreed to receive marketing messages
              </label>
              <label>
                Consent source (required when opted in)
                <input
                  name="consent_source"
                  maxLength={255}
                  placeholder="e.g. In-store signup form, date"
                />
              </label>
            </>
          )}
          {modal === 'products' && (
            <>
              <label>
                Product name
                <input name="name" required maxLength={120} autoFocus />
              </label>
              <div className="form-row">
                <label>
                  SKU
                  <input name="sku" required maxLength={60} />
                </label>
                <label>
                  Category
                  <input name="category" required maxLength={60} />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Price (₹)
                  <input name="price" type="number" min="0" max="1000000" step="0.01" required />
                </label>
                <label>
                  Stock quantity
                  <input name="stock" type="number" min="0" max="1000000" step="1" required />
                </label>
              </div>
            </>
          )}
          {modal === 'automations' && (
            <>
              <p>Create an approved reply for a familiar question. New automations start paused.</p>
              <label>
                Automation name
                <input name="name" required maxLength={100} autoFocus />
              </label>
              <label>
                When a message contains
                <input name="keyword" placeholder="e.g. delivery" required maxLength={60} />
              </label>
              <label>
                Reply with
                <textarea name="response" required maxLength={4000} rows={4} />
              </label>
            </>
          )}
          {modal === 'knowledge' && (
            <>
              <label>
                Title
                <input
                  name="title"
                  required
                  maxLength={150}
                  autoFocus
                  placeholder="e.g. Shipping & delivery"
                />
              </label>
              <label>
                Approved information
                <textarea name="content" required maxLength={10000} rows={7} />
              </label>
            </>
          )}
          {modal === 'campaigns' && (
            <>
              <label>
                Campaign name
                <input
                  name="name"
                  required
                  maxLength={100}
                  autoFocus
                  placeholder="e.g. Meet our new collection"
                />
              </label>
              <label>
                Audience
                <select name="audience">
                  <option>All opted-in customers</option>
                  <option>VIP</option>
                  <option>New</option>
                </select>
              </label>
              <label>
                Message draft
                <textarea name="body" required maxLength={4000} rows={5} />
              </label>
              <p className="muted">Saved as a draft. No messages will be sent.</p>
            </>
          )}
          {modal === 'simulate' && (
            <>
              <p>
                Try “Do you deliver to Mumbai?” with Automation demo enabled to test the shipping
                rule.
              </p>
              <label>
                Customer message
                <textarea name="body" required maxLength={4000} rows={4} autoFocus />
              </label>
            </>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : modal === 'simulate' ? 'Simulate message' : 'Save to workspace'}
              <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function Garment({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 200 180" aria-hidden="true">
      <ellipse cx="100" cy="155" rx="49" ry="7" fill="#000" opacity=".05" />
      <path
        d={
          index % 2
            ? 'M73 32 L50 42 27 77 50 91 65 71 60 143 140 143 135 71 150 91 173 77 150 42 127 32 Q100 56 73 32Z'
            : 'M74 30 L54 43 38 74 59 86 67 70 65 119 78 148 98 137 100 121 102 137 122 148 135 119 133 70 141 86 162 74 146 43 126 30 Q100 53 74 30Z'
        }
        fill={['#a7b29a', '#d8b7a3', '#b1a597', '#cbbf99'][index % 4]}
        stroke="#fff"
        strokeOpacity=".5"
        strokeWidth="2"
      />
      <path
        d="M78 33 Q100 59 122 33 M100 49 L100 119"
        fill="none"
        stroke="#fff"
        strokeOpacity=".45"
        strokeWidth="2"
      />
      <circle cx="104" cy="66" r="2" fill="#fff9" />
      <circle cx="104" cy="84" r="2" fill="#fff9" />
      <circle cx="104" cy="102" r="2" fill="#fff9" />
    </svg>
  );
}
