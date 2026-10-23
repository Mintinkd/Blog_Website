export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: "string" | "number" | "boolean";
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: unknown) => boolean;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

export function validate(
  data: Record<string, unknown>,
  rules: ValidationRule[]
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  for (const rule of rules) {
    const value = data[rule.field];

    if (
      rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} is required`,
      });
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rule.type === "string" && typeof value !== "string") {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} must be a string`,
      });
      continue;
    }

    if (rule.type === "number" && typeof value !== "number") {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} must be a number`,
      });
      continue;
    }

    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push({
          field: rule.field,
          message:
            rule.message ||
            `${rule.field} must be at least ${rule.minLength} characters`,
        });
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push({
          field: rule.field,
          message:
            rule.message ||
            `${rule.field} must be at most ${rule.maxLength} characters`,
        });
      }
    }

    if (
      rule.pattern &&
      typeof value === "string" &&
      !rule.pattern.test(value)
    ) {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} format is invalid`,
      });
    }

    if (rule.custom && !rule.custom(value)) {
      errors.push({
        field: rule.field,
        message: rule.message || `${rule.field} validation failed`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isValidSlug(slug: string): boolean {
  return /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug);
}

/**
 * URL scheme 白名单（C1 / issue #43）：仅放行 http/https。
 * `new URL()` 对 `javascript:` 等危险 scheme 不抛错，必须显式收口协议，
 * 否则友链页脚可被植入站点源存储型 XSS。协议相对 URL、相对路径、
 * 无 scheme 主机名同样拒绝（无 base 时 `new URL` 抛错）。
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
