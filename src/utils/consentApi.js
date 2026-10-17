/**
 * Persist analytics consent for signed-in users. Fails quietly with no backend.
 */

export async function persistConsentToServer(analytics) {
  try {
    const response = await fetch('/api/auth/consent', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analytics: !!analytics }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.consent ?? null;
  } catch {
    return null;
  }
}
