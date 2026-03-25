export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type ResponseType = "json" | "blob" | "text" | "void";

// 自定义错误类型
export class ApiError extends Error {
  status: number;
  data?: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// 全局错误处理函数
export function handleApiError(error: any): never {
  if (error instanceof ApiError) {
    // 处理401错误（未授权）
    if (error.status === 401) {
      localStorage.removeItem('token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw error;
  } else if (error instanceof Error) {
    // 处理网络错误
    if (!navigator.onLine) {
      throw new ApiError('网络连接已断开，请检查网络设置', 0);
    }
    throw new ApiError(error.message || '未知错误', 0);
  } else {
    throw new ApiError('未知错误，请稍后重试', 0);
  }
}

async function readBody(res: Response, responseType: ResponseType): Promise<any> {
  if (responseType === "void") return null;
  if (responseType === "blob") return await res.blob();
  if (responseType === "text") return await res.text();

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }
  // 兼容后端偶尔返回非 JSON 的情况
  const txt = await res.text().catch(() => "");
  return txt ? { raw: txt } : null;
}

function buildAuthHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem("token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

const API_BASE = (import.meta.env.VITE_API_BASE as string) || "";

async function request<T>(
  url: string,
  options: RequestInit = {},
  responseType: ResponseType = "json",
  jsonBody: boolean = true
): Promise<T> {
  try {
    const fullUrl = url.startsWith("/") ? `${API_BASE}${url}` : url;
    const providedSignal = (options as any).signal as AbortSignal | undefined;
    const timeoutMsFromCaller = (options as any).timeoutMs as number | undefined;
    const timeoutMs =
      timeoutMsFromCaller ??
      (responseType === "blob" ? 120_000 : 30_000);

    const controller = providedSignal ? null : new AbortController();
    const timeoutId =
      controller && timeoutMs > 0
        ? window.setTimeout(() => controller?.abort(), timeoutMs)
        : null;

    const res = await fetch(fullUrl, {
      headers: {
        ...(jsonBody ? { "Content-Type": "application/json" } : {}),
        ...buildAuthHeaders(options.headers),
      },
      ...options,
      signal: controller ? controller.signal : options.signal,
    });

    if (timeoutId) window.clearTimeout(timeoutId);

    const data = await readBody(res, responseType);

    if (!res.ok) {
      const err = (data as any)?.error;
      const errorMessage =
        typeof err === "string"
          ? err
          : err?.message || (data as any)?.message || `请求失败：${res.status}`;
      throw new ApiError(errorMessage, res.status, data);
    }

    return data as T;
  } catch (error) {
    return handleApiError(error);
  }
}

export const apiClient = {
  get<T>(url: string) {
    return request<T>(url, { method: "GET" }, "json", false);
  },
  post<T>(url: string, body: unknown) {
    return request<T>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  put<T>(url: string, body: unknown) {
    return request<T>(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
  delete<T>(url: string) {
    return request<T>(url, { method: "DELETE" }, "json", false);
  },

  // 用于导出/下载等二进制响应（同样具备 401 统一处理能力）
  getBlob(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal }) {
    return request<Blob>(
      url,
      {
        method: "GET",
        timeoutMs: opts?.timeoutMs,
        signal: opts?.signal,
      } as any,
      "blob",
      false
    );
  },

  // 用于上传 FormData（不要手动设置 Content-Type，让浏览器自动带 boundary）
  postFormData<T>(url: string, formData: FormData) {
    return request<T>(
      url,
      {
        method: "POST",
        body: formData,
      },
      "json",
      false
    );
  },
};

