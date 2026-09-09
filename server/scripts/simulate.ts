/**
 * Fire fake DeepAlert webhooks at a running server so the console has traffic.
 *   npm run simulate            # one alert
 *   npm run simulate -- 5 2000  # 5 alerts, 2s apart
 */
const base = process.env.BASE_URL ?? 'http://localhost:8080';
const secret = process.env.WEBHOOK_SECRET_DEEPALERT ?? '';
const count = Number(process.argv[2] ?? 1);
const gapMs = Number(process.argv[3] ?? 1500);

const sites = [
  { id: 'SITE-RIVERSIDE', name: 'Riverside Logistics Depot', cams: ['CAM1|Main Gate', 'CAM2|Loading Bay', 'CAM3|Yard West Fence'] },
  { id: 'SITE-NORTHGATE', name: 'Northgate Retail Park', cams: ['CAM1|Parking P1', 'CAM3|Service Alley', 'CAM4|ATM Lobby'] },
  { id: 'SITE-HIGHVELD', name: 'Highveld Solar Farm', cams: ['CAM1|Perimeter N', 'CAM2|Perimeter S', 'CAM4|Access Road'] },
];
const events = ['person', 'person', 'vehicle', 'loitering', 'intrusion', 'perimeter_breach', 'tailgating'];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

for (let i = 0; i < count; i++) {
  const site = pick(sites);
  const [camRef, camName] = pick(site.cams).split('|');
  const event = pick(events);
  const confidence = Math.round((0.6 + Math.random() * 0.4) * 100);
  const seed = Math.floor(Math.random() * 1000);
  const payload = {
    alert_id: `sim-${Date.now()}-${i}`,
    site_id: site.id,
    site_name: site.name,
    camera_id: `${site.id}-${camRef}`,
    camera_name: camName,
    event_type: event,
    confidence,
    object_count: event === 'person' ? 1 + Math.floor(Math.random() * 3) : 1,
    image_url: `https://picsum.photos/seed/${seed}/960/540`,
    video_url: null,
    timestamp: new Date().toISOString(),
    description: `Simulated ${event} detection`,
  };
  const res = await fetch(`${base}/api/webhooks/deepalert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) },
    body: JSON.stringify(payload),
  });
  console.log(`${res.status} ${payload.site_name} / ${camName}: ${event} ${confidence}%`);
  if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs));
}
