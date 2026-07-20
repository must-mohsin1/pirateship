export function requireEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required by the product-key service.`);
  return value;
}

export function normalizePublicOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, "")) {
    throw new Error("PUBLIC_ORIGIN must contain only the public scheme and host.");
  }
  return url.origin;
}

export function integerEnvironment(environment, name, defaultValue, minimum = 1) {
  const source = environment[name]?.trim() || defaultValue;
  if (!/^\d+$/.test(String(source ?? ""))) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  return value;
}
