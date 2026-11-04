import { describe, it, expect } from 'vitest';
import { applyMsgStatus, getMsgStatus, deliveryLabel } from './aprsMsgStatus.js';

describe('APRS delivery state (#1247)', () => {
  it('keeps the latest state per message id', () => {
    applyMsgStatus({ msgId: '12', state: 'pending', tries: 1, maxTries: 6 });
    applyMsgStatus({ msgId: '12', state: 'pending', tries: 2, maxTries: 6 });
    expect(getMsgStatus('12')).toMatchObject({ tries: 2 });
    expect(getMsgStatus(null)).toBeNull();
  });

  it('labels a sent message from the live state first, then the server record', () => {
    const m = { direction: 'sent', msgId: '12', delivery: 'pending' };
    expect(deliveryLabel(m, { state: 'pending', tries: 2, maxTries: 6 }).text).toBe('↻ 2/6');
    expect(deliveryLabel(m, { state: 'acked' }).text).toBe('✓ delivered');
    expect(deliveryLabel({ ...m, delivery: 'acked' }, null).text).toBe('✓ delivered');
    expect(deliveryLabel(m, { state: 'expired', tries: 6 }).text).toBe('✕ no ack');
    expect(deliveryLabel({ ...m, delivery: 'rejected' }, null).text).toBe('✕ rejected');
    expect(deliveryLabel(m, null).text).toBe('… waiting');
  });

  it('shows nothing when no ack was requested', () => {
    expect(deliveryLabel({ direction: 'sent', msgId: null }, null)).toBeNull();
    expect(deliveryLabel({ direction: 'sent', msgId: '5', delivery: null }, null)).toBeNull();
  });
});
