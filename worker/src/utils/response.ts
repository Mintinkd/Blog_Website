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

export interface PaginatedResponse<T = unknown> extends ApiResponse<PaginatedData<T>> {}

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

export function success<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: ErrorCodes.SUCCESS, message, data };
}

export function paginated<T>(items: T[], total: number, page: number, page_size: number): PaginatedResponse<T> {
  return {
    code: ErrorCodes.SUCCESS,
    message: 'ok',
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

export function successResponse<T>(data: T, message = 'ok'): Response {
  return Response.json(success(data, message));
}

export function paginatedResponse<T>(items: T[], total: number, page: number, page_size: number): Response {
  return Response.json(paginated(items, total, page, page_size));
}

export function notFound(message = 'Resource not found'): Response {
  return error(ErrorCodes.NOT_FOUND, message, 404);
}

export function unauthorized(message = 'Unauthorized'): Response {
  return error(ErrorCodes.UNAUTHORIZED, message, 401);
}

export function forbidden(message = 'Forbidden'): Response {
  return error(ErrorCodes.FORBIDDEN, message, 403);
}

export function rateLimited(message = 'Too many requests'): Response {
  return error(ErrorCodes.RATE_LIMITED, message, 429);
}

export function serverError(message = 'Internal server error'): Response {
  return error(ErrorCodes.SERVER_ERROR, message, 500);
}