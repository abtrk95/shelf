export function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]!));
}
export function safeURL(value: string): string | null {
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function safeFilename(name: string): string {
  return name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'download';
}
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'; const exponent = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent && bytes / 1024 ** exponent < 10 ? 1 : 0)} ${['B','KB','MB','GB'][exponent]}`;
}
export function formatClock(ms: number): string { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`; }
export function deviceName(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : 'Linux';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return ['iPhone', 'iPad', 'Android'].includes(platform) ? platform : `${browser} on ${platform}`;
}
export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function isMobileDevice(name: string): boolean { return /phone|android|ipad|mobile|tablet/i.test(name); }
