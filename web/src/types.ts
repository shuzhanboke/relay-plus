export interface User {
  id: number;
  email: string;
  username: string | null;
  role: string;
  status: string;
  balance: number;
  created_at: string;
  key_count?: number;
  spent?: number;
}

export interface Group {
  id: number;
  name: string;
  platform: string;
  description: string | null;
  created_at: string;
  account_count?: number;
  rate_multiplier?: number;
  model_count?: number;
}

export interface UpstreamAccount {
  id: number;
  name: string;
  platform: string;
  type: string;
  base_url: string | null;
  has_api_key: boolean;
  email: string | null;
  proxy_id: number | null;
  proxy_name: string | null;
  concurrency: number;
  priority: number;
  rate_multiplier: number;
  status: string;
  last_error: string | null;
  created_at: string;
  groups: string[];
}

export interface Proxy {
  id: number;
  name: string;
  protocol: string;
  host: string;
  port: number;
  status: string;
  created_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  user_email?: string;
  name: string;
  key_prefix: string;
  key_tail: string;
  model_whitelist: string[] | null;
  group_id: number | null;
  group_name?: string | null;
  rps_limit: number | null;
  rpm_limit: number | null;
  tpm_limit: number | null;
  expires_at: string | null;
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ModelPrice {
  id: number;
  model: string;
  provider: string;
  input_price: number;
  output_price: number;
  cache_read_price: number;
  cache_write_price: number;
  official_input_price: number | null;
  official_output_price: number | null;
  context_window: number | null;
  updated_at?: string;
}

export interface LogEntry {
  id: number;
  user_email: string | null;
  model: string;
  endpoint: string;
  platform: string;
  stream: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost: number;
  success: boolean;
  status_code: number;
  error_message: string | null;
  latency_ms: number;
  ip: string | null;
  created_at: string;
}
