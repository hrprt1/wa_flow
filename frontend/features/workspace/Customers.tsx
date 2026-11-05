"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import { api } from './api';
import { ContactConsent, ContactImport } from './Contacts';
import type { Customer } from './types';

type ContactPage = { items: Customer[]; next_cursor: number | null; total: number };

export function Customers({ version, refresh, openConversation }: {
  version: number;
  refresh: () => Promise<void>;
  openConversation: (customerId: number) => Promise<void>;
}) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [page, setPage] = useState<{ cursor: number | null; previous: (number | null)[] }>({ cursor: null, previous: [] });
  const [data, setData] = useState<ContactPage | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage({ cursor: null, previous: [] }); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError('');
    const params = new URLSearchParams({ limit: '50', q: query });
    if (page.cursor !== null) params.set('cursor', String(page.cursor));
    api<ContactPage>(`customers?${params}`).then(result => { if (!disposed) setData(result); })
      .catch(cause => { if (!disposed) setError((cause as Error).message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [page.cursor, query, version, revision]);

  async function saved() { await refresh(); setRevision(v => v + 1); }

  async function exportCsv() {
    if (busy) return;
    setBusy(true); setError('');
    const abort = new AbortController(); exportAbort.current = abort;
    try {
      const escape = (v: string) => '"' + (/^[=+\-@\t\r]/.test(v) ? "'" : '') + v.replaceAll('"', '""') + '"';
      const lines = ['Name,Phone,Status,Tag'];
      let cursor: number | null = null;
      do {
        if (abort.signal.aborted) return;
        const params = new URLSearchParams({ limit: '100', q: query });
        if (cursor !== null) params.set('cursor', String(cursor));
        const result: ContactPage = await api<ContactPage>(`customers?${params}`);
        if (abort.signal.aborted) return;
        lines.push(...result.items.map(c => [c.name, c.phone, c.status, c.tag].map(escape).join(',')));
        if (result.next_cursor !== null && cursor !== null && result.next_cursor >= cursor) throw new Error('Contact export could not advance. Please try again.');
        cursor = result.next_cursor;
      } while (cursor !== null);
      const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'waflow-customers.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { if (!abort.signal.aborted) setError((cause as Error).message); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }

  return <section className="card" aria-label="Customers" aria-busy={loading}>
    <div className="card-heading" style={{ flexWrap: 'wrap' }}>
      <label className="search-box"><Search size={16}/><input aria-label="Search all customers" placeholder="Search names, phones or tags…" value={search} maxLength={100} onChange={e => setSearch(e.target.value)}/></label>
      <button disabled={busy} onClick={exportCsv}><ArrowDownToLine size={16}/>{busy ? 'Exporting…' : 'Export CSV'}</button>
      <ContactImport refresh={saved}/>
      <button aria-label="Refresh customers" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16}/></button>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading && <p role="status" style={{ padding: 24 }}>{data ? 'Updating customers…' : 'Loading customers…'}</p>}
    {data && <>
      <div className="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>PHONE</th><th>RELATIONSHIP</th><th>TAG</th><th>MARKETING CONSENT</th><th/></tr></thead>
        <tbody>{data?.items.map((c, i) => <tr key={c.id}>
          <td><div className="person"><span className={`avatar ${i % 2 ? 'sage' : 'peach'}`}>{c.name.split(' ').slice(0, 2).map(v => v[0]).join('')}</span><strong>{c.name}</strong></div></td>
          <td>{c.phone}</td>
          <td><select aria-label={`Status for ${c.name}`} value={c.status} disabled={busy} onChange={async e => {
            setBusy(true); setError('');
            try { await api(`customers/${c.id}`, 'PATCH', { status: e.target.value }); await saved(); }
            catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
          }}><option>New lead</option><option>Customer</option><option>VIP</option></select></td>
          <td><span className={`badge ${c.tag === 'VIP' ? 'purple' : 'gray'}`}>{c.tag}</span></td>
          <td className="muted"><ContactConsent customer={c} refresh={saved}/></td>
          <td><button className="text-button" disabled={busy} onClick={async () => {
            setBusy(true); setError(''); try { await openConversation(c.id); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
          }}>Message <ArrowUpRight size={15}/></button></td>
        </tr>)}</tbody></table></div>
      {!data?.items.length && <div className="empty"><h3>No matching customers</h3><p>Try another search or add your first customer.</p></div>}
    </>}
    <div className="table-footer" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span>{data?.total ?? 0} {query ? 'matching ' : ''}customers · Page {page.previous.length + 1}</span>
      <button disabled={loading || !page.previous.length} onClick={() => setPage(p => ({ cursor: p.previous[p.previous.length - 1], previous: p.previous.slice(0, -1) }))}>Previous</button>
      <button disabled={loading || !data?.next_cursor} onClick={() => setPage(p => ({ cursor: data!.next_cursor, previous: [...p.previous, p.cursor] }))}>Next</button>
    </div>
  </section>;
}
