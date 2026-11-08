export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PHOTOS: R2Bucket;
  ACCESS_TEAM_DOMAIN: string; // e.g. "https://alexmason.cloudflareaccess.com"
  ACCESS_AUD: string; // application audience tag from the dashboard
  ADMIN_EMAILS: string; // comma-separated allow-list
}

export interface Photo {
  id: number;
  r2_key: string;
  alt: string;
  width: number;
  height: number;
  sort_order: number;
  featured: number;
  created_at: string;
}
