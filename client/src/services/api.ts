import {
  Case,
  Claimant,
  StageUploadResult,
  TemplatePreviewResponse,
  FinancialSummaryMetrics,
  FunnelAnalyticsData,
  PaymentRailMetricsData,
  ExceptionsResponse,
  ExceptionItem,
  ResolveExceptionPayload
} from '../types';

const API_BASE = '/api';

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'include' // Send HttpOnly auth cookie
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = data?.error || data?.message || `HTTP error ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const caseApi = {
  async listCases(params: { page?: number; limit?: number; search?: string; status?: string } = {}) {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.search) searchParams.set('search', params.search);
    if (params.status) searchParams.set('status', params.status);

    const query = searchParams.toString();
    return fetchApi<{ cases: Case[]; total: number; page: number; totalPages: number }>(
      `/cases${query ? `?${query}` : ''}`
    );
  },

  async getCase(id: string) {
    return fetchApi<{ case: Case }>(`/cases/${id}`);
  },

  async createCase(caseData: Partial<Case>) {
    return fetchApi<{ message: string; case: Case }>('/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(caseData)
    });
  },

  async updateCase(id: string, updates: Partial<Case>) {
    return fetchApi<{ message: string; case: Case }>(`/cases/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  },

  async stageClaimantUpload(caseId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return fetchApi<StageUploadResult>(`/cases/${caseId}/claimants/stage-upload`, {
      method: 'POST',
      body: formData
    });
  },

  async commitClaimantUpload(caseId: string, claimants: any[]) {
    return fetchApi<{ success: boolean; insertedCount: number; caseId: string }>(
      `/cases/${caseId}/claimants/commit-upload`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimants })
      }
    );
  },

  async listClaimants(caseId: string, params: { page?: number; limit?: number; search?: string; status?: string } = {}) {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.search) searchParams.set('search', params.search);
    if (params.status) searchParams.set('status', params.status);

    const query = searchParams.toString();
    return fetchApi<{ claimants: Claimant[]; total: number; page: number; totalPages: number }>(
      `/cases/${caseId}/claimants${query ? `?${query}` : ''}`
    );
  },

  async previewTemplate(
    caseId: string,
    payload: {
      template?: string;
      sampleData?: Record<string, any>;
      viewport?: 'desktop' | 'mobile';
      language?: string;
      type?: 'email' | 'landing';
    }
  ) {
    return fetchApi<TemplatePreviewResponse>(`/cases/${caseId}/templates/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
};

export const analyticsApi = {
  async getSummary(caseId: string): Promise<FinancialSummaryMetrics> {
    return fetchApi<FinancialSummaryMetrics>(`/cases/${caseId}/analytics/summary`);
  },

  async getFunnel(caseId: string): Promise<FunnelAnalyticsData> {
    return fetchApi<FunnelAnalyticsData>(`/cases/${caseId}/analytics/funnel`);
  },

  async getMethods(caseId: string): Promise<PaymentRailMetricsData> {
    return fetchApi<PaymentRailMetricsData>(`/cases/${caseId}/analytics/methods`);
  },

  async listExceptions(
    caseId: string,
    params: {
      page?: number;
      limit?: number;
      exceptionType?: string;
      resolved?: boolean;
      status?: string;
      search?: string;
    } = {}
  ): Promise<ExceptionsResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.exceptionType) searchParams.set('exceptionType', params.exceptionType);
    if (params.resolved !== undefined) searchParams.set('resolved', String(params.resolved));
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);

    const query = searchParams.toString();
    return fetchApi<ExceptionsResponse>(`/cases/${caseId}/exceptions${query ? `?${query}` : ''}`);
  },

  async resolveException(
    caseId: string,
    exceptionId: string,
    payload: ResolveExceptionPayload
  ): Promise<{ message: string; exception: ExceptionItem }> {
    return fetchApi<{ message: string; exception: ExceptionItem }>(
      `/cases/${caseId}/exceptions/${exceptionId}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
  },

  async downloadAuditExport(caseId: string, docketNumber: string = 'case'): Promise<void> {
    const res = await fetch(`/api/cases/${caseId}/audit-export`, {
      credentials: 'include',
      headers: { Accept: 'text/csv' }
    });

    if (!res.ok) {
      throw new Error(`Export failed with HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `case_${docketNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_audit_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
};

