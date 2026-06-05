import type { TState } from './types';

export function scaffoldCampaignState(name: string, seed: string): TState {
  return {
    meta: { campaign: name, rulesetId: '5e' },
    rng: { seed, cursor: 0 },
    pcs: {}, npcs: {}, factions: {}, clocks: {},
  } as unknown as TState;
}
