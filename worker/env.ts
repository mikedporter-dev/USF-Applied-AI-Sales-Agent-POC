export interface Env {
  ASSETS: Fetcher;
  NVIDIA_BASE_URL: string;
  NVIDIA_MODEL: string;
  // Secrets: optional until each integration is connected.
  NVIDIA_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}
