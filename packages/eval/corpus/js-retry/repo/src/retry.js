export async function retry(fn, options = {}) {
  const attempts =
    typeof options === "number" ? options : (options.attempts ?? 3);
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
