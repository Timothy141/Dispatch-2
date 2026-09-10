import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/app.js';
import { CBD, dispatcher, makeContext, north, requester, responder, secondsLater } from './helpers.js';

describe('matching engine', () => {
  let ctx: AppContext;
  beforeEach(() => {
    ctx = makeContext();
  });
  afterEach(() => ctx.db.close());

  it('offers to the nearest units of the right service, up to the fanout', () => {
    const near = responder(ctx, 'SEC-1', 'security', north(CBD, 1));
    const mid = responder(ctx, 'SEC-2', 'security', north(CBD, 3));
    responder(ctx, 'SEC-3', 'security', north(CBD, 6));
    responder(ctx, 'MED-1', 'medical', north(CBD, 0.5)); // wrong service
    responder(ctx, 'SEC-FAR', 'security', north(CBD, 50)); // out of radius
    responder(ctx, 'SEC-NOLOC', 'security', null); // no location

    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'security', ...CBD });
    expect(req.status).toBe('searching');
    const offers = ctx.repo.listOffers({ requestId: req.id });
    expect(offers.map((o) => o.responderId)).toEqual([near.id, mid.id]);
    expect(offers[0].distanceM).toBeLessThan(offers[1].distanceM);
    expect(offers[0].distanceM).toBeGreaterThan(900);
    expect(offers[0].distanceM).toBeLessThan(1100);
  });

  it('first acceptance wins, others are withdrawn and the unit becomes busy', () => {
    const a = responder(ctx, 'SEC-1', 'security', north(CBD, 1));
    const b = responder(ctx, 'SEC-2', 'security', north(CBD, 2));
    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'security', ...CBD });
    const [oa, ob] = ctx.repo.listOffers({ requestId: req.id });

    const assigned = ctx.dispatch.acceptOffer(b.id === ob.responderId ? b : a, ob.id);
    expect(assigned.status).toBe('assigned');
    expect(assigned.responderId).toBe(b.id);
    expect(assigned.etaSeconds).toBeGreaterThan(60);
    expect(ctx.repo.getOffer(oa.id)!.status).toBe('withdrawn');
    expect(ctx.repo.getResponder(b.id)!.status).toBe('busy');
    expect(ctx.repo.getResponder(a.id)!.status).toBe('available');
    expect(() => ctx.dispatch.acceptOffer(a, oa.id)).toThrow(/withdrawn/);
  });

  it('declines and expiries move the offer to the next nearest unit', () => {
    const a = responder(ctx, 'SEC-1', 'security', north(CBD, 1));
    responder(ctx, 'SEC-2', 'security', north(CBD, 2));
    const c = responder(ctx, 'SEC-3', 'security', north(CBD, 3));
    const d = responder(ctx, 'SEC-4', 'security', north(CBD, 4));
    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'security', ...CBD });

    const first = ctx.repo.listOffers({ requestId: req.id, status: ['pending'] });
    expect(first).toHaveLength(2);
    ctx.dispatch.declineOffer(a, first.find((o) => o.responderId === a.id)!.id);
    let pending = ctx.repo.listOffers({ requestId: req.id, status: ['pending'] });
    expect(pending.map((o) => o.responderId).sort()).toEqual([first[1].responderId, c.id].sort());

    // nobody answers: after the timeout both expire and the fourth unit is asked
    ctx.dispatch.tick(secondsLater(21));
    pending = ctx.repo.listOffers({ requestId: req.id, status: ['pending'] });
    expect(pending.map((o) => o.responderId)).toEqual([d.id]);
    expect(ctx.repo.listOffers({ requestId: req.id, status: ['expired'] })).toHaveLength(2);
  });

  it('keeps searching while no units exist, picks one up when it comes online, and gives up after the search timeout', () => {
    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'fire', ...CBD });
    expect(ctx.repo.listOffers({ requestId: req.id })).toHaveLength(0);
    expect(ctx.repo.listEvents(req.id).map((e) => e.type)).toContain('no_units');

    ctx.dispatch.tick(secondsLater(60));
    expect(ctx.repo.getRequest(req.id)!.status).toBe('searching');

    const fire = responder(ctx, 'FIRE-1', 'fire', north(CBD, 2));
    expect(ctx.repo.listOffers({ requestId: req.id, status: ['pending'] }).map((o) => o.responderId)).toEqual([fire.id]);

    ctx.dispatch.tick(secondsLater(21)); // offer expires
    ctx.dispatch.tick(secondsLater(301)); // search timeout with nothing pending
    expect(ctx.repo.getRequest(req.id)!.status).toBe('unfulfilled');

    // dispatcher assigns manually even though the unit ignored the offer
    const ops = dispatcher(ctx);
    const assigned = ctx.dispatch.assignManually(ops, req.id, fire.id);
    expect(assigned.status).toBe('assigned');
    expect(assigned.responderId).toBe(fire.id);
  });

  it('re-dispatches when a responder releases the job, excluding that responder', () => {
    const a = responder(ctx, 'MED-1', 'medical', north(CBD, 1));
    const b = responder(ctx, 'MED-2', 'medical', north(CBD, 5));
    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'medical', ...CBD, flags: ['unconscious'] });
    expect(req.priority).toBe('critical');
    const offerA = ctx.repo.listOffers({ requestId: req.id }).find((o) => o.responderId === a.id)!;
    ctx.dispatch.acceptOffer(a, offerA.id);
    ctx.dispatch.progress(a, req.id, 'en_route');

    const released = ctx.dispatch.releaseJob(a, req.id, 'vehicle breakdown');
    expect(released.status).toBe('searching');
    expect(released.responderId).toBeNull();
    expect(ctx.repo.getResponder(a.id)!.status).toBe('available');
    const pending = ctx.repo.listOffers({ requestId: req.id, status: ['pending'] });
    expect(pending.map((o) => o.responderId)).toEqual([b.id]);
  });

  it('completes the job, frees the unit, and records rating', () => {
    const a = responder(ctx, 'SEC-1', 'security', north(CBD, 1));
    const who = requester(ctx);
    const req = ctx.dispatch.createRequest(who, { service: 'security', ...CBD });
    ctx.dispatch.acceptOffer(a, ctx.repo.listOffers({ requestId: req.id })[0].id);
    ctx.dispatch.progress(a, req.id, 'en_route');
    // moving closer updates ETA and trail
    ctx.dispatch.updateResponderLocation(a, north(CBD, 0.2).lat, CBD.lng, 180);
    const tracked = ctx.dispatch.track(who, req.id);
    expect(tracked.distanceM).toBeLessThan(300);
    expect(tracked.etaSeconds).toBeLessThan(120);
    expect(tracked.trail).toHaveLength(1);

    ctx.dispatch.progress(a, req.id, 'arrived');
    expect(ctx.dispatch.track(who, req.id).etaSeconds).toBe(0);
    expect(() => ctx.dispatch.progress(a, req.id, 'en_route')).toThrow(/Cannot move/);
    const done = ctx.dispatch.progress(a, req.id, 'completed', 'Area secured');
    expect(done.status).toBe('completed');
    expect(ctx.repo.getResponder(a.id)!.status).toBe('available');
    expect(ctx.repo.getResponder(a.id)!.jobsCompleted).toBe(1);

    ctx.dispatch.rateRequest(who, req.id, 5, 'Fast!');
    expect(ctx.repo.getResponder(a.id)!.rating).toBe(5);
    expect(() => ctx.dispatch.rateRequest(who, req.id, 4)).toThrow(/Already rated/);
  });

  it('cancelling frees the responder; a busy unit cannot go offline', () => {
    const a = responder(ctx, 'SEC-1', 'security', north(CBD, 1));
    const who = requester(ctx);
    const req = ctx.dispatch.createRequest(who, { service: 'security', ...CBD });
    ctx.dispatch.acceptOffer(a, ctx.repo.listOffers({ requestId: req.id })[0].id);
    expect(() => ctx.dispatch.setResponderStatus(a, 'offline')).toThrow(/Finish or release/);
    const cancelled = ctx.dispatch.cancelRequest(who, req.id, 'false alarm');
    expect(cancelled.status).toBe('cancelled');
    expect(ctx.repo.getResponder(a.id)!.status).toBe('available');
    expect(ctx.dispatch.setResponderStatus(a, 'offline').status).toBe('offline');
  });

  it('prevents duplicate open requests of the same service per requester', () => {
    const who = requester(ctx);
    ctx.dispatch.createRequest(who, { service: 'security', ...CBD });
    expect(() => ctx.dispatch.createRequest(who, { service: 'security', ...CBD })).toThrow(/already have an open/);
    expect(ctx.dispatch.createRequest(who, { service: 'medical', ...CBD }).status).toBe('searching');
  });
});

describe('no_units bookkeeping', () => {
  it('records a single no_units event across repeated ticks', () => {
    const ctx = makeContext();
    const req = ctx.dispatch.createRequest(requester(ctx), { service: 'fire', ...CBD });
    for (let i = 1; i <= 5; i++) ctx.dispatch.tick(secondsLater(i));
    expect(ctx.repo.listEvents(req.id).filter((e) => e.type === 'no_units')).toHaveLength(1);
    ctx.db.close();
  });
});
