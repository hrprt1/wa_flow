export type User = { id: number; name: string; email: string };
export type Customer = { id: number; name: string; phone: string; email: string | null; tag: string; status: string; opted_in: boolean };
export type Conversation = { id: number; name: string; phone: string; tag: string; customer_id: number; mode: 'ai' | 'human'; status: string; unread: number; assignee: string | null; updated_at: string };
export type Message = { id: number; conversation_id: number; body: string; direction: string; status: string; created_at: string; error_code?: string | null };
export type Product = { id: number; name: string; sku: string; category: string; price_paise: number; stock: number };
export type Automation = { id: number; name: string; keyword: string; response: string; active: boolean; runs: number };
export type Workspace = {
  business: { id: number; name: string; industry: string; email: string; demo: boolean; ai_enabled: boolean };
  integrations: IntegrationStatus;
  customers: Customer[]; conversations: Conversation[]; messages: Message[]; products: Product[]; automations: Automation[];
  knowledge: { id: number; title: string; content: string }[];
  campaigns: { id: number; name: string; audience: string; body: string; status: string }[];
  metrics: { customers: number; messages: number; open: number; resolved: number; automations: number };
  activity: { day: string; count: number }[];
};

export type IntegrationStatus = {
  whatsapp: { phone_number_id: string; display_phone: string; waba_id: string | null; webhook_verified_at: string | null; connection_type: 'manual' | 'embedded' } | null;
  embedded_signup: { configured: boolean };
  webhook_url: string | null; webhook_verify_token: string | null;
  meta_configured: boolean; ai_configured: boolean; billing_configured: boolean; billing_test_mode: boolean;
  subscription: { provider_id: string | null; plan: string; status: string; current_end: string | null; cancel_scheduled: boolean } | null;
  limits: { plan: string; messages: number; ai_requests: number; tokens: number };
  message_allowance?: { plan: string; period: string; limit: number; used: number; reserved: number; remaining: number };
  usage: { messages: number; ai_requests: number; input_tokens: number; output_tokens: number; reserved_tokens: number } | null;
  plans: { id: string; name: string; price_paise: number; messages: number; ai_requests: number; tokens: number; configured: boolean }[];
  payments: { id: number; provider_id: string; amount_paise: number; currency: string; status: string; created_at: string }[];
  events: { id: number; provider: string; status: string; error_code: string | null; created_at: string }[];
};
