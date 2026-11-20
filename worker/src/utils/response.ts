export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<
  PaginatedData<T>
> {}

export const ErrorCodes = {
  SUCCESS: 0,
  PARAM_ERROR: 10001,
  VALIDATION_FAILED: 10002,
  UNAUTHORIZED: 10003,
  FORBIDDEN: 10004,
  NOT_FOUND: 10005,
  CONFLICT: 10006,
  RATE_LIMITED: 10007,
  SERVER_ERROR: 10008,
} as const;

// issue #101 / M21：以下两个包装函数无外部调用（仅 successResponse / paginatedResponse 内部复用），
// 去掉 export 收敛模块 API；serverError 有 like/reconcile 真实调用，保留导出。
function success<T>(data: T, message = "ok"): ApiResponse<T> {
  return { code: ErrorCodes.SUCCESS, message, data };
}

function paginated<T>(
  items: T[],
  total: number,
  page: number,
  page_size: number
): PaginatedResponse<T> {
  return {
    code: ErrorCodes.SUCCESS,
    message: "ok",
    data: {
      items,
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    },
  };
}

export function error(code: number, message: string, status = 400): Response {
  return Response.json({ code, message, data: null }, { status });
}

export function successResponse<T>(data: T, message = "ok"): Response {
  return Response.json(success(data, message));
}
/**
 * 安全解析 JSON 请求体。解析失败时返回 400 错误响应，而非让异常冒泡到 router 层变成 500。
 *
 * 用法：
 *   const body = await parseJsonBody(request);
 *   if (body instanceof Response) return body;
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  request: Request
): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return error(ErrorCodes.VALIDATION_FAILED, "请求体不是合法的 JSON", 400);
  }
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  page_size: number
): Response {
  return Response.json(paginated(items, total, page, page_size));
}

export function notFound(message = "Resource not found"): Response {
  return error(ErrorCodes.NOT_FOUND, message, 404);
}

export function unauthorized(message = "Unauthorized"): Response {
  return error(ErrorCodes.UNAUTHORIZED, message, 401);
}

export function forbidden(message = "Forbidden"): Response {
  return error(ErrorCodes.FORBIDDEN, message, 403);
}

export function rateLimited(message = "Too many requests"): Response {
  return error(ErrorCodes.RATE_LIMITED, message, 429);
}

export function serverError(message = "Internal server error"): Response {
  return error(ErrorCodes.SERVER_ERROR, message, 500);
}
