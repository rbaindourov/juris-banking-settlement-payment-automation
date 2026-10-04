import { PortalApiResponse, SelectPaymentPayload, SelectPaymentResponse, ReceiptData } from '../types/portal.types';

const API_BASE = '/api/public/claim';

export async function fetchPortalApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.message || data?.error || `HTTP error ${res.status}`) as any;
    error.status = res.status;
    error.code = data?.error;
    error.data = data;
    throw error;
  }

  return data as T;
}

export const portalApi = {
  async getClaim(token: string, lang?: string): Promise<PortalApiResponse> {
    const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
    return fetchPortalApi<PortalApiResponse>(`/${encodeURIComponent(token)}${query}`);
  },

  async selectPayment(token: string, payload: SelectPaymentPayload): Promise<SelectPaymentResponse> {
    return fetchPortalApi<SelectPaymentResponse>(`/${encodeURIComponent(token)}/select-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  async getReceipt(token: string): Promise<{ success: boolean; receipt: ReceiptData }> {
    return fetchPortalApi<{ success: boolean; receipt: ReceiptData }>(`/${encodeURIComponent(token)}/receipt`);
  }
};
