"use client";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Upload, X } from 'lucide-react';
import { api } from './api';
import type { Customer } from './types';

function ContactDialog({ title, children, close, busy }: { title: string; children: ReactNode; close: () => void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><X size={20}/></button></div>
    {children}
  </dialog>;
}

export function ContactImport({ refresh }: { refresh: () => Promise<void> }) {
  const fileRead = useRef(0);
  const [open, setOpen] = useState(false), [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  return <>
    <button onClick={() => { setError(''); setResult(''); setOpen(true); }}><Upload size={16}/>Import CSV</button>
    {open && <ContactDialog title="Import your customers" close={() => setOpen(false)} busy={busy}>
      <p>Import up to 10,000 contacts per CSV (5 MB). There is no total contact cap. Existing numbers are skipped and their consent stays unchanged.</p>
      <p className="muted">Use these exact column names. Set opted_in to true only for customers who agreed to WhatsApp marketing.</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>name,phone,email,tag,opted_in{'\n'}Priya,+919876543210,priya@example.com,VIP,false</pre>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(''); setResult('');
        const source = String(new FormData(e.currentTarget).get('consent_source') || '');
        try {
          const data = await api<{ imported: number; skipped: number }>('customers/import', 'POST', { csv, consent_source: source });
          setResult(`${data.imported} imported. ${data.skipped} existing contacts skipped.`);
          setCsv(''); await refresh();
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <label>Choose a CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
          const version = ++fileRead.current;
          const file = e.target.files?.[0]; setCsv(''); if (!file) return;
          setError('');
          if (file.size > 5_000_000) { setError('Choose a CSV no larger than 5 MB.'); e.target.value = ''; return; }
          try { const text = await file.text(); if (fileRead.current === version) setCsv(text); } catch { if (fileRead.current === version) setError('Could not read this file.'); }
        }}/></label>
        <label>Or paste CSV<textarea name="csv" value={csv} onChange={e => { fileRead.current++; setCsv(e.target.value); }} maxLength={5_000_000} rows={6} required disabled={busy}/></label>
        <label>Consent source (required for opt-ins)<input name="consent_source" maxLength={255} placeholder="e.g. Store signup form, 4 November 2026" disabled={busy}/></label>
        <small>Keep the original consent evidence. Importing a phone number alone does not grant marketing permission.</small>
        {error && <p className="error-banner" role="alert">{error}</p>}
        {result && <p role="status">{result}</p>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button><button className="primary" disabled={busy || !csv.trim()}>{busy ? 'Importing…' : 'Import contacts'}</button></div>
      </form>
    </ContactDialog>}
  </>;
}

export function ContactConsent({ customer, refresh }: { customer: Customer; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <>
    <span>{customer.opted_in ? 'Opted in' : 'No marketing consent'}</span>{' '}
    <button className="text-button" onClick={() => { setError(''); setOpen(true); }}>Manage</button>
    {open && <ContactDialog title={`Marketing consent: ${customer.name}`} close={() => setOpen(false)} busy={busy}>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        const form = new FormData(e.currentTarget);
        try {
          await api(`customers/${customer.id}`, 'PATCH', { opted_in: form.get('opted_in') === 'on', consent_source: String(form.get('consent_source') || '') });
          await refresh(); setOpen(false);
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <p>Record the customer’s choice. Opting out prevents pending campaign messages from being sent.</p>
        <label className="checkbox-label"><input name="opted_in" type="checkbox" defaultChecked={!!customer.opted_in} disabled={busy}/>Customer agreed to receive WhatsApp marketing</label>
        <label>How and when did they agree?<input name="consent_source" maxLength={255} placeholder="Required when enabling marketing" disabled={busy}/></label>
        <small>Customers can also reply STOP to opt out. Record new permission before opting them back in.</small>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save preference'}</button></div>
      </form>
    </ContactDialog>}
  </>;
}
