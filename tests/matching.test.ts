import {describe, expect, it} from 'vitest';
import {evaluateTrade, findBlockingOffer, pickActiveTrade} from '../src/marketplace/matching';
import type {PendingTrade, SteamHistoryTrade, SteamOffer} from '../src/types';
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
describe('Steam history matching from the buyer side', () => {
  const purchase: PendingTrade = {...order, id: 'purchase', role: 'BUYER', buyerTradeUrl: undefined};
  const received: SteamHistoryTrade = {...trade, steamid_other: S, assets_given: [], assets_received: [{appid: 730, assetid: A, new_assetid: '777'}]};
  it('accepts the item received from the seller', () => expect(evaluateTrade(purchase, [received]).candidate).toBe(true));
  it('rejects the item received from someone else', () => expect(evaluateTrade(purchase, [{...received, steamid_other: B}]).candidate).toBe(false));
  it('does not take a trade where the buyer gave the item', () => expect(evaluateTrade(purchase, [{...received, assets_given: received.assets_received, assets_received: []}]).candidate).toBe(false));
  it('sees the rollback in the buyer history too', () => expect(evaluateTrade(purchase, [{...received, status: 12}]).rolledBack).toBe(true));
});
describe('Blocking offers', () => {
  const offer: SteamOffer = {tradeofferid: '555', accountid_other: 0, otherSteamId: B, trade_offer_state: 2, items_to_give: [{appid: 730, assetid: A}], items_to_receive: [], time_created: 0, time_updated: 0};
  it('blocks an active offer to the buyer with the sold asset', () => expect(findBlockingOffer(order, [offer])?.tradeofferid).toBe('555'));
  it('blocks offers waiting for mobile confirmation, accepted or in escrow', () => {for (const state of [3, 9, 11]) expect(findBlockingOffer(order, [{...offer, trade_offer_state: state}])).toBeDefined()});
  it('ignores declined, canceled and expired offers', () => {for (const state of [5, 6, 7]) expect(findBlockingOffer(order, [{...offer, trade_offer_state: state}])).toBeUndefined()});
  it('ignores offers to another user or with another asset', () => {expect(findBlockingOffer(order, [{...offer, otherSteamId: S}])).toBeUndefined(); expect(findBlockingOffer(order, [{...offer, items_to_give: [{appid: 730, assetid: '999'}]}])).toBeUndefined()});
  it('matches the registered offer by ID when the HTML fallback has no items', () => expect(findBlockingOffer({...order, steamTradeOfferId: '555'}, [{...offer, otherSteamId: '', items_to_give: []}])).toBeDefined());
});
describe('Active trade selection with several sales to the same buyer', () => {
  const done = {...order, id: 'done', blockingOffer: {id: '555', state: 3}}, next = {...order, id: 'next', assetId: '999'}, other = {...order, id: 'other', assetId: '888'};
  it('skips a sale already delivered and offers the next one', () => expect(pickActiveTrade([done, next])?.id).toBe('next'));
  it('prefers the sale opened from Skincito', () => expect(pickActiveTrade([done, next, other], 'other')?.id).toBe('other'));
  it('moves on when the opened sale already has an offer', () => expect(pickActiveTrade([done, next], 'done')?.id).toBe('next'));
  it('shows the block only when every sale has an offer', () => expect(pickActiveTrade([done, {...next, blockingOffer: {id: '556', state: 2}}], 'done')?.id).toBe('done'));
  it('returns nothing without sales', () => expect(pickActiveTrade([])).toBeUndefined());
});
