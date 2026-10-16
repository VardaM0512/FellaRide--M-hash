// Fetch wrapper. Every backend error body is {"detail": ...}: a ready-to-show sentence for
// 401/403/404/409/429/500, or a list of fields for 422. The signed-in token is attached automatically.

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000';

export interface FieldError { field: string; message: string }

export class ApiError extends Error {
  status: number;
  fields: FieldError[];
  constructor(status: number, message: string, fields: FieldError[] = []) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

let token: string | null = null;
export const setAuthToken = (t: string | null) => { token = t; };

const FIELD_NAMES: Record<string, string> = {
  password: 'Password', email: 'Email', name: 'Name', mobile: 'Mobile number', gender: 'Gender', join_code: 'Join code', home_lat: 'Home location',
  home_lon: 'Home location', depart_min: 'Departure time', seats: 'Seats', rating: 'Rating', comment: 'Comment',
  route_km: 'Route length (km)', route_min: 'Route time (minutes)', depart_at: 'Leaving time', price_per_km: 'Price per km', upi_id: 'UPI ID',
};

function toError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 422 && Array.isArray(detail)) {
    const fields = detail.map((d: { loc?: (string | number)[]; msg?: string }) => {
      const field = String((d.loc || []).slice(-1)[0] ?? 'input');
      return { field, message: `${FIELD_NAMES[field] || field}: ${(d.msg || 'invalid value').replace(/^Value error, /, '')}` };
    });
    return new ApiError(status, fields.map((f) => f.message).join('. '), fields);
  }
  if (typeof detail === 'string') return new ApiError(status, detail);
  return new ApiError(status, status >= 500 ? 'Something went wrong on our side. Please try again.' : `Request failed (${status}).`);
}

export async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method || 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token && init.auth !== false ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach FellaRide. Check your connection and try again.');
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && token && init.auth !== false) window.dispatchEvent(new Event('fellaride:signed-out'));
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}
