import { describe, expect, it } from 'vitest';
import { createDeepAlertAdapter, severityFor } from '../src/integrations/inbound/deepalert.js';
import { asConfidence } from '../src/integrations/inbound/types.js';

const adapter = createDeepAlertAdapter();

describe('DeepAlert adapter', () => {
  it('maps a typical single-alert payload', () => {
    const [a] = adapter.parse(
      {
        alert_id: 'da-123',
        site_id: 'S-1',
        site_name: 'Warehouse North',
        camera_id: 'C-9',
        camera_name: 'Gate 2',
        event_type: 'Person detection',
        confidence: 95,
        image_url: 'https://cdn.example/snap.jpg',
        video_url: 'https://cdn.example/clip.mp4',
        timestamp: '2026-09-09T10:00:00Z',
      },
      {},
    );
    expect(a.source).toBe('deepalert');
    expect(a.externalId).toBe('da-123');
    expect(a.site).toEqual({ externalRef: 'S-1', name: 'Warehouse North' });
    expect(a.camera).toEqual({ externalRef: 'C-9', name: 'Gate 2' });
    expect(a.eventType).toBe('person_detection');
    expect(a.confidence).toBe(0.95);
    expect(a.severity).toBe('high'); // person >= 0.9 escalates
    expect(a.title).toBe('Person Detection 95% · Gate 2');
    expect(a.snapshotUrl).toBe('https://cdn.example/snap.jpg');
    expect(a.clipUrl).toBe('https://cdn.example/clip.mp4');
    expect(a.occurredAt).toBe('2026-09-09T10:00:00.000Z');
  });

  it('accepts batched payloads and camelCase keys', () => {
    const list = adapter.parse(
      { alerts: [{ alertId: '1', eventType: 'vehicle', probability: '0.71', eventTime: 1757412000 }, { id: '2', type: 'loitering' }] },
      {},
    );
    expect(list).toHaveLength(2);
    expect(list[0].confidence).toBeCloseTo(0.71);
    expect(list[0].occurredAt).toBe('2025-09-09T10:00:00.000Z'); // epoch seconds
    expect(list[1].externalId).toBe('2');
    expect(list[1].eventType).toBe('loitering');
    expect(list[1].confidence).toBeNull();
  });

  it('rejects non-object bodies', () => {
    expect(() => adapter.parse('nope', {})).toThrow(/Expected a JSON object/);
    expect(() => adapter.parse([42], {})).toThrow(/must be an object/);
  });

  it('never drops an alert with missing fields', () => {
    const [a] = adapter.parse({}, {});
    expect(a.eventType).toBe('detection');
    expect(a.title).toBe('Detection');
    expect(a.severity).toBe('low');
    expect(new Date(a.occurredAt).getTime()).toBeGreaterThan(0);
  });
});

describe('severityFor', () => {
  it('ranks weapon/panic as critical and intrusion as high', () => {
    expect(severityFor('weapon_detected', 0.5)).toBe('critical');
    expect(severityFor('perimeter_breach', null)).toBe('high');
    expect(severityFor('vehicle', 0.5)).toBe('medium');
    expect(severityFor('unknown_thing', null)).toBe('low');
  });
});

describe('asConfidence', () => {
  it('normalises floats, percentages and strings', () => {
    expect(asConfidence(0.5)).toBe(0.5);
    expect(asConfidence(88)).toBe(0.88);
    expect(asConfidence('92%')).toBe(0.92);
    expect(asConfidence('abc')).toBeNull();
    expect(asConfidence(undefined)).toBeNull();
  });
});
