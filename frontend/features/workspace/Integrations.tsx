import { useState } from 'react';
import { Bot, Check, CreditCard, MessageCircle, RefreshCw } from 'lucide-react';
import { api } from './api';
import { WhatsAppConnect } from './WhatsAppConnect';
import type { Workspace } from './types';

type Mutation = (path: string, method: string, data: unknown, message?: string) => Promise<boolean>;

export function IntegrationSettings({ w, busy, mutate, refresh }: { w: Workspace; busy: boolean; mutate: Mutation; refresh: () => Promise<void> }) {
  const [answer, setAnswer] = useState('');
  const [testing, setTesting] = useState(false);
  const [templates, setTemplates] = useState<{name: string; language: string; components: {type: string; text?: string}[]}[]>([]);
  const [templateIndex, setTemplateIndex] = useState('');
  const [templateFeedback, setTemplateFeedback] = useState('');
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const selected = templates[Number(templateIndex)];
  const templateBody = selected?.components.find(c => c.type === 'BODY')?.text || '';
  const slots = [...new Set([...templateBody.matchAll(/{{(\d+)}}/g)].map(m => Number(m[1])))].sort((a,b) => a-b);
  return <div className="integration-grid">
    <section className="card settings-card"><span className="tile-icon sage"><MessageCircle/></span><h2>WhatsApp Cloud API</h2><span className={`badge ${w.integrations.whatsapp ? 'green' : 'amber'}`}>{w.integrations.whatsapp ? `Connected · ${w.integrations.whatsapp.display_phone}` : 'Not connected'}</span>
      <p>Connect a registered Meta business phone. Incoming messages appear in your inbox; replies are sent within the 24-hour customer-service window.</p>
      {!!w.business.demo && <div className="info-strip">Create a permanent account to connect a live phone.</div>}
      {!w.integrations.meta_configured && <div className="info-strip">Server setup needed: configure a supported WhatsApp Graph API version.</div>}
      <WhatsAppConnect enabled={w.integrations.embedded_signup.configured} demo={!!w.business.demo} connected={!!w.integrations.whatsapp} refresh={refresh}/>
      {w.integrations.whatsapp?.connection_type === 'embedded' && <p className="info-strip">Connected through Facebook. Incoming messages are delivered through the platform webhook.</p>}
      <details><summary>Advanced: connect with your own Meta app credentials</summary>
      <form onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; if (await mutate('integrations/whatsapp', 'POST', Object.fromEntries(new FormData(form)), 'WhatsApp phone verified and connected')) form.reset(); }}>
        <label>WhatsApp Business Account ID (WABA)<input name="waba_id" required pattern="[0-9]{5,30}" defaultValue={w.integrations.whatsapp?.waba_id || ''}/></label><label>Meta app secret<input name="app_secret" type="password" required minLength={16} maxLength={256} autoComplete="new-password"/><small>Enter the secret from your own Meta app. Stored encrypted.</small></label><label>Phone number ID<input name="phone_number_id" required pattern="[0-9]{5,30}" autoComplete="off" defaultValue={w.integrations.whatsapp?.phone_number_id}/></label>
        <label>System-user access token<input name="access_token" type="password" required minLength={20} maxLength={4096} autoComplete="new-password"/><small>Encrypted on the server. Never returned to your browser.</small></label>
        <button className="primary" disabled={busy || !!w.business.demo || !w.integrations.meta_configured}>Verify & connect phone</button>
      </form>{w.integrations.webhook_url && <div className="info-strip"><strong>Finish Meta setup</strong><p>1. In your Meta app, set this public HTTPS callback URL:</p><code style={{overflowWrap:'anywhere'}}>{w.integrations.webhook_url}</code><p>2. Enter this verification token:</p><code style={{overflowWrap:'anywhere'}}>{w.integrations.webhook_verify_token}</code><p>3. Verify and save in Meta, then subscribe to the messages field.</p><p>{w.integrations.whatsapp?.webhook_verified_at ? 'Callback verified by Meta.' : 'Waiting for Meta callback verification.'}</p><p>4. Subscribe your app to this WhatsApp Business Account:</p><button disabled={busy} onClick={() => mutate('integrations/whatsapp/subscribe', 'POST', {}, 'WhatsApp Business Account subscribed')}>Subscribe account</button><p>5. Send a message from a customer phone, then open Inbox.</p></div>}<p className="muted">Use a permanent account and a phone already registered for Meta Cloud API. Saving keys does not migrate a WhatsApp mobile-app number. Re-enter credentials to replace them.</p></details>
    </section>
    <section className="card settings-card"><span className="tile-icon lavender"><Bot/></span><h2>AI customer assistant</h2><span className={`badge ${w.integrations.ai_configured ? 'green' : 'amber'}`}>{w.integrations.ai_configured ? 'OpenAI configured' : 'OpenAI key needed'}</span>
      <p>The assistant checks approved keyword replies first, then searches your saved knowledge and products. Unsupported answers go to a human. Live AI sends customer questions and relevant business content to OpenAI.</p>
      <label className="integration-toggle"><input type="checkbox" checked={!!w.business.ai_enabled} disabled={busy || !!w.business.demo || !w.integrations.ai_configured} onChange={e => mutate('integrations/ai', 'PATCH', { ai_enabled: e.target.checked })}/>Enable automatic replies for conversations in AI mode</label>
      <form onSubmit={async e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setTesting(true); try { const result = await api<{ reply: string | null; handover: boolean }>('integrations/ai/test', 'POST', data); setAnswer(result.handover ? 'Human handover: no supported answer was available.' : result.reply || ''); await refresh(); } catch (error) { setAnswer((error as Error).message); } finally { setTesting(false); } }}>
        <label>Test a knowledge question<textarea name="question" required maxLength={2000} placeholder="What is your return policy?"/></label><button disabled={testing || !!w.business.demo || !w.integrations.ai_configured}>{testing ? 'Checking knowledge…' : 'Test AI answer'}</button><p className="muted">Uses your AI allowance. Does not send a WhatsApp message.</p>
      </form>{answer && <div className="info-strip" role="status">{answer}</div>}
    </section>
    <section className="card settings-card"><h2>Start a WhatsApp conversation</h2><p>Send an approved text template to a customer who has agreed to receive WhatsApp messages. Replies arrive in Inbox.</p><button disabled={busy || !w.integrations.whatsapp?.waba_id} onClick={async () => { try { const result = await api<typeof templates>('integrations/whatsapp/templates'); setTemplates(result); setTemplateIndex(''); setTemplateFeedback(result.length ? 'Templates loaded. Showing up to 100 templates; text templates with numeric body parameters are supported.' : 'No supported approved text templates found. Create and approve one in Meta first.'); } catch (error) { setTemplateFeedback((error as Error).message); } }}>Load approved templates</button>
      <form onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); if (!selected) return; const ok = await mutate('integrations/whatsapp/templates/send', 'POST', { phone: data.get('phone'), name: selected.name, language: selected.language, parameters: slots.map(n => String(data.get(`parameter_${n}`))), consent: data.get('consent') === 'on', client_key: sendKey }, 'Template queued. Track delivery in Inbox.'); if (ok) { setSendKey(crypto.randomUUID()); form.reset(); } }}>
        <label>Customer WhatsApp number<input name="phone" placeholder="+919876543210" required pattern="\+[1-9][0-9]{7,14}"/></label>
        <label>Approved template<select required value={templateIndex} onChange={e => { setTemplateIndex(e.target.value); setSendKey(crypto.randomUUID()); }}><option value="">Select template</option>{templates.map((t,i) => <option key={`${t.name}:${t.language}`} value={i}>{t.name} ({t.language})</option>)}</select></label>
        {templateIndex !== '' && <p>{templateBody}</p>}{templateIndex !== '' && slots.map(n => <label key={n}>Value for parameter {n}<input name={`parameter_${n}`} required maxLength={1000}/></label>)}
        <label className="checkbox-label"><input type="checkbox" name="consent" required/> I confirm this customer agreed to receive these WhatsApp messages.</label><button className="primary" disabled={busy || templateIndex === ''}>Send template</button>
      </form>{templateFeedback && <p role="status">{templateFeedback}</p>}
    </section>
    <section className="card settings-card"><h2>Recent webhook activity</h2>{w.integrations.events.length ? w.integrations.events.map(event => <div className="integration-event" key={event.id}><strong>{event.provider}</strong><span>{event.status}</span><small>{event.error_code || event.created_at}</small></div>) : <p>No webhook events received yet.</p>}<button onClick={refresh}><RefreshCw size={15}/>Refresh status</button></section>
  </div>;
}

type CheckoutResult = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayConstructor = new (options: { key: string; subscription_id: string; name: string; description: string; handler: (result: CheckoutResult) => void; modal: { ondismiss: () => void } }) => { open: () => void };
declare global { interface Window { Razorpay?: RazorpayConstructor } }
let checkoutLoader: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutLoader) return checkoutLoader;
  checkoutLoader = new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => { script.remove(); checkoutLoader = null; reject(new Error('Could not load Razorpay Checkout.')); }; document.head.appendChild(script); });
  return checkoutLoader;
}

export function BillingPanel({ w, busy, mutate, refresh }: { w: Workspace; busy: boolean; mutate: Mutation; refresh: () => Promise<void> }) {
  const [working, setWorking] = useState(false); const [feedback, setFeedback] = useState(''); const [cancelConfirm, setCancelConfirm] = useState(false);
  const i = w.integrations;
  async function subscribe(plan: string) {
    setWorking(true); setFeedback('');
    try {
      await loadCheckout();
      const checkout = await api<{ key: string; subscription_id: string; plan: string }>('billing/subscribe', 'POST', { plan });
      await refresh();
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable.');
      new window.Razorpay({ ...checkout, name: 'WaFlow', description: 'Monthly subscription · 12 billing cycles', handler: async result => { try { await api('billing/verify', 'POST', result); await refresh(); setFeedback('Payment signature verified. Your subscription status has been refreshed.'); } catch (error) { setFeedback((error as Error).message); } finally { setWorking(false); } }, modal: { ondismiss: () => { setWorking(false); setFeedback('Checkout closed. You can resume the pending subscription.'); } } }).open();
    } catch (error) { setFeedback((error as Error).message); setWorking(false); }
  }
  return <><section className="card settings-card"><span className="tile-icon sage"><CreditCard/></span><h2>Subscription & usage</h2><span className="badge">{w.business.demo ? 'Demo workspace' : `${i.limits.plan} access`}</span><p>{i.billing_test_mode ? 'Razorpay test mode — no real charges.' : 'Monthly billing through Razorpay.'} Message and AI allowances reset each calendar month (UTC). Provider charges are separate.</p>
    {!i.billing_configured && <div className="info-strip">Configure Razorpay keys, webhook secret, and monthly plan IDs on the server to enable checkout.</div>}
    {!!w.business.demo && <div className="info-strip">Create a permanent account to subscribe and use live integrations.</div>}
    {i.subscription && <div className="subscription-summary"><strong>{i.subscription.plan} · {i.subscription.status}</strong><p>{i.subscription.provider_id || 'Provider outcome requires review'}{i.subscription.current_end && ` · Current period ends ${i.subscription.current_end}`}{i.subscription.cancel_scheduled ? ' · Cancellation scheduled' : ''}</p><button disabled={busy} onClick={() => mutate('billing/sync', 'POST', {}, 'Subscription status refreshed')}><RefreshCw size={14}/>Refresh subscription</button>{i.subscription.status === 'active' && !i.subscription.cancel_scheduled && <button onClick={() => setCancelConfirm(true)}>Cancel at period end</button>}{cancelConfirm && <div className="info-strip"><span>Stop renewal at the end of the current billing period?</span><button disabled={busy} onClick={async () => { if (await mutate('billing/cancel', 'POST', {}, 'Cancellation scheduled')) setCancelConfirm(false); }}>Confirm cancellation</button><button onClick={() => setCancelConfirm(false)}>Keep subscription</button></div>}</div>}
    {i.subscription && ['creating', 'needs_review'].includes(i.subscription.status) && <form onSubmit={e => { e.preventDefault(); mutate('billing/reconcile', 'POST', Object.fromEntries(new FormData(e.currentTarget)), 'Provider subscription reconciled'); }}><label>Recover a subscription from the Razorpay dashboard<input name="provider_id" required pattern="sub_[a-zA-Z0-9]+" placeholder="sub_..."/></label><p>Use the ID whose notes match this checkout. This checks ownership before linking it and does not create another subscription.</p><button disabled={busy}>Reconcile subscription</button></form>}
    {i.message_allowance && <div className="info-strip"><span>{i.message_allowance.remaining.toLocaleString()} messages available this month · {i.message_allowance.reserved.toLocaleString()} reserved for pending campaigns. There is no contact-storage cap.</span></div>}
    {[['Messages used / booked', i.usage?.messages || 0, i.limits.messages], ['AI requests', i.usage?.ai_requests || 0, i.limits.ai_requests], ['AI tokens used / reserved', (i.usage?.input_tokens || 0) + (i.usage?.output_tokens || 0) + (i.usage?.reserved_tokens || 0), i.limits.tokens]].map(([label, value, limit]) => <div className="usage-row" key={String(label)}><div><strong>{label}</strong><span>{value} / {limit}</span></div><progress value={Number(value)} max={Number(limit) || 1}/></div>)}<p className="muted">Unknown provider outcomes retain their reserved allowance to avoid duplicate sends or unbounded AI spend.</p>
  </section><div className="billing-plans">{i.plans.map(plan => <section className="card settings-card" key={plan.id}><h2>{plan.name}</h2><strong className="plan-price">₹{(plan.price_paise / 100).toLocaleString('en-IN')}<small> / month</small></strong><p><Check size={13}/> {plan.messages.toLocaleString()} outbound messages<br/>{plan.ai_requests} AI requests · {plan.tokens.toLocaleString()} token cap<br/>12 monthly cycles · cancel renewal at period end</p><button className="primary" disabled={working || busy || !!w.business.demo || !i.billing_configured || !plan.configured || (!!i.subscription && !(i.subscription.status === 'created' && i.subscription.plan === plan.id))} onClick={() => subscribe(plan.id)}>{working ? 'Opening checkout…' : i.subscription?.plan === plan.id && i.subscription.status === 'created' ? 'Resume checkout' : 'Choose plan'}</button></section>)}</div>{feedback && <div className="info-strip" role="status">{feedback}</div>}<section className="card settings-card"><h2>Payment history</h2>{i.payments.length ? i.payments.map(payment => <div className="integration-event" key={payment.id}><strong>{payment.provider_id}</strong><span>{payment.currency} {(payment.amount_paise / 100).toFixed(2)}</span><small>{payment.status}</small></div>) : <p>Verified subscription payment events will appear here.</p>}</section></>;
}
