import type { TRosterMember } from './schema.js';

export function xpToNextLevel(level: number): number {
  return level * 100;
}

export function gainXp(member: TRosterMember, amount: number): TRosterMember {
  return { ...member, xp: member.xp + amount };
}

export function levelUp(member: TRosterMember, perkId: string): TRosterMember {
  const threshold = xpToNextLevel(member.level);
  const remainder = member.xp - threshold;
  return {
    ...member,
    level: member.level + 1,
    xp: Math.max(0, remainder),
    perks: [...member.perks, perkId],
  };
}

export interface InjuryEntry {
  id: string;
  name: string;
  stat: 'melee' | 'ranged' | 'defense' | 'resolve' | 'initiative';
  amount: number;
}

export function applyInjury(member: TRosterMember, injury: InjuryEntry): TRosterMember {
  const newStats = { ...member.stats };
  const current = newStats[injury.stat] as number;
  (newStats as Record<string, number>)[injury.stat] = Math.max(0, current + injury.amount);
  return {
    ...member,
    stats: newStats,
    injuries: [...member.injuries, { id: injury.id, name: injury.name, stat: injury.stat, amount: injury.amount }],
  };
}

export interface DeathRecord {
  cause: string;
  battleId: string;
  dayOfCampaign: number;
  location: string;
}

export function resolveHirelingDown(member: TRosterMember, roll: number, deathRecord: DeathRecord): TRosterMember {
  if (roll <= 2) {
    return { ...member, death: deathRecord };
  }
  return { ...member, stats: { ...member.stats, hp: member.stats.maxHp } };
}
