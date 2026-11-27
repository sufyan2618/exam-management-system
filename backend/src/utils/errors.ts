export interface ErrorDetail {
  field?: string;
  issue: string;
}

export class AppError extends Error {
  statusCode: number;
  code: string;
  details: ErrorDetail[];
  retryable: boolean;
  headers: Record<string, string>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: ErrorDetail[]; retryable?: boolean; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details ?? [];
    this.retryable = options.retryable ?? false;
    this.headers = options.headers ?? {};
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: ErrorDetail[]) =>
  new AppError(400, code, message, { details });
export const unauthorized = (message = "Authentication required", code = "AUTH_REQUIRED") =>
  new AppError(401, code, message);
export const forbidden = (message = "You do not have permission to perform this action", code = "FORBIDDEN") =>
  new AppError(403, code, message);
export const notFound = (entity = "Resource") => new AppError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (message: string, code = "CONFLICT", details?: ErrorDetail[]) =>
  new AppError(409, code, message, { details });
export const unprocessable = (message: string, code = "VALIDATION_FAILED", details?: ErrorDetail[]) =>
  new AppError(422, code, message, { details });
