import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIncome, applyIncome, resolveFood,
  BASE_INCOME, UPKEEP_BASE, HOLDING_YIELDS,
} from './economy';

function realmWith(over: any = {}): any {
  return {
    policies: { tax: 'normal' },
    holdings: [],
    army: { strength: 0 },
    resources: { treasury: 100, food: { stock: 80, production: 30, consumption: 26 }, manpower: 0 },
    ...over,
  };
}

// --- computeIncome ---

test('computeIncome: bare realm earns base income minus base upkeep', () => {
  const inc = computeIncome(realmWith());
  assert.equal(inc.gross, BASE_INCOME);
  assert.equal(inc.upkeep, UPKEEP_BASE);
  assert.equal(inc.net, BASE_INCOME - UPKEEP_BASE);
});

test('computeIncome: net is always gross minus upkeep', () => {
  const inc = computeIncome(realmWith({ holdings: [{ id: 'market', tier: 2 }], army: { strength: 5 } }));
  assert.equal(inc.net, inc.gross - inc.upkeep);
});

test('computeIncome: a gold-yielding holding raises gross by yield times tier', () => {
  const base = computeIncome(realmWith()).gross;
  const withMarket = computeIncome(realmWith({ holdings: [{ id: 'market', tier: 2 }] })).gross;
  assert.equal(withMarket - base, HOLDING_YIELDS.market.gold! * 2);
});

test('computeIncome: high tax grosses more than normal, low grosses less', () => {
  const low = computeIncome(realmWith({ policies: { tax: 'low' } })).gross;
  const normal = computeIncome(realmWith({ policies: { tax: 'normal' } })).gross;
  const high = computeIncome(realmWith({ policies: { tax: 'high' } })).gross;
  assert.ok(low < normal, `low ${low} < normal ${normal}`);
  assert.ok(high > normal, `high ${high} > normal ${normal}`);
});

test('computeIncome: a standing army raises upkeep', () => {
  const peace = computeIncome(realmWith()).upkeep;
  const war = computeIncome(realmWith({ army: { strength: 10 } })).upkeep;
  assert.ok(war > peace, `army upkeep ${war} > base ${peace}`);
});

// --- applyIncome (treasury floor invariant) ---

test('applyIncome: positive net adds to treasury, no shortfall', () => {
  const r = applyIncome(100, 30);
  assert.equal(r.treasury, 130);
  assert.equal(r.shortfall, 0);
});

test('applyIncome: deficit larger than treasury floors at 0 and reports the unfunded gap', () => {
  const r = applyIncome(5, -20);
  assert.equal(r.treasury, 0);
  assert.equal(r.shortfall, 15);
});

test('applyIncome: deficit exactly draining treasury leaves 0 with no shortfall', () => {
  const r = applyIncome(10, -10);
  assert.equal(r.treasury, 0);
  assert.equal(r.shortfall, 0);
});

// --- resolveFood ---

test('resolveFood: surplus raises stock, no shortage', () => {
  const f = resolveFood({ stock: 80, production: 30, consumption: 26 });
  assert.equal(f.surplus, 4);
  assert.equal(f.stock, 84);
  assert.equal(f.shortage, 0);
});

test('resolveFood: consumption beyond stock + production floors stock at 0 and reports shortage', () => {
  const f = resolveFood({ stock: 2, production: 5, consumption: 20 });
  assert.equal(f.stock, 0);
  assert.equal(f.shortage, 13);
});

test('computeIncome: a higher-quality army costs more upkeep at equal strength', () => {
  const levy  = computeIncome({ policies: { tax: 'normal' }, holdings: [], army: { strength: 20, quality: 1.0 } });
  const elite = computeIncome({ policies: { tax: 'normal' }, holdings: [], army: { strength: 20, quality: 2.0 } });
  assert.ok(elite.upkeep > levy.upkeep, `elite ${elite.upkeep} > levy ${levy.upkeep}`);
});
