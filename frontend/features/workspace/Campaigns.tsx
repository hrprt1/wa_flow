"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Megaphone, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { api } from "./api";
import type { Workspace } from "./types";

type Campaign = Workspace["campaigns"][number];
type Preview = {
  eligible: number;
  excluded: number;
  templates: { name: string; language: string; body: string }[];
};
type CampaignStatus = {
  run: null | {
    id: number;
    status: string;
    scheduled_at: string;
    template_name: string;
    language: string;
  };
  counts: Record<string, number>;
};

function dateLabel(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function Campaigns({ w, refresh }: { w: Workspace; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const campaign = w.campaigns.find((item) => item.id === selected);
  const connected = !!w.integrations.whatsapp && !w.business.demo;

  return <>
    <div className="info-strip">
      <ShieldCheck size={20} />
      <span>Send approved WhatsApp templates to customers who agreed to receive your marketing. Review the audience and exact message before sending.</span>
    </div>
    {!connected && <div className="info-strip">
      <Megaphone size={19} />
      <span>{w.business.demo
        ? "You can prepare campaign drafts here. Create a permanent account and connect WhatsApp in Settings to send."
        : "Connect your WhatsApp Business account in Settings, then return here to send your first campaign."}</span>
    </div>}
    <div className="tile-grid">
      {w.campaigns.map((item) => <section className="card campaign-card" key={item.id}>
        <div className="tile-top"><span className="tile-icon peach"><Megaphone size={23} /></span><span className="badge amber">Message draft</span></div>
        <h2>{item.name}</h2>
        <p>{item.body}</p>
        <div className="tile-footer"><span><Users size={15} />{item.audience}</span><span>{w.customers.filter((customer) => !!customer.opted_in && (item.audience === "All opted-in customers" || customer.tag === item.audience)).length} opted in</span></div>
        <button className="campaign-review-button" aria-expanded={selected === item.id} aria-controls={`campaign-details-${item.id}`} onClick={() => setSelected(item.id)}>
          {item.status === "draft" ? "Review campaign" : "View campaign & delivery"}
        </button>
      </section>)}
    </div>
    {!w.campaigns.length && <div className="empty"><Megaphone size={30} /><h3>Your first campaign starts here</h3><p>Choose “Create campaign” to save a message idea and audience. You can review an approved template before sending.</p></div>}
    {campaign && <CampaignDetails key={campaign.id} campaign={campaign} connected={connected} refresh={refresh} />}
  </>;
}

function CampaignDetails({ campaign, connected, refresh }: { campaign: Campaign; connected: boolean; refresh: () => Promise<void> }) {
  const panel = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [timing, setTiming] = useState("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected = preview?.templates.find((template) => `${template.name}:${template.language}` === templateKey);
  const active = !!status?.run && ["scheduled", "running", "processing"].includes(status.run.status);
  // Dispatch can finish before delivery/read webhooks arrive. Keep their counts live.
  const shouldPoll = active || Object.entries(status?.counts || {}).some(([name, count]) => count > 0 && ["queued", "sending", "sent", "delivered", "uncertain"].includes(name));

  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    panel.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const result = await api<CampaignStatus>(`campaigns/${campaign.id}/status`);
        if (disposed) return;
        setStatus(result);
        if (!result.run && connected) {
          const audience = await api<Preview>(`campaigns/${campaign.id}/preview`, "POST", {});
          if (!disposed) setPreview(audience);
        }
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => { disposed = true; };
  }, [campaign.id, connected, retry]);

  useEffect(() => {
    if (!shouldPoll) return;
    let disposed = false;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<CampaignStatus>(`campaigns/${campaign.id}/status`);
        if (!disposed) { setStatus(result); setError(""); }
      } catch (cause) {
        if (!disposed) setError(`Delivery status could not refresh: ${(cause as Error).message}`);
      } finally { pending = false; }
    }, 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, [campaign.id, shouldPoll]);

  async function schedule() {
    if (!selected || !confirmed || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      let timestamp: string | undefined;
      if (timing === "later") {
        const date = new Date(scheduledAt);
        if (!scheduledAt || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Choose a future date and time.");
        timestamp = date.toISOString();
      }
      const result = await api<{ id: number; status: string; recipients: number }>(`campaigns/${campaign.id}/schedule`, "POST", {
        template_name: selected.name,
        language: selected.language,
        scheduled_at: timestamp,
        consent_confirmed: true,
      });
      // A run is single-use. Lock the form immediately even if a subsequent refresh fails.
      setStatus({ run: { id: result.id, status: result.status, scheduled_at: timestamp || new Date().toISOString(), template_name: selected.name, language: selected.language }, counts: { pending: result.recipients } });
      setNotice(timestamp ? `Scheduled for ${dateLabel(timestamp)}. ${result.recipients} recipients selected.` : `Campaign queued for ${result.recipients} recipients. Delivery updates will appear below.`);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
      // Reconcile a request whose response was lost before allowing another attempt.
      try { setStatus(await api<CampaignStatus>(`campaigns/${campaign.id}/status`)); } catch { /* Keep the error visible; the server also prevents duplicate runs. */ }
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`campaigns/${campaign.id}/cancel`, "POST", {});
      setCancelConfirm(false);
      setNotice("Campaign cancelled. Messages already being sent may still arrive.");
      setStatus(await api<CampaignStatus>(`campaigns/${campaign.id}/status`));
      await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section ref={panel} tabIndex={-1} className="card settings-card campaign-details" id={`campaign-details-${campaign.id}`} aria-label={`Campaign details for ${campaign.name}`} aria-busy={loading || busy}>
    <div className="campaign-detail-heading"><div><span className="muted">CAMPAIGN REVIEW</span><h2>{campaign.name}</h2></div><button disabled={busy || loading} onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />Refresh</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="info-strip" role="status">{notice}</div>}
    {loading ? <p role="status">Checking campaign and audience…</p> : status?.run ? <>
      <span className="badge">{status.run.status}</span>
      <p><CalendarClock size={15} /> {dateLabel(status.run.scheduled_at)} · {status.run.template_name} ({status.run.language})</p>
      <dl className="campaign-counts">{Object.entries(status.counts).map(([name, count]) => <div key={name}><dt>{name.replaceAll("_", " ")}</dt><dd>{count}</dd></div>)}</dl>
      {status.counts.uncertain > 0 && <div className="info-strip">Some messages have an unknown delivery outcome. Check Meta before sending another campaign to these customers.</div>}
      <p className="muted">Delivery updates reflect WhatsApp webhooks. Read receipts depend on the customer’s settings. Each draft can be sent once; create a new campaign for another send.</p>
      {active && <>{!cancelConfirm ? <button disabled={busy} onClick={() => setCancelConfirm(true)}>Cancel remaining messages</button> : <div className="campaign-cancel"><p>Cancel messages that have not started sending? Messages already sent cannot be recalled.</p><button disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Confirm cancellation"}</button><button disabled={busy} onClick={() => setCancelConfirm(false)}>Keep campaign</button></div>}</>}
    </> : !connected ? <p>Connect WhatsApp from Settings to review approved templates and schedule this campaign.</p> : preview ? <>
      <div className="info-strip"><Users size={19} /><span><strong>{preview.eligible} eligible recipients</strong> · {preview.excluded} excluded from this audience. Customers who opt out before dispatch will be skipped.</span></div>
      {!preview.templates.length ? <p>No supported approved templates found. Create a text template in Meta and wait for approval, then refresh here. Campaigns currently support templates without variables, buttons or media.</p> : <form onSubmit={(event) => { event.preventDefault(); void schedule(); }}>
        <label>Approved WhatsApp template<select required disabled={busy} value={templateKey} onChange={(event) => { setTemplateKey(event.target.value); setConfirmed(false); }}><option value="">Choose a template</option>{preview.templates.map((template) => <option value={`${template.name}:${template.language}`} key={`${template.name}:${template.language}`}>{template.name} ({template.language})</option>)}</select></label>
        <p className="muted">Your draft is a message idea. WhatsApp will send the approved template shown below.</p>
        {selected && <div className="campaign-message-preview"><strong>Message customers will receive</strong><p>{selected.body}</p></div>}
        <div className="form-row"><label>When to send<select disabled={busy} value={timing} onChange={(event) => setTiming(event.target.value)}><option value="now">Send now</option><option value="later">Schedule for later</option></select></label>{timing === "later" && <label>Date and time<input type="datetime-local" required disabled={busy} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><small>Within the next 90 days, in your device’s local time zone.</small></label>}</div>
        <label className="checkbox-label campaign-attestation"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />I confirm these customers agreed to receive this marketing and this campaign follows WhatsApp policies and applicable laws.</label>
        <button className="primary" disabled={busy || !selected || !confirmed || preview.eligible === 0}>{busy ? "Scheduling…" : timing === "later" ? "Schedule campaign" : `Send to ${preview.eligible} customers`}</button>
        <p className="muted">Your plan’s message allowance applies. Only the selected, opted-in audience is included; newly added customers will not be added to this run.</p>
      </form>}
    </> : <p>Campaign review is unavailable. Use Refresh to try again.</p>}
  </section>;
}
