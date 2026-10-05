import {describe, expect, it} from 'vitest';
import {needsConfirmation} from '../src/steam/create-offer';
describe('needsConfirmation', () => {
  it('detecta la confirmación por la app o por email', () => {
    expect(needsConfirmation({tradeofferid: '1', needs_mobile_confirmation: true})).toBe(true);
    expect(needsConfirmation({tradeofferid: '1', needs_email_confirmation: true})).toBe(true);
  });
  it('no la pide si Steam no la informa', () => {
    expect(needsConfirmation({tradeofferid: '1'})).toBe(false);
    expect(needsConfirmation({tradeofferid: '1', needs_mobile_confirmation: false, needs_email_confirmation: false})).toBe(false);
  });
});
