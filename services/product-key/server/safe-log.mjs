function safeIdentifier(value, fallback) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? value
    : fallback;
}

function safeSqliteReason(value) {
  return typeof value === "string" && /^[a-zA-Z0-9 _-]{1,64}$/.test(value)
    ? value
    : undefined;
}

export function safeErrorMetadata(error) {
  const metadata = {
    name: safeIdentifier(error?.name, "Error"),
    code: safeIdentifier(error?.code, "UNKNOWN"),
    status: Number.isInteger(error?.status) ? error.status : undefined,
  };
  if (metadata.code === "ERR_SQLITE_ERROR") {
    metadata.sqliteErrcode = Number.isInteger(error?.errcode) ? error.errcode : undefined;
    metadata.sqliteErrstr = safeSqliteReason(error?.errstr);
  }
  return metadata;
}

export function logServerError(context, error) {
  console.error(context, safeErrorMetadata(error));
}
