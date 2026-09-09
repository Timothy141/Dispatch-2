import type { NormalizedAlert, Severity } from '../../domain/types.js';
import { asConfidence, asIsoDate, asString, PayloadError, pick, type InboundAdapter } from './types.js';

/**
 * DeepAlert inbound adapter.
 *
 * DeepAlert pushes verified detections to a configurable delivery endpoint.
 * Their exact JSON field names vary by account / integration profile, so this
 * adapter reads each field from an ordered list of candidate paths. Adjust the
 * candidate lists below (or the `FIELD_MAP` env override, see README) to match
 * the payload configured in the DeepAlert management interface.
 *
 * A single POST may contain one alert object, or `{ alerts: [...] }` /
 * `{ events: [...] }` / a bare array.
 */
export const DEEPALERT_FIELD_MAP = {
  externalId: ['alert_id', 'alertId', 'event_id', 'eventId', 'id', 'uuid'],
  siteRef: ['site_id', 'siteId', 'site.id', 'location_id', 'client_site_id'],
  siteName: ['site_name', 'siteName', 'site.name', 'location', 'location_name'],
  cameraRef: ['camera_id', 'cameraId', 'camera.id', 'channel_id', 'device_id'],
  cameraName: ['camera_name', 'cameraName', 'camera.name', 'camera', 'channel_name'],
  eventType: ['event_type', 'eventType', 'detection_type', 'type', 'rule', 'rule_name', 'label', 'classification'],
  confidence: ['confidence', 'probability', 'score', 'detection.confidence'],
  snapshotUrl: ['snapshot_url', 'snapshotUrl', 'image_url', 'imageUrl', 'image', 'thumbnail_url', 'media.image'],
  clipUrl: ['clip_url', 'clipUrl', 'video_url', 'videoUrl', 'media.video', 'playback_url'],
  occurredAt: ['timestamp', 'event_time', 'eventTime', 'occurred_at', 'detected_at', 'time', 'created_at'],
  description: ['description', 'message', 'summary', 'text'],
  objectCount: ['object_count', 'objectCount', 'count', 'detections.length'],
} as const;

type FieldMap = { [K in keyof typeof DEEPALERT_FIELD_MAP]: readonly string[] };

const SEVERITY_BY_TYPE: Array<[RegExp, Severity]> = [
  [/weapon|gun|firearm|knife|assault|attack|panic|duress|fire|smoke/i, 'critical'],
  [/intrud|intrusion|breach|perimeter|climb|forced|break|tailgat/i, 'high'],
  [/person|people|human|loiter|vehicle|car|truck|motorbike/i, 'medium'],
];

export function severityFor(eventType: string, confidence: number | null): Severity {
  let sev: Severity = 'low';
  for (const [re, s] of SEVERITY_BY_TYPE) {
    if (re.test(eventType)) {
      sev = s;
      break;
    }
  }
  if (sev === 'medium' && confidence !== null && confidence >= 0.9) sev = 'high';
  return sev;
}

export function humanizeEventType(t: string): string {
  return t
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function createDeepAlertAdapter(fieldMap: FieldMap = DEEPALERT_FIELD_MAP): InboundAdapter {
  const parseOne = (item: unknown, now: Date): NormalizedAlert => {
    if (!item || typeof item !== 'object') throw new PayloadError('Alert item must be an object');

    const eventTypeRaw = asString(pick(item, [...fieldMap.eventType])) ?? 'detection';
    const eventType = eventTypeRaw.toLowerCase().replace(/\s+/g, '_');
    const confidence = asConfidence(pick(item, [...fieldMap.confidence]));
    const cameraName = asString(pick(item, [...fieldMap.cameraName]));
    const siteName = asString(pick(item, [...fieldMap.siteName]));
    const count = pick(item, [...fieldMap.objectCount]);

    const titleParts = [humanizeEventType(eventType)];
    if (typeof count === 'number' && count > 1) titleParts[0] = `${count}x ${titleParts[0]}`;
    if (confidence !== null) titleParts.push(`${Math.round(confidence * 100)}%`);
    if (cameraName) titleParts.push(`· ${cameraName}`);

    return {
      source: 'deepalert',
      externalId: asString(pick(item, [...fieldMap.externalId])),
      site: { externalRef: asString(pick(item, [...fieldMap.siteRef])), name: siteName },
      camera: { externalRef: asString(pick(item, [...fieldMap.cameraRef])), name: cameraName },
      eventType,
      confidence,
      severity: severityFor(eventType, confidence),
      title: titleParts.join(' '),
      description: asString(pick(item, [...fieldMap.description])),
      snapshotUrl: asString(pick(item, [...fieldMap.snapshotUrl])),
      clipUrl: asString(pick(item, [...fieldMap.clipUrl])),
      occurredAt: asIsoDate(pick(item, [...fieldMap.occurredAt]), now),
      raw: item,
    };
  };

  return {
    source: 'deepalert',
    parse(body) {
      const now = new Date();
      if (Array.isArray(body)) return body.map((b) => parseOne(b, now));
      if (body && typeof body === 'object') {
        const list = pick(body, ['alerts', 'events', 'detections', 'data']);
        if (Array.isArray(list)) return list.map((b) => parseOne(b, now));
        return [parseOne(body, now)];
      }
      throw new PayloadError('Expected a JSON object or array');
    },
  };
}
