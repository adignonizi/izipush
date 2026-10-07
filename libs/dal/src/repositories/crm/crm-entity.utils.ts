/** Document Mongo « lean » → entité CRM : identifiants en chaînes, prête à être renvoyée par l'API. */
export function toCrmEntity<T>(doc: unknown): T {
  const record = doc as Record<string, unknown>;

  return {
    ...record,
    _id: String(record._id),
    _environmentId: String(record._environmentId),
    _organizationId: String(record._organizationId),
  } as T;
}
