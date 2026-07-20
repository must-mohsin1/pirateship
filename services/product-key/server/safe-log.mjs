function safeIdentifier(value, fallback) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? value
    : fallback;
}

export function safeErrorMetadata(error) {
  return {
    name: safeIdentifier(error?.name, "Error"),
    code: safeIdentifier(error?.code, "UNKNOWN"),
    status: Number.isInteger(error?.status) ? error.status : undefined,
  };
}

export function logServerError(context, error) {
  console.error(context, safeErrorMetadata(error));
}
