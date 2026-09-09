/**
 * Seed a local database with demo sites, cameras and responders.
 *   npm run seed
 */
import { buildContext } from '../src/app.js';

const ctx = buildContext({ logger: false });
const { repo } = ctx;

if (repo.listResponders(true).length > 0) {
  console.log('Database already seeded; nothing to do.');
  process.exit(0);
}

const alpha = repo.createResponder({
  name: 'Alpha Armed Response',
  type: 'armed_response',
  channel: 'log',
  channelConfig: {},
  phone: '+27 82 000 0001',
  email: null,
  active: true,
});
const bravo = repo.createResponder({
  name: 'Bravo Tactical (webhook)',
  type: 'armed_response',
  channel: 'webhook',
  channelConfig: { url: process.env.DEMO_RESPONDER_URL ?? 'http://localhost:9999/dispatch' },
  phone: '+27 82 000 0002',
  email: null,
  active: true,
});
const saps = repo.createResponder({
  name: 'SAPS Flying Squad',
  type: 'police',
  channel: 'log',
  channelConfig: {},
  phone: '10111',
  email: null,
  active: true,
});

const sites = [
  {
    name: 'Riverside Logistics Depot',
    address: '14 Harbour Rd, Cape Town',
    latitude: -33.9249,
    longitude: 18.4241,
    externalRef: 'SITE-RIVERSIDE',
    defaultResponderId: alpha.id,
    notes: 'Gate code 4471. Night guard on duty 18:00-06:00.',
    cameras: ['Main Gate', 'Loading Bay', 'Yard West Fence', 'Office Entrance'],
  },
  {
    name: 'Northgate Retail Park',
    address: '220 Republic Rd, Johannesburg',
    latitude: -26.0667,
    longitude: 27.9833,
    externalRef: 'SITE-NORTHGATE',
    defaultResponderId: bravo.id,
    notes: 'Centre management: 011 000 0000',
    cameras: ['Parking P1', 'Parking P2', 'Service Alley', 'ATM Lobby'],
  },
  {
    name: 'Highveld Solar Farm',
    address: 'R59, Vereeniging',
    latitude: -26.6731,
    longitude: 27.9261,
    externalRef: 'SITE-HIGHVELD',
    defaultResponderId: alpha.id,
    notes: 'Remote site. Nearest response ~25 min.',
    cameras: ['Perimeter N', 'Perimeter S', 'Inverter Shed', 'Access Road'],
  },
];

for (const s of sites) {
  const { cameras, ...site } = s;
  const created = repo.createSite(site);
  cameras.forEach((name, i) => repo.createCamera({ siteId: created.id, name, externalRef: `${site.externalRef}-CAM${i + 1}` }));
}

console.log(`Seeded ${sites.length} sites, ${sites.reduce((n, s) => n + s.cameras.length, 0)} cameras, 3 responders (incl. ${saps.name}).`);
ctx.db.close();
