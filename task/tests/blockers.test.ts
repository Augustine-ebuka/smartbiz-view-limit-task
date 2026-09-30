/**
 * Blocker tests for "investor report links: optional view limit + accurate view counts".
 *
 * Run:  bash task/run_blockers.sh
 *
 * Uses an in-memory MongoDB (mongodb-memory-server) with the TTL monitor
 * disabled, so expired links are not swept away mid-test.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer;
let service: any;
let controller: any;
let Share: any;
let ownerId: string;

before(async () => {
  process.env.APP_ENV = 'test';
  process.env.REPORT_SHARE_HMAC_KEY = 'blocker-test-key';
  // EmailService builds its client at import time; no test sends email.
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_blocker_tests_offline';

  mongod = await MongoMemoryServer.create({
    instance: { args: ['--setParameter', 'ttlMonitorEnabled=false'] },
  });
  await mongoose.connect(mongod.getUri());

  // Required after the env is set: the service reads its HMAC key at load time.
  service = require('../../src/services/investorReportShareService').default;
  controller = require('../../src/controllers/investorReportShareController').default;
  Share = require('../../src/models/investorReportShare.model').InvestorReportShare;
  const { User } = require('../../src/models/user.model');

  const owner = await User.create({
    firstName: 'Ada',
    lastName: 'Obi',
    phone: '+2348000000001',
    email: 'owner@example.com',
    password: 'secret123',
    role: 'business_owner',
  });
  ownerId = String(owner._id);
});

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createLink(extra: Record<string, unknown> = {}) {
  const { token, share } = await service.createShare(ownerId, { rangeKey: 'this-month', ...extra });
  return { token: token as string, id: String(share._id) };
}

function viewConcurrently(token: string, n: number) {
  return Promise.allSettled(Array.from({ length: n }, () => service.getByToken(token)));
}

async function statusOfView(token: string): Promise<number> {
  try {
    await service.getByToken(token);
    return 200;
  } catch (err: any) {
    return err?.statusCode ?? 500;
  }
}

async function storedViewCount(id: string): Promise<number> {
  const doc = await Share.findById(id).lean();
  return doc.viewCount;
}

/** Drive the real controller with a minimal req/res, as Express would. */
function callCreate(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const next = (err: any) => resolve({ status: err?.statusCode ?? 500, body: err });
    controller.create({ businessOwnerId: ownerId, body } as any, res, next);
  });
}

// ─── Blockers ─────────────────────────────────────────────────────────────────

test('B1: maxViews holds under simultaneous views (20 requests, limit 3 -> exactly 3 succeed)', async () => {
  // Repeated so a check-then-increment race cannot pass by luck.
  for (let round = 1; round <= 5; round++) {
    const { token, id } = await createLink({ maxViews: 3 });
    const results = await viewConcurrently(token, 20);

    const served = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(served, 3, `round ${round}: report served ${served} times, expected 3`);

    for (const r of results) {
      if (r.status === 'rejected') {
        assert.equal((r.reason as any)?.statusCode, 410, `round ${round}: over-limit view should be 410`);
      }
    }
    assert.equal(await storedViewCount(id), 3, `round ${round}: viewCount should be 3`);
  }
});

test('B2: every successful view is counted exactly once under concurrency (no limit)', async () => {
  const { token, id } = await createLink();
  const results = await viewConcurrently(token, 25);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 25, 'unlimited link should serve all 25 views');
  assert.equal(await storedViewCount(id), 25, 'viewCount lost updates under concurrent views');

  const doc = await Share.findById(id).lean();
  assert.ok(doc.lastViewedAt instanceof Date, 'lastViewedAt should still be recorded');
});

test('B3: limit lifecycle, and unknown/revoked/expired links keep their responses and are not counted', async () => {
  // Limit reached -> 410, count frozen at the limit.
  const limited = await createLink({ maxViews: 2 });
  assert.equal(await statusOfView(limited.token), 200);
  assert.equal(await statusOfView(limited.token), 200);
  assert.equal(await statusOfView(limited.token), 410, 'third view of a 2-view link should be 410');
  assert.equal(await statusOfView(limited.token), 410);
  assert.equal(await storedViewCount(limited.id), 2);

  // Unknown token -> 404.
  assert.equal(await statusOfView('0'.repeat(64)), 404, 'unknown token should stay 404');

  // Revoked link with views left -> 410, not counted.
  const revoked = await createLink({ maxViews: 5 });
  assert.equal(await statusOfView(revoked.token), 200);
  await service.revoke(ownerId, revoked.id);
  assert.equal(await statusOfView(revoked.token), 410, 'revoked link should stay 410');
  assert.equal(await storedViewCount(revoked.id), 1, 'view of a revoked link must not be counted');

  // Expired link with views left -> 410, not counted.
  const expired = await createLink({ maxViews: 5 });
  await Share.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await statusOfView(expired.token), 410, 'expired link should stay 410');
  assert.equal(await storedViewCount(expired.id), 0, 'view of an expired link must not be counted');
});

test('B4: POST /reports/share validates maxViews (positive whole number, optional)', async () => {
  for (const bad of [0, -1, 2.5, 'abc', true]) {
    const res = await callCreate({ range: 'this-month', maxViews: bad });
    assert.equal(res.status, 400, `maxViews=${JSON.stringify(bad)} should be rejected with 400`);
  }
  const before = await Share.countDocuments();
  await callCreate({ range: 'this-month', maxViews: 0 });
  assert.equal(await Share.countDocuments(), before, 'a rejected request must not create a link');

  const ok = await callCreate({ range: 'this-month', maxViews: 5 });
  assert.equal(ok.status, 201);
  const token = String(ok.body.data.shareUrl).split('/').pop()!;
  const stored = await Share.findOne({}).sort({ createdAt: -1 }).lean();
  assert.equal(stored.maxViews, 5, 'maxViews should be stored on the link');
  assert.equal(await statusOfView(token), 200);

  // Omitted -> unlimited, as today.
  const unlimited = await callCreate({ range: 'this-month' });
  assert.equal(unlimited.status, 201);
  const unlimitedToken = String(unlimited.body.data.shareUrl).split('/').pop()!;
  for (let i = 0; i < 10; i++) {
    assert.equal(await statusOfView(unlimitedToken), 200, 'link without maxViews should be unlimited');
  }
});

test('B5: owner share list shows maxViews alongside viewCount', async () => {
  const { token, id } = await createLink({ maxViews: 4 });
  await service.getByToken(token);

  const list = await service.list(ownerId);
  const entry = list.find((s: any) => String(s._id) === id);
  assert.ok(entry, 'new link should appear in the owner list');
  assert.equal(entry.maxViews, 4);
  assert.equal(entry.viewCount, 1);
});
