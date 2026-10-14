// Thin fetch wrapper. Every backend error body is {"detail": ...}:
// a ready-to-show sentence for 404/409/401/500, a list of fields for 422.

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000';
export const TENANT_ID = Number(import.meta.env.VITE_TENANT_ID || 1);
/** Local demo only: a Vite env value ships in the public bundle, so never deploy with it set. */
export const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string | undefined) || '';
export const hasAdminKey = ADMIN_KEY.length > 0;

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

const NETWORK_MESSAGE = `Can't reach FellaRide. Check that the API is running at ${API_URL}.`;

function toError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (status === 422 && Array.isArray(detail)) {
    const fields = detail.map((d: { loc?: (string | number)[]; msg?: string }) => ({
      field: String((d.loc || []).slice(-1)[0] ?? 'input'),
      message: d.msg || 'Invalid value',
    }));
    return new ApiError(status, fields.map((f) => `${f.field}: ${f.message}`).join('. '), fields);
  }
  if (typeof detail === 'string') return new ApiError(status, detail);
  return new ApiError(status, status >= 500 ? 'Something went wrong on our side. Please try again.' : `Request failed (${status}).`);
}

export async function request<T>(path: string, init: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method || 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.admin && ADMIN_KEY ? { 'X-Admin-Key': ADMIN_KEY } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw toError(res.status, body);
  return body as T;
}

/** Path under the current community: t('/members') -> /tenants/1/members */
export const t = (path: string) => `/tenants/${TENANT_ID}${path}`;
