import type { Config } from '../config.js';
import { etaSeconds, haversineM } from '../domain/geo.js';
import { addSeconds, newId, newReference, nowIso } from '../domain/ids.js';
import { ACTIVE_JOB_STATUSES, canTransition, InvalidTransitionError, isOpen } from '../domain/requestStateMachine.js';
import {
  priorityFor,
  type Offer,
  type Request,
  type RequestStatus,
  type Responder,
  type ResponderStatus,
  type Service,
  type User,
} from '../domain/types.js';
import { ConflictError, ForbiddenError, NotFoundError } from './errors.js';
import type { EventBus } from './eventBus.js';
import type { Repositories } from './repositories.js';

export interface CreateRequestInput {
  service: Service;
  lat: number;
  lng: number;
  address?: string | null;
  description?: string | null;
  flags?: string[];
}

/** A call-out created by an agent (phone call, radio, alarm signal) or by an integrated system. */
export interface CalloutInput extends CreateRequestInput {
  contactName: string;
  contactPhone: string;
  /** Send straight to this response officer instead of automatic matching. */
  responderId?: string | null;
  source: 'agent' | 'api';
  /** Agent user id or API key id. */
  createdBy: string;
}

export type MatchingConfig = Pick<
  Config,
  'OFFER_TIMEOUT_SECONDS' | 'OFFER_FANOUT' | 'MAX_RADIUS_KM' | 'SEARCH_TIMEOUT_SECONDS' | 'LOCATION_STALE_SECONDS' | 'AVERAGE_SPEED_KMH'
>;

type Logger = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };

/**
 * Uber-style matching and job lifecycle for security, medical and fire
 * responders. All timing is driven by `tick(now)` so it is deterministic in
 * tests; the server calls it every second.
 */
export class DispatchService {
  constructor(
    private readonly repo: Repositories,
    private readonly bus: EventBus,
    private readonly cfg: MatchingConfig,
    private readonly log: Logger = console,
  ) {}

  // ======================================================================
  // Requester side
  // ======================================================================

  createRequest(requester: User, input: CreateRequestInput): Request {
    const open = this.repo.listRequests({ requesterId: requester.id, status: ['searching', 'assigned', 'en_route', 'arrived'] });
    if (open.some((r) => r.service === input.service)) {
      throw new ConflictError(`You already have an open ${input.service} request (${open[0].reference})`);
    }
    const flags = (input.flags ?? []).slice(0, 10);
    const request = this.repo.insertRequest({
      id: newId(),
      reference: newReference(input.service),
      requesterId: requester.id,
      service: input.service,
      priority: priorityFor(input.service, flags),
      lat: input.lat,
      lng: input.lng,
      address: input.address?.trim() || null,
      description: input.description?.trim() || null,
      flags,
    });
    this.repo.addEvent({ requestId: request.id, type: 'created', actor: requester.id, note: request.description });
    this.repo.audit({ actor: requester.id, action: 'request.created', entityType: 'request', entityId: request.id, details: { service: request.service, priority: request.priority } });
    this.publishRequest('request.created', request);
    this.search(request.id);
    return this.repo.getRequest(request.id)!;
  }

  /**
   * Manual call-out: an agent (or an integrated system) logs an incident on
   * behalf of a caller and either sends it to a specific response officer or
   * lets matching find one. The caller gets a requester account keyed on their
   * phone number so they can open the app and track the unit.
   */
  createCallout(input: CalloutInput, resolveContact: (name: string, phone: string) => User): Request {
    const contact = resolveContact(input.contactName, input.contactPhone);
    const flags = (input.flags ?? []).slice(0, 10);
    const request = this.repo.insertRequest({
      id: newId(),
      reference: newReference(input.service),
      requesterId: contact.id,
      service: input.service,
      priority: priorityFor(input.service, flags),
      lat: input.lat,
      lng: input.lng,
      address: input.address?.trim() || null,
      description: input.description?.trim() || null,
      flags,
      source: input.source,
      createdBy: input.createdBy,
    });
    this.repo.addEvent({ requestId: request.id, type: 'created', actor: input.createdBy, note: `${input.source === 'agent' ? 'Manual call-out' : 'Integration call-out'} for ${contact.name}${request.description ? ` – ${request.description}` : ''}` });
    this.repo.audit({ actor: input.createdBy, action: 'request.callout', entityType: 'request', entityId: request.id, details: { service: request.service, source: input.source, responderId: input.responderId ?? null } });
    this.publishRequest('request.created', request);
    if (input.responderId) {
      const responder = this.mustGetResponder(input.responderId);
      if (responder.service !== request.service) throw new ConflictError(`${responder.unitName} is a ${responder.service} unit`);
      if (responder.status === 'busy') throw new ConflictError(`${responder.unitName} already has an active job`);
      const distanceM = responder.lat != null && responder.lng != null ? Math.round(haversineM({ lat: responder.lat, lng: responder.lng }, request)) : 0;
      const eta = etaSeconds(distanceM, this.cfg.AVERAGE_SPEED_KMH);
      const offer = this.repo.insertOffer({ requestId: request.id, responderId: responder.userId, distanceM, etaSeconds: eta, expiresAt: nowIso() });
      this.repo.setOfferStatus(offer.id, 'accepted');
      if (responder.status === 'offline') this.repo.setResponderStatus(responder.userId, 'available');
      // The officer sees it as an assigned job immediately (offer.created lets their app ring too).
      this.bus.publish('offer.created', { offer: this.repo.getOffer(offer.id), request }, { responderIds: [responder.userId] });
      return this.assign(request, this.repo.getResponder(responder.userId)!, eta, input.createdBy, 'sent_to_officer');
    }
    this.search(request.id);
    return this.repo.getRequest(request.id)!;
  }

  cancelRequest(actor: User, requestId: string, reason?: string | null): Request {
    const req = this.mustGet(requestId);
    if (actor.role === 'requester' && req.requesterId !== actor.id) throw new ForbiddenError();
    if (actor.role === 'responder') throw new ForbiddenError('Responders release a job instead of cancelling it');
    if (!canTransition(req.status, 'cancelled')) throw new InvalidTransitionError(req.status, 'cancelled');
    this.withdrawPendingOffers(req.id);
    if (req.responderId) this.freeResponder(req.responderId);
    const updated = this.repo.updateRequest(req.id, { status: 'cancelled', cancelledAt: nowIso(), cancelReason: reason ?? null })!;
    this.repo.addEvent({ requestId: req.id, type: 'cancelled', actor: actor.id, note: reason });
    this.repo.audit({ actor: actor.id, action: 'request.cancelled', entityType: 'request', entityId: req.id, details: { reason } });
    this.publishRequest('request.updated', updated);
    return updated;
  }

  rateRequest(requester: User, requestId: string, rating: number, comment?: string | null): Request {
    const req = this.mustGet(requestId);
    if (req.requesterId !== requester.id) throw new ForbiddenError();
    if (req.status !== 'completed') throw new ConflictError('Only completed requests can be rated');
    if (req.rating !== null) throw new ConflictError('Already rated');
    if (req.responderId) this.repo.addResponderRating(req.responderId, rating);
    const updated = this.repo.updateRequest(req.id, { rating, ratingComment: comment ?? null })!;
    this.repo.addEvent({ requestId: req.id, type: 'rated', actor: requester.id, note: `${rating}/5${comment ? ` – ${comment}` : ''}` });
    return updated;
  }

  /** What the person in trouble sees: status, who is coming, where they are, ETA. */
  track(user: User, requestId: string) {
    const req = this.mustGet(requestId);
    this.assertCanView(user, req);
    const responder = req.responderId ? this.repo.getResponder(req.responderId) ?? null : null;
    const distanceM = responder?.lat != null && responder.lng != null ? Math.round(haversineM({ lat: responder.lat, lng: responder.lng }, req)) : null;
    const live = distanceM !== null && ACTIVE_JOB_STATUSES.includes(req.status);
    return {
      request: req,
      responder: responder && {
        userId: responder.userId,
        name: responder.name,
        phone: responder.phone,
        unitName: responder.unitName,
        organisation: responder.organisation,
        vehicle: responder.vehicle,
        service: responder.service,
        rating: responder.rating,
        lat: responder.lat,
        lng: responder.lng,
        heading: responder.heading,
        locationAt: responder.locationAt,
      },
      distanceM,
      etaSeconds: live ? (req.status === 'arrived' ? 0 : etaSeconds(distanceM, this.cfg.AVERAGE_SPEED_KMH)) : req.etaSeconds,
      offersOutstanding: req.status === 'searching' ? this.repo.listOffers({ requestId: req.id, status: ['pending'] }).length : 0,
      offersDeclined: req.status === 'searching' ? this.repo.listOffers({ requestId: req.id, status: ['declined', 'expired'] }).length : 0,
      events: this.repo.listEvents(req.id),
      trail: live ? this.repo.listTrail(req.id) : [],
    };
  }

  listMine(user: User, limit = 20): Request[] {
    return this.repo.listRequests({ requesterId: user.id, limit });
  }

  // ======================================================================
  // Responder side
  // ======================================================================

  setResponderStatus(responderUser: User, status: ResponderStatus): Responder {
    const r = this.mustGetResponder(responderUser.id);
    if (r.status === 'busy' && status !== 'busy') {
      const job = this.activeJobFor(r.userId);
      if (job) throw new ConflictError(`Finish or release job ${job.reference} before going ${status}`);
    }
    if (status === 'busy') throw new ConflictError('Busy is set automatically when you accept a job');
    if (status === 'offline') {
      for (const o of this.repo.listOffers({ responderId: r.userId, status: ['pending'] })) {
        this.repo.setOfferStatus(o.id, 'withdrawn');
        this.search(o.requestId);
      }
    }
    const updated = this.repo.setResponderStatus(r.userId, status)!;
    this.repo.audit({ actor: r.userId, action: `responder.${status}`, entityType: 'responder', entityId: r.userId });
    this.bus.publish('responder.updated', updated, { responderIds: [r.userId] });
    // A unit coming online may be exactly what a waiting request needs.
    if (status === 'available') this.rescanSearching();
    return updated;
  }

  updateResponderLocation(responderUser: User, lat: number, lng: number, heading: number | null): Responder {
    const r = this.mustGetResponder(responderUser.id);
    const hadLocation = r.lat != null && r.lng != null;
    const updated = this.repo.setResponderLocation(r.userId, lat, lng, heading)!;
    const job = this.activeJobFor(r.userId);
    if (job) {
      const distanceM = Math.round(haversineM({ lat, lng }, job));
      const eta = job.status === 'arrived' ? 0 : etaSeconds(distanceM, this.cfg.AVERAGE_SPEED_KMH);
      this.repo.updateRequest(job.id, { etaSeconds: eta });
      this.repo.addLocationPoint(job.id, r.userId, lat, lng);
      this.bus.publish(
        'responder.location',
        { requestId: job.id, responderId: r.userId, lat, lng, heading, distanceM, etaSeconds: eta, at: updated.locationAt },
        { requesterId: job.requesterId, responderIds: [r.userId] },
      );
    } else {
      this.bus.publish('responder.location', { responderId: r.userId, lat, lng, heading, at: updated.locationAt }, {});
      // An available unit that just became locatable (or moved) may now be in range of a waiting request.
      if (updated.status === 'available' && (!hadLocation || this.repo.listRequests({ status: ['searching'], limit: 1 }).length)) {
        this.rescanSearching();
      }
    }
    return updated;
  }

  pendingOffersFor(responderUser: User) {
    return this.repo
      .listOffers({ responderId: responderUser.id, status: ['pending'] })
      .map((o) => ({ offer: o, request: this.repo.getRequest(o.requestId)! }))
      .filter((x) => x.request && x.request.status === 'searching');
  }

  activeJobFor(responderId: string): Request | undefined {
    return this.repo.listRequests({ responderId, status: [...ACTIVE_JOB_STATUSES], limit: 1 })[0];
  }

  acceptOffer(responderUser: User, offerId: string): Request {
    const offer = this.repo.getOffer(offerId);
    if (!offer || offer.responderId !== responderUser.id) throw new NotFoundError('Offer');
    if (offer.status !== 'pending') throw new ConflictError(`Offer is ${offer.status}`);
    const req = this.mustGet(offer.requestId);
    if (req.status !== 'searching') {
      this.repo.setOfferStatus(offer.id, 'withdrawn');
      throw new ConflictError('This job has already been taken');
    }
    const responder = this.mustGetResponder(responderUser.id);
    if (responder.status === 'busy') throw new ConflictError('You already have an active job');
    if (responder.status === 'offline') throw new ConflictError('Go online before accepting jobs');
    this.repo.setOfferStatus(offer.id, 'accepted');
    return this.assign(req, responder, offer.etaSeconds, responderUser.id, 'accepted');
  }

  declineOffer(responderUser: User, offerId: string): void {
    const offer = this.repo.getOffer(offerId);
    if (!offer || offer.responderId !== responderUser.id) throw new NotFoundError('Offer');
    if (offer.status !== 'pending') return;
    this.repo.setOfferStatus(offer.id, 'declined');
    this.bus.publish('offer.updated', this.repo.getOffer(offer.id), { responderIds: [offer.responderId] });
    this.repo.addEvent({ requestId: offer.requestId, type: 'offer_declined', actor: responderUser.id });
    this.search(offer.requestId);
  }

  /** Responder progress: en_route -> arrived -> completed. */
  progress(responderUser: User, requestId: string, to: Extract<RequestStatus, 'en_route' | 'arrived' | 'completed'>, note?: string | null): Request {
    const req = this.mustGet(requestId);
    if (req.responderId !== responderUser.id) throw new ForbiddenError('This is not your job');
    if (!canTransition(req.status, to)) throw new InvalidTransitionError(req.status, to);
    const t = nowIso();
    const patch: Parameters<Repositories['updateRequest']>[1] = { status: to };
    if (to === 'en_route') patch.enRouteAt = t;
    if (to === 'arrived') {
      patch.arrivedAt = t;
      patch.etaSeconds = 0;
    }
    if (to === 'completed') {
      patch.completedAt = t;
      this.freeResponder(req.responderId);
      this.repo.incrementJobs(req.responderId);
    }
    const updated = this.repo.updateRequest(req.id, patch)!;
    this.repo.addEvent({ requestId: req.id, type: to, actor: responderUser.id, note });
    this.repo.audit({ actor: responderUser.id, action: `request.${to}`, entityType: 'request', entityId: req.id });
    this.publishRequest('request.updated', updated);
    return updated;
  }

  /** Responder cannot continue (breakdown, redirected). Job goes back to search. */
  releaseJob(responderUser: User, requestId: string, reason?: string | null): Request {
    const req = this.mustGet(requestId);
    if (req.responderId !== responderUser.id) throw new ForbiddenError('This is not your job');
    if (!canTransition(req.status, 'searching')) throw new InvalidTransitionError(req.status, 'searching');
    this.freeResponder(req.responderId);
    const updated = this.repo.updateRequest(req.id, {
      status: 'searching',
      responderId: null,
      etaSeconds: null,
      assignedAt: null,
      enRouteAt: null,
      searchStartedAt: nowIso(),
    })!;
    this.repo.addEvent({ requestId: req.id, type: 'released', actor: responderUser.id, note: reason });
    this.repo.audit({ actor: responderUser.id, action: 'request.released', entityType: 'request', entityId: req.id, details: { reason } });
    this.publishRequest('request.updated', updated);
    this.search(req.id);
    return this.repo.getRequest(req.id)!;
  }

  // ======================================================================
  // Dispatcher side
  // ======================================================================

  assignManually(dispatcher: User, requestId: string, responderId: string): Request {
    const req = this.mustGet(requestId);
    if (req.status !== 'searching' && req.status !== 'unfulfilled') {
      throw new ConflictError(`Request is ${req.status}; only searching or unfulfilled requests can be assigned`);
    }
    const responder = this.mustGetResponder(responderId);
    if (responder.status === 'busy') throw new ConflictError(`${responder.unitName} already has an active job`);
    if (responder.service !== req.service) throw new ConflictError(`${responder.unitName} is a ${responder.service} unit`);
    const distanceM = responder.lat != null && responder.lng != null ? Math.round(haversineM({ lat: responder.lat, lng: responder.lng }, req)) : 0;
    const eta = etaSeconds(distanceM, this.cfg.AVERAGE_SPEED_KMH);
    if (req.status === 'unfulfilled') this.repo.updateRequest(req.id, { status: 'searching' });
    const offer = this.repo.insertOffer({ requestId: req.id, responderId, distanceM, etaSeconds: eta, expiresAt: nowIso() });
    this.repo.setOfferStatus(offer.id, 'accepted');
    if (responder.status === 'offline') this.repo.setResponderStatus(responderId, 'available');
    return this.assign(this.repo.getRequest(req.id)!, this.repo.getResponder(responderId)!, eta, dispatcher.id, 'assigned_manually');
  }

  retrySearch(dispatcher: User, requestId: string): Request {
    const req = this.mustGet(requestId);
    if (!canTransition(req.status, 'searching')) throw new InvalidTransitionError(req.status, 'searching');
    const updated = this.repo.updateRequest(req.id, { status: 'searching', searchStartedAt: nowIso() })!;
    this.repo.addEvent({ requestId: req.id, type: 'search_retried', actor: dispatcher.id });
    this.publishRequest('request.updated', updated);
    this.search(req.id);
    return this.repo.getRequest(req.id)!;
  }

  detail(user: User, requestId: string) {
    const req = this.mustGet(requestId);
    this.assertCanView(user, req);
    const responder = req.responderId ? this.repo.getResponder(req.responderId) ?? null : null;
    const offers = user.role === 'dispatcher' ? this.repo.listOffers({ requestId: req.id }).map((o) => ({ ...o, responder: this.repo.getResponder(o.responderId) })) : undefined;
    return { request: req, responder, events: this.repo.listEvents(req.id), offers, trail: this.repo.listTrail(req.id) };
  }

  // ======================================================================
  // Matching engine
  // ======================================================================

  /**
   * Offer the request to the nearest eligible responders that have not been
   * asked yet, keeping at most OFFER_FANOUT offers outstanding.
   */
  search(requestId: string): Offer[] {
    const req = this.repo.getRequest(requestId);
    if (!req || req.status !== 'searching') return [];
    const pending = this.repo.listOffers({ requestId, status: ['pending'] });
    const slots = this.cfg.OFFER_FANOUT - pending.length;
    if (slots <= 0) return [];

    // Units that were asked and did not take it (or already hold/held it) are not asked again;
    // a withdrawn offer (someone else accepted first) does not count against a unit.
    const asked = new Set(
      this.repo
        .listOffers({ requestId, status: ['pending', 'declined', 'expired', 'accepted'] })
        .map((o) => o.responderId),
    );
    const staleBefore = Date.now() - this.cfg.LOCATION_STALE_SECONDS * 1000;
    const candidates = this.repo
      .listResponders({ service: req.service, status: ['available'] })
      .filter((r) => !asked.has(r.userId) && r.lat != null && r.lng != null && r.locationAt && new Date(r.locationAt).getTime() >= staleBefore)
      .map((r) => ({ r, distanceM: Math.round(haversineM(r as { lat: number; lng: number }, req)) }))
      .filter((c) => c.distanceM <= this.cfg.MAX_RADIUS_KM * 1000)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, slots);

    const created: Offer[] = [];
    for (const c of candidates) {
      const offer = this.repo.insertOffer({
        requestId,
        responderId: c.r.userId,
        distanceM: c.distanceM,
        etaSeconds: etaSeconds(c.distanceM, this.cfg.AVERAGE_SPEED_KMH),
        expiresAt: addSeconds(nowIso(), this.cfg.OFFER_TIMEOUT_SECONDS),
      });
      created.push(offer);
      this.repo.addEvent({ requestId, type: 'offered', actor: 'system', note: `${c.r.unitName} (${(c.distanceM / 1000).toFixed(1)} km)` });
      this.bus.publish('offer.created', { offer, request: req }, { responderIds: [c.r.userId] });
    }
    if (created.length) this.log.info({ requestId, offers: created.length }, 'offers sent');
    if (created.length === 0 && pending.length === 0) {
      // Record once per dry spell, not on every tick.
      const events = this.repo.listEvents(requestId);
      if (events[events.length - 1]?.type !== 'no_units') {
        this.repo.addEvent({ requestId, type: 'no_units', actor: 'system', note: 'No available units in range; still searching' });
        this.publishRequest('request.updated', this.repo.getRequest(requestId)!);
      }
    }
    return created;
  }

  /** Called every second by the server (and directly by tests). */
  tick(now: Date = new Date()): void {
    const nowStr = now.toISOString();
    const touched = new Set<string>();
    for (const o of this.repo.listExpiredPendingOffers(nowStr)) {
      this.repo.setOfferStatus(o.id, 'expired');
      this.repo.addEvent({ requestId: o.requestId, type: 'offer_expired', actor: 'system' });
      this.bus.publish('offer.updated', this.repo.getOffer(o.id), { responderIds: [o.responderId] });
      touched.add(o.requestId);
    }
    for (const req of this.repo.listRequests({ status: ['searching'], limit: 500 })) {
      const waitedS = (now.getTime() - new Date(req.searchStartedAt).getTime()) / 1000;
      const pending = this.repo.listOffers({ requestId: req.id, status: ['pending'] }).length;
      if (waitedS >= this.cfg.SEARCH_TIMEOUT_SECONDS && pending === 0) {
        this.withdrawPendingOffers(req.id);
        const updated = this.repo.updateRequest(req.id, { status: 'unfulfilled' })!;
        this.repo.addEvent({ requestId: req.id, type: 'unfulfilled', actor: 'system', note: 'No unit accepted in time; dispatcher attention needed' });
        this.repo.audit({ actor: 'system', action: 'request.unfulfilled', entityType: 'request', entityId: req.id });
        this.publishRequest('request.updated', updated);
        this.log.warn({ requestId: req.id, reference: req.reference }, 'request unfulfilled');
        continue;
      }
      if (touched.has(req.id) || pending < this.cfg.OFFER_FANOUT) this.search(req.id);
    }
  }

  private rescanSearching() {
    for (const req of this.repo.listRequests({ status: ['searching'], limit: 500 })) this.search(req.id);
  }

  // ======================================================================
  // internals
  // ======================================================================

  private assign(req: Request, responder: Responder, eta: number, actor: string, eventType: string): Request {
    const t = nowIso();
    this.withdrawPendingOffers(req.id);
    this.repo.setResponderStatus(responder.userId, 'busy');
    const updated = this.repo.updateRequest(req.id, { status: 'assigned', responderId: responder.userId, etaSeconds: eta, assignedAt: t })!;
    this.repo.addEvent({ requestId: req.id, type: eventType, actor, note: `${responder.unitName} · ETA ${Math.round(eta / 60)} min` });
    this.repo.audit({ actor, action: 'request.assigned', entityType: 'request', entityId: req.id, details: { responderId: responder.userId, eta } });
    this.bus.publish('responder.updated', this.repo.getResponder(responder.userId), { responderIds: [responder.userId] });
    this.publishRequest('request.updated', updated);
    return updated;
  }

  private withdrawPendingOffers(requestId: string) {
    for (const o of this.repo.listOffers({ requestId, status: ['pending'] })) {
      this.repo.setOfferStatus(o.id, 'withdrawn');
      this.bus.publish('offer.updated', this.repo.getOffer(o.id), { responderIds: [o.responderId] });
    }
  }

  private freeResponder(responderId: string) {
    const r = this.repo.getResponder(responderId);
    if (r && r.status === 'busy') {
      this.repo.setResponderStatus(responderId, 'available');
      this.bus.publish('responder.updated', this.repo.getResponder(responderId), { responderIds: [responderId] });
    }
  }

  private publishRequest(type: 'request.created' | 'request.updated', req: Request) {
    this.bus.publish(type, req, { requesterId: req.requesterId, responderIds: req.responderId ? [req.responderId] : [] });
  }

  private mustGet(id: string): Request {
    const r = this.repo.getRequest(id);
    if (!r) throw new NotFoundError('Request');
    return r;
  }
  private mustGetResponder(userId: string): Responder {
    const r = this.repo.getResponder(userId);
    if (!r) throw new NotFoundError('Responder profile');
    return r;
  }
  private assertCanView(user: User, req: Request) {
    if (user.role === 'dispatcher') return;
    if (user.role === 'requester' && req.requesterId === user.id) return;
    if (user.role === 'responder') {
      if (req.responderId === user.id) return;
      if (isOpen(req.status) && this.repo.listOffers({ requestId: req.id, responderId: user.id }).length) return;
    }
    throw new ForbiddenError();
  }
}
