import AuditLog from '../models/AuditLog.js';

export function buildChanges(document, payload, fields) {
  return fields
    .filter((field) => payload[field] !== undefined && JSON.stringify(document[field]) !== JSON.stringify(payload[field]))
    .map((field) => ({ field, oldValue: document[field], newValue: payload[field] }));
}

export async function writeAudit({ entity, entityId, action, changes, admin }) {
  if (!changes?.length) return null;
  return AuditLog.create({ entity, entityId, action, changes, admin });
}
