// The invisible animal's ground truth: position, heading, speed, behaviour state, gait phase.
// Everything the player can perceive (prints, bent grass, ripples, sounds, shaking shrubs)
// is derived from the events this module emits — nothing else knows where the animal is.
import {
  EntityManager, Vehicle, GameEntity, Vector3, SteeringBehavior,
  WanderBehavior, ObstacleAvoidanceBehavior, ArriveBehavior, FleeBehavior,
  StateMachine, State, Graph, NavNode, NavEdge, AStar, Path, FollowPathBehavior, OnPathBehavior,
} from 'yuka';
import { STRIDE, LEGS, footfallsBetween, footWorld, localToWorld } from './gait.js';
import { hearingRadius } from './rules.js';

export const ST = {
  WANDER: 'wander', GRAZE: 'graze', DRINK: 'drink', ALERT: 'alert', FLEE: 'flee',
  // v0.2 trail life: travel along game trails between places it uses, then do something there
  TRAVEL: 'travel', REST: 'rest', FEED: 'feed', RUB: 'rub', BROWSE: 'browse', SIP: 'sip',
};
const SPEED = { wander: 0.75, drink: 0.6, flee: 3.0, travel: 0.7 };
/** How long each activity lasts (s) and how often it leaves an event behind. */
const ACT = {
  rest: { dur: [25, 45], every: 0 },
  feed: { dur: [8, 14], every: 2.4, event: 'feed' },
  rub: { dur: [5, 8], every: 1.1, event: 'rub' },
  browse: { dur: [6, 10], every: 2.0, event: 'browse' },
  sip: { dur: [5, 8], every: 0 }, // drinking reuses the sip events in update()
};

/** Soft square fence: steer back toward the centre once outside `limit`. */
class StayInBounds extends SteeringBehavior {
  constructor(limit) { super(); this.limit = limit; this._d = new Vector3(); }
  calculate(vehicle, force) {
    const p = vehicle.position, L = this.limit;
    const ox = Math.abs(p.x) > L ? -Math.sign(p.x) * (Math.abs(p.x) - L + 0.5) : 0;
    const oz = Math.abs(p.z) > L ? -Math.sign(p.z) * (Math.abs(p.z) - L + 0.5) : 0;
    if (ox || oz) {
      this._d.set(ox, 0, oz).normalize().multiplyScalar(vehicle.maxSpeed);
      force.copy(this._d).sub(vehicle.velocity);
    }
    return force;
  }
}

class WanderState extends State {
  enter(a) { a.setMode('wander'); a.timer = a.graph ? a.rand(5, 10) : a.rand(8, 16); }
  execute(a) {
    if (a.timer > 0) return;
    if (a.graph) { a.chooseNextPlace(); a.fsm.changeTo(ST.TRAVEL); return; }
    a.fsm.changeTo(a.thirst >= 1 && a.puddles.length ? ST.DRINK : ST.GRAZE);
  }
}
/** Walk the trail network (Yuka A* over the trail graph) to the chosen place. */
class TravelState extends State {
  enter(a) { a.planRoute(a.goal); a.setMode('travel'); a.timer = 120; }
  execute(a) {
    const g = a.goal;
    if (a.path.finished() && Math.hypot(g.x - a.x, g.z - a.z) < 0.45) { a.fsm.changeTo(g.kind); return; }
    if (a.timer <= 0) a.fsm.changeTo(ST.WANDER);
  }
}
/** Doing something at a place: lying in the bed, eating nuts, rubbing a trunk, browsing, drinking. */
class ActivityState extends State {
  constructor(kind) { super(); this.kind = kind; }
  enter(a) {
    const c = ACT[this.kind];
    a.setMode('stop'); a.timer = a.rand(...c.dur); a.actTimer = c.every * 0.5;
    a.faceTarget = a.goal?.face ?? null;
    if (this.kind === ST.SIP) { a.drinking = true; a.sipTimer = 0.4; }
  }
  execute(a) {
    const c = ACT[this.kind];
    if (c.every && (a.actTimer -= a.lastDt) <= 0) {
      a.actTimer = c.every * a.rand(0.8, 1.2);
      const m = localToWorld(0, 0.8, a.x, a.z, a.heading);
      a.pending.push({ type: c.event, x: m.x, z: m.z, t: a.time });
    }
    if (a.timer <= 0) {
      if (this.kind === ST.REST) a.fatigue = 0;
      if (this.kind === ST.SIP) a.thirst = 0;
      if (this.kind === ST.FEED || this.kind === ST.BROWSE) a.hunger = Math.max(0, a.hunger - 0.8);
      a.lastPlace = this.kind; a.fsm.changeTo(ST.WANDER);
    }
  }
  exit(a) { a.faceTarget = null; a.drinking = false; }
}
class GrazeState extends State {
  enter(a) { a.setMode('stop'); a.timer = a.rand(5, 9); }
  execute(a) { if (a.timer <= 0) a.fsm.changeTo(ST.WANDER); }
}
class DrinkState extends State {
  enter(a) {
    a.setMode('drink'); a.drinking = false; a.timer = 25; // give up if it can't reach water
    let best = null, bd = Infinity;
    for (const p of a.puddles) {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < bd) { bd = d; best = p; }
    }
    a.drinkPuddle = best;
    const dx = a.x - best.x, dz = a.z - best.z, l = Math.hypot(dx, dz) || 1;
    const edge = Math.max(0.2, best.r - 0.5);
    a.arriveTarget.set(best.x + (dx / l) * edge, 0, best.z + (dz / l) * edge);
  }
  execute(a) {
    if (!a.drinking && Math.hypot(a.arriveTarget.x - a.x, a.arriveTarget.z - a.z) < 0.35) {
      a.drinking = true; a.setMode('stop'); a.timer = a.rand(5, 8); a.sipTimer = 0.3;
      a.faceTarget = Math.atan2(a.drinkPuddle.x - a.x, a.drinkPuddle.z - a.z);
    }
    if (a.timer <= 0) { a.thirst = 0; a.fsm.changeTo(ST.WANDER); }
  }
  exit(a) { a.drinking = false; a.faceTarget = null; }
}
class AlertState extends State {
  enter(a) { a.setMode('stop'); a.timer = a.rand(2.0, 3.2); }
  execute(a) {
    a.faceTarget = Math.atan2(a.player.x - a.x, a.player.z - a.z);
    if (a.timer > 0) return;
    const d = a.playerDist();
    a.fsm.changeTo(d < hearingRadius(a.player.mode) * 0.9 || d < 5 ? ST.FLEE : ST.WANDER);
  }
  exit(a) { a.faceTarget = null; }
}
class FleeState extends State {
  enter(a) { a.setMode('flee'); a.timer = a.rand(4, 6); }
  execute(a) {
    a.fleeTarget.set(a.player.x, 0, a.player.z);
    if (a.timer <= 0) a.fsm.changeTo(ST.WANDER);
  }
}

export class AnimalTruth {
  /**
   * @param {object} o
   * @param {() => number} [o.rng] uniform [0,1)
   * @param {{x:number,z:number,r:number}[]} [o.obstacles] solid circles (tree trunks, rocks)
   * @param {{x:number,z:number,r:number}[]} [o.puddles]
   * @param {(x:number,z:number)=>number} [o.heightAt]
   * @param {{x:number,z:number}} [o.spawn]
   */
  constructor(o = {}) {
    this.rng = o.rng ?? Math.random;
    this.obstacles = o.obstacles ?? [];
    this.puddles = o.puddles ?? [];
    this.heightAt = o.heightAt ?? (() => 0);
    this.bounds = o.bounds ?? 13;
    this.time = 0; this.timer = 0; this.thirst = this.rand(0.4, 0.9);
    this.phase = 0; this.heading = this.rand(0, Math.PI * 2);
    this.player = { x: 0, z: -100, mode: 'still' };
    this.faceTarget = null; this.drinking = false; this.sipTimer = 0;
    this.limit = o.limit ?? 14.3; // hard clamp (v0.1 map is ±15 m)
    this.hunger = this.rand(0.2, 0.8); this.fatigue = this.rand(0.3, 0.9);
    this.pending = []; this.lastDt = 0; this.goal = null; this.lastPlace = null;

    const em = this.em = new EntityManager();
    const v = this.vehicle = new Vehicle();
    v.boundingRadius = 0.45; v.mass = 1; v.maxForce = 2.5; v.maxSpeed = SPEED.wander;
    // Wander and ObstacleAvoidance work in the vehicle's local frame → keep Yuka's orientation on
    v.updateOrientation = true;
    const s = o.spawn ?? { x: 0, z: 0 };
    v.position.set(s.x, 0, s.z);
    em.add(v);
    this.obstacleEntities = this.obstacles.map(ob => {
      const e = new GameEntity(); e.position.set(ob.x, 0, ob.z); e.boundingRadius = ob.r; return e;
    });
    this.arriveTarget = new Vector3(); this.fleeTarget = new Vector3();
    this.b = {
      wander: new WanderBehavior(1.2, 2.5, 3.5),
      avoid: new ObstacleAvoidanceBehavior(this.obstacleEntities),
      bounds: new StayInBounds(this.bounds),
      arrive: new ArriveBehavior(this.arriveTarget, 2.5, 0.05),
      flee: new FleeBehavior(this.fleeTarget, 20),
    };
    this.b.avoid.weight = 3; this.b.avoid.dBoxMinLength = 2.5; this.b.bounds.weight = 2;
    // v0.2: trail graph → Yuka Graph + AStar → Path for FollowPath/OnPath (keeps to the game trail)
    this.graph = null; this.path = new Path();
    this.places = o.pois ?? [];
    if (o.trails?.length) {
      const g = this.graph = new Graph();
      this.trailIds = o.trails.map(t => t.id);
      o.trails.forEach((t, i) => g.addNode(new NavNode(i, new Vector3(t.x, 0, t.z), { id: t.id })));
      o.trails.forEach((t, i) => t.links.forEach(l => {
        const j = this.trailIds.indexOf(l);
        if (j > i) g.addEdge(new NavEdge(i, j, Math.hypot(o.trails[j].x - t.x, o.trails[j].z - t.z)));
      }));
      this.b.follow = new FollowPathBehavior(this.path, 0.8);
      this.b.onPath = new OnPathBehavior(this.path, 0.35, 1);
      this.b.onPath.weight = 0.6;
    }
    for (const k in this.b) v.steering.add(this.b[k]);

    this.fsm = new StateMachine(this);
    this.fsm.add(ST.WANDER, new WanderState()); this.fsm.add(ST.GRAZE, new GrazeState());
    this.fsm.add(ST.DRINK, new DrinkState()); this.fsm.add(ST.ALERT, new AlertState());
    this.fsm.add(ST.FLEE, new FleeState());
    this.fsm.add(ST.TRAVEL, new TravelState());
    for (const k of [ST.REST, ST.FEED, ST.RUB, ST.BROWSE, ST.SIP]) this.fsm.add(k, new ActivityState(k));
    this.fsm.changeTo(ST.WANDER);
  }

  rand(a, b) { return a + (b - a) * this.rng(); }
  get x() { return this.vehicle.position.x; }
  get z() { return this.vehicle.position.z; }
  get y() { return this.heightAt(this.x, this.z); }
  get speed() { return Math.hypot(this.vehicle.velocity.x, this.vehicle.velocity.z); }
  get state() {
    for (const [id, st] of this.fsm.states) if (st === this.fsm.currentState) return id;
    return null;
  }
  playerDist() { return Math.hypot(this.player.x - this.x, this.player.z - this.z); }

  setMode(mode) {
    const b = this.b, v = this.vehicle;
    for (const k in b) b[k].active = false;
    this.mode = mode;
    if (mode === 'stop') return;
    b.avoid.active = b.bounds.active = true;
    if (mode === 'wander') { b.wander.active = true; v.maxSpeed = SPEED.wander; v.maxForce = 2.5; }
    if (mode === 'drink') { b.arrive.active = true; v.maxSpeed = SPEED.drink; v.maxForce = 2.5; }
    if (mode === 'flee') { b.flee.active = true; v.maxSpeed = SPEED.flee; v.maxForce = 8; }
    if (mode === 'travel') { b.follow.active = b.onPath.active = true; v.maxSpeed = SPEED.travel; v.maxForce = 2.5; }
  }

  /** Pick the next place by need (thirst → water, fatigue → bed, hunger → food) plus whim. */
  chooseNextPlace() {
    const need = { sip: this.thirst, rest: this.fatigue, feed: this.hunger * 0.7, browse: this.hunger * 0.6, rub: 0.3 };
    let best = null, bs = -1;
    for (const p of this.places) {
      if (p.kind === this.lastPlace) continue;
      const s = (need[p.kind] ?? 0.2) + this.rand(0, 0.5);
      if (s > bs) { bs = s; best = p; }
    }
    this.goal = best;
  }
  nearestNode(x, z) {
    let bi = 0, bd = Infinity;
    for (const n of this.graph.getNodes([])) {
      const d = Math.hypot(n.position.x - x, n.position.z - z);
      if (d < bd) { bd = d; bi = n.index; }
    }
    return bi;
  }
  /** A* from the nearest trail node to the goal's node, then on to the spot itself. */
  planRoute(goal) {
    const from = this.nearestNode(this.x, this.z), to = this.trailIds.indexOf(goal.node);
    const astar = new AStar(this.graph, from, to); astar.search();
    const ids = astar.found ? astar.getPath() : [from];
    this.path.clear();
    for (const i of ids) { const n = this.graph.getNode(i); this.path.add(new Vector3(n.position.x, 0, n.position.z)); }
    this.path.add(new Vector3(goal.x, 0, goal.z));
    this.route = ids.map(i => this.trailIds[i]);
  }

  /** Test hook: walk straight-ish to (x, z) at `speed`, ignoring the FSM until release(). */
  scriptMoveTo(x, z, speed = 0.75) {
    this.scripted = true; this.setMode('drink'); this.vehicle.maxSpeed = speed;
    this.b.avoid.active = false; // scripted paths are chosen clear of obstacles
    this.arriveTarget.set(x, 0, z);
  }
  scriptStop() { this.scripted = true; this.setMode('stop'); }
  release() { this.scripted = false; this.fsm.changeTo(ST.WANDER); }

  /** Teleport (tests / debug). */
  place(x, z, heading = this.heading) {
    this.vehicle.position.set(x, 0, z); this.vehicle.velocity.set(0, 0, 0); this.heading = heading;
  }

  /**
   * Advance the truth by dt seconds. `player` = {x, z, mode: still|crouch|walk|sprint}.
   * Returns the list of truth events produced during this step.
   */
  update(dt, player) {
    const events = [];
    if (player) this.player = player;
    this.time += dt; this.timer -= dt; this.thirst += dt / 70; this.lastDt = dt;
    this.hunger += dt / 90; this.fatigue += dt / 200;
    const prevState = this.state;

    // perception → state (skipped while a test script drives the animal)
    if (!this.scripted) {
      const d = this.playerDist(), st = this.state;
      if (st !== ST.FLEE && d < 3.0) this.fsm.changeTo(ST.FLEE);
      else if (st !== ST.FLEE && st !== ST.ALERT && d < hearingRadius(this.player.mode)) this.fsm.changeTo(ST.ALERT);
      this.fsm.update();
    }

    const v = this.vehicle;
    if (this.mode === 'stop') v.velocity.multiplyScalar(Math.max(0, 1 - 6 * dt));
    const x0 = v.position.x, z0 = v.position.z;
    this.em.update(dt);
    v.position.y = 0; v.velocity.y = 0;

    // hard constraints: never inside a trunk/rock, never off the map
    for (const ob of this.obstacles) {
      const dx = v.position.x - ob.x, dz = v.position.z - ob.z, dd = Math.hypot(dx, dz), min = ob.r + 0.25;
      if (dd < min && dd > 1e-6) { v.position.x = ob.x + dx / dd * min; v.position.z = ob.z + dz / dd * min; }
    }
    v.position.x = Math.max(-this.limit, Math.min(this.limit, v.position.x));
    v.position.z = Math.max(-this.limit, Math.min(this.limit, v.position.z));

    // heading follows velocity (or a face target while standing)
    const spd = this.speed;
    let target = null;
    if (spd > 0.08) target = Math.atan2(v.velocity.x, v.velocity.z);
    else if (this.faceTarget != null) target = this.faceTarget;
    if (target != null) {
      let delta = ((target - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.heading += delta * Math.min(1, dt * (spd > 1.5 ? 10 : 5));
    }

    // gait: phase advances with ground distance covered; touchdowns are the footfall events
    const moved = Math.hypot(v.position.x - x0, v.position.z - z0);
    const p0 = this.phase;
    this.phase += moved / STRIDE;
    for (const leg of footfallsBetween(p0, this.phase)) {
      const f = footWorld(leg, this.x, this.z, this.heading);
      events.push({ type: 'footfall', leg: leg.id, x: f.x, z: f.z, heading: this.heading, speed: spd, t: this.time });
    }

    if (this.drinking) {
      this.sipTimer -= dt;
      if (this.sipTimer <= 0) {
        this.sipTimer = this.rand(0.6, 1.1);
        const m = localToWorld(0, 0.82, this.x, this.z, this.heading);
        events.push({ type: 'sip', x: m.x, z: m.z, t: this.time });
      }
    }
    if (this.pending.length) { events.push(...this.pending); this.pending.length = 0; }
    const now = this.state;
    if (now !== prevState) events.push({ type: 'state', from: prevState, to: now, t: this.time });
    return events;
  }

  /** Where the four hooves rest right now (used for grass held down under a standing animal). */
  standingFeet() {
    return LEGS.map(l => localToWorld(l.x, l.z > 0.3 ? 0.33 : -0.33, this.x, this.z, this.heading));
  }

  snapshot() {
    return { x: this.x, z: this.z, heading: this.heading, speed: this.speed, state: this.state, phase: this.phase, t: this.time };
  }
}
