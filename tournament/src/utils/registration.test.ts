import { describe, expect, it } from 'vitest';
import {
  calculateExpandParticipantsCost,
  calculateParticipantExtraCost,
} from './registration';

describe('Tournament pricing from Backoffice', () => {
  it('uses the supplied free participant and coin rates', () => {
    expect(calculateParticipantExtraCost(400, 400, 10)).toBe(0);
    expect(calculateParticipantExtraCost(401, 400, 10)).toBe(10);
    expect(calculateParticipantExtraCost(425, 400, 12)).toBe(300);
  });

  it('charges only the newly added capacity above the free threshold', () => {
    expect(calculateExpandParticipantsCost(390, 20, 400, 10)).toBe(100);
    expect(calculateExpandParticipantsCost(450, 10, 400, 10)).toBe(100);
  });
});
