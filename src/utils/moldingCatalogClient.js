// Admin catalog fetch. A 404 means the caller is not an admin.

export async function moldingRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const error = new Error(parsed?.error || 'Could not save the catalog');
    error.status = res.status;
    throw error;
  }
  return parsed;
}
