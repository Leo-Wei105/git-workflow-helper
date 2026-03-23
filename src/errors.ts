export type ErrorCode =
  | "USER_CANCELLED"
  | "GIT_COMMAND_FAILED"
  | "NOT_GIT_REPO"
  | "INVALID_WORKSPACE"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly stage?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ErrorCode = "UNKNOWN",
    options?: { stage?: string; cause?: unknown }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.stage = options?.stage;
    this.cause = options?.cause;
  }

  static userCancelled(message: string): AppError {
    return new AppError(message, "USER_CANCELLED");
  }

  static gitFailed(message: string, stage?: string, cause?: unknown): AppError {
    return new AppError(message, "GIT_COMMAND_FAILED", { stage, cause });
  }
}

export function toAppError(error: unknown, fallbackMessage = "未知错误"): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError(error.message || fallbackMessage, "UNKNOWN", { cause: error });
  }
  return new AppError(String(error || fallbackMessage), "UNKNOWN", { cause: error });
}

export function isUserCancelledError(error: unknown): boolean {
  const appError = error instanceof AppError ? error : null;
  if (appError?.code === "USER_CANCELLED") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("取消");
}
