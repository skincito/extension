import {describe, expect, it} from 'vitest';
import {evaluateTrade} from '../src/marketplace/matching';
import type {PendingTrade, SteamHistoryTrade} from '../src/types';
const A = '3899876543210123456', B = '76561198000000002', S = '76561198000000001';
const order: PendingTrade = {id: 'sale', sellerSteamId: S, buyerSteamId: B, assetId: A, marketHashName: 'AK-47 | Redline (Field-Tested)', acceptedAt: '2026-10-04T06:00:00Z', buyerTradeUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=397343274&token=test'};
const trade: SteamHistoryTrade = {tradeid: '100', steamid_other: B, status: 3, assets_given: [{appid: 730, assetid: A}], assets_received: [], time_init: 1791093660, time_settlement: 1791093700};
describe('Steam history matching', () => {
  it('accepts an exact completed settled trade', () => expect(evaluateTrade(order, [trade]).candidate).toBe(true));
  it('rejects wrong buyer', () => expect(evaluateTrade(order, [{...trade, steamid_other: S}]).candidate).toBe(false));
  it('rejects wrong asset even if name is the same', () => expect(evaluateTrade(order, [{...trade, assets_given: [{appid: 730, assetid: '999'}]}]).candidate).toBe(false));
  it('rejects received instead of given', () => expect(evaluateTrade(order, [{...trade, assets_given: [], assets_received: trade.assets_given}]).candidate).toBe(false));
  it('rejects a trade before acceptance', () => expect(evaluateTrade(order, [{...trade, time_init: 1791090000}]).candidate).toBe(false));
  it('rejects failed and unsettled trades', () => {expect(evaluateTrade(order, [{...trade, status: 4}]).candidate).toBe(false); expect(evaluateTrade(order, [{...trade, time_settlement: undefined}]).candidate).toBe(false)});
  it('rejects rollback status and rollback link', () => {expect(evaluateTrade(order, [{...trade, status: 12}]).rolledBack).toBe(true); expect(evaluateTrade(order, [trade, {...trade, tradeid: '101', assets_given: [], rollback_trade: '100'}]).candidate).toBe(false)});
  it('latest failed attempt overrides older completed attempt', () => expect(evaluateTrade(order, [trade, {...trade, tradeid: '101', time_init: trade.time_init + 1, status: 4}]).candidate).toBe(false));
  it('latest completed attempt overrides older failed attempt', () => expect(evaluateTrade(order, [{...trade, tradeid: '99', time_init: trade.time_init - 1, status: 4}, trade]).candidate).toBe(true));
  it('does not prove the same sale twice', () => expect(evaluateTrade({...order, proofAcceptedAt: '2026-10-04T07:00:00Z'}, [trade]).candidate).toBe(false));
});
