import { z } from 'zod';
import type { NormalizedAlert } from '../../domain/types.js';
import { SEVERITIES } from '../../domain/types.js';
import { severityFor, humanizeEventType } from './deepalert.js';
import { asIsoDate, PayloadError, type InboundAdapter } from './types.js';

/**
 * Generic, documented alert format for any other VMS / analytics platform.
 * POST /api/webhooks/generic
 */
export const GenericAlertSchema = z.object({
  id: z.string().optional(),
  site: z.object({ ref: z.string().optional(), name: z.string().optional() }).optional(),
  camera: z.object({ ref: z.string().optional(), name: z.string().optional() }).optional(),
  eventType: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  severity: z.enum(SEVERITIES).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  snapshotUrl: z.string().url().optional(),
  clipUrl: z.string().url().optional(),
  occurredAt: z.string().optional(),
});
export type GenericAlert = z.infer<typeof GenericAlertSchema>;

export const genericAdapter: InboundAdapter = {
  source: 'generic',
  parse(body) {
    const items = Array.isArray(body) ? body : [body];
    return items.map((item): NormalizedAlert => {
      const parsed = GenericAlertSchema.safeParse(item);
      if (!parsed.success) {
        throw new PayloadError(`Invalid generic alert: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      }
      const a = parsed.data;
      const confidence = a.confidence ?? null;
      return {
        source: 'generic',
        externalId: a.id ?? null,
        site: { externalRef: a.site?.ref ?? null, name: a.site?.name ?? null },
        camera: { externalRef: a.camera?.ref ?? null, name: a.camera?.name ?? null },
        eventType: a.eventType,
        confidence,
        severity: a.severity ?? severityFor(a.eventType, confidence),
        title: a.title ?? humanizeEventType(a.eventType),
        description: a.description ?? null,
        snapshotUrl: a.snapshotUrl ?? null,
        clipUrl: a.clipUrl ?? null,
        occurredAt: asIsoDate(a.occurredAt),
        raw: item,
      };
    });
  },
};
