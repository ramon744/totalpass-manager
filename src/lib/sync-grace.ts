/** Janela em que edições locais não são sobrescritas pelo sync do Asaas. */
export const LOCAL_EDIT_GRACE_MS = 10 * 60 * 1000;

export function wasRecentlyUpdated(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < LOCAL_EDIT_GRACE_MS;
}
