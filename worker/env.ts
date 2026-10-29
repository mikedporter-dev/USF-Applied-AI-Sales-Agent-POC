export interface Env {
  ASSETS: Fetcher;
  NVIDIA_BASE_URL: string;
  NVIDIA_MODEL: string;
  MASSIVE_BASE_URL: string;
  // Secrets: optional until each integration is connected.
  NVIDIA_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  MASSIVE_API_KEY?: string;
  /** SEC asks every EDGAR request to name a contact, e.g. "Jane Doe jane@example.com". */
  SEC_USER_AGENT?: string;
}
