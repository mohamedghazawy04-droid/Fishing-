import {
  BAIT_CATALOG,
  FISH_SPECIES,
  HOOK_CATALOG,
  NIGHT_REFLECTION_MOODS,
  computeLevelFromXp,
  generateDailyChallenges,
  getTodayDateKey,
  type BaitId,
  type DailyChallenge,
  type DailyChallengesState,
  type PlayerProgression,
  type SaveHealthReport,
  type SpeciesRecordEntry,
} from '../types/fishing';
import { AVATAR_STYLE_OPTIONS, type PlayerAvatarStyle } from '../types/multiplayer';

export const SAVE_STORAGE_KEYS = {
  progression: 'serene_valley_angler_save_v1',
  daily: 'serene_valley_daily_challenges_v1',
  speciesRecords: 'serene_valley_species_records_v1',
  discoveredPois: 'serene_valley_discovered_pois_v1',
  nightMood: 'serene_valley_night_mood_v1',
  profile: 'serene_valley_player_profile_v1',
  adaptive: 'serene_valley_adaptive_v1',
} as const;

const VALID_BAIT_IDS = new Set<string>(BAIT_CATALOG.map((b) => b.id));
const VALID_SPECIES_IDS = new Set<string>(FISH_SPECIES.map((s) => s.id));
const VALID_MOOD_IDS = new Set<string>(NIGHT_REFLECTION_MOODS.map((m) => m.id));
const VALID_AVATARS = new Set<string>(AVATAR_STYLE_OPTIONS.map((a) => a.id));

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function nowTimeLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function repairAllSavedGameData(webglRecoveries = 0): SaveHealthReport {
  const repairedKeys: string[] = [];

  // 1. Repair Progression
  let unlockedBaits: BaitId[] = ['worm', 'fly'];
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.progression);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<PlayerProgression>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid progression shape');
      }
      const totalXp = Math.round(clampNum(parsed.totalXp, 0, 5_000_000, 0));
      const level = computeLevelFromXp(totalXp);
      const availableXp = Math.round(clampNum(parsed.availableXp, 0, 5_000_000, 0));
      const boatLevel = Math.round(clampNum(parsed.boatLevel, 1, 4, 1));
      const skills = {
        castMastery: Math.round(clampNum(parsed.skills?.castMastery, 1, 5, 1)),
        reelSpeed: Math.round(clampNum(parsed.skills?.reelSpeed, 1, 5, 1)),
        lineStrength: Math.round(clampNum(parsed.skills?.lineStrength, 1, 5, 1)),
        anglerSense: Math.round(clampNum(parsed.skills?.anglerSense, 1, 5, 1)),
      };
      unlockedBaits = BAIT_CATALOG.filter((b) => b.unlockLevel <= level).map((b) => b.id);
      const unlockedHooks = HOOK_CATALOG.filter((h) => h.unlockLevel <= level).map((h) => h.id);

      const sanitized: PlayerProgression = {
        level,
        totalXp,
        availableXp,
        boatLevel,
        skills,
        unlockedBaits,
        unlockedHooks,
      };
      const serialized = JSON.stringify(sanitized);
      if (serialized !== raw) {
        localStorage.setItem(SAVE_STORAGE_KEYS.progression, serialized);
        repairedKeys.push('تقدّم الصياد والمهارات');
      }
    }
  } catch {
    localStorage.removeItem(SAVE_STORAGE_KEYS.progression);
    repairedKeys.push('تقدّم الصياد (إعادة ضبط آمن)');
  }

  // 2. Repair Daily Challenges
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.daily);
    const todayKey = getTodayDateKey();
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<DailyChallengesState>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.challenges)) {
        throw new Error('Invalid daily challenges shape');
      }
      const completedTotal = Math.round(clampNum(parsed.completedTotal, 0, 100_000, 0));
      let needsRewrite = parsed.dateKey !== todayKey || parsed.challenges.length !== 3;
      const repairedList: DailyChallenge[] = needsRewrite
        ? generateDailyChallenges(todayKey, unlockedBaits)
        : parsed.challenges.map((ch) => {
            const targetCount = Math.round(clampNum(ch?.targetCount, 1, 20, 1));
            const progress = Math.round(clampNum(ch?.progress, 0, targetCount, 0));
            const completed = Boolean(ch?.completed) || progress >= targetCount;
            if (
              typeof ch?.id !== 'string' ||
              typeof ch?.titleAr !== 'string' ||
              progress !== ch.progress ||
              targetCount !== ch.targetCount ||
              completed !== ch.completed
            ) {
              needsRewrite = true;
            }
            return {
              ...ch,
              targetCount,
              progress,
              completed,
              xpReward: Math.round(clampNum(ch?.xpReward, 25, 2000, 90)),
            };
          });
      if (needsRewrite) {
        const cleanDaily: DailyChallengesState = {
          dateKey: todayKey,
          challenges: repairedList,
          completedTotal,
        };
        localStorage.setItem(SAVE_STORAGE_KEYS.daily, JSON.stringify(cleanDaily));
        repairedKeys.push('التحديات اليومية');
      }
    }
  } catch {
    const todayKey = getTodayDateKey();
    localStorage.setItem(
      SAVE_STORAGE_KEYS.daily,
      JSON.stringify({
        dateKey: todayKey,
        challenges: generateDailyChallenges(todayKey, unlockedBaits),
        completedTotal: 0,
      }),
    );
    repairedKeys.push('التحديات اليومية (إصلاح)');
  }

  // 3. Repair Species Records
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.speciesRecords);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, Partial<SpeciesRecordEntry>>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid species records');
      }
      const cleanRecords: Record<string, SpeciesRecordEntry> = {};
      let modified = false;
      for (const [k, v] of Object.entries(parsed)) {
        if (!VALID_SPECIES_IDS.has(k) || !v || typeof v !== 'object') {
          modified = true;
          continue;
        }
        const maxWeightKg = Number(clampNum(v.maxWeightKg, 0.05, 500, 0.5).toFixed(2));
        const maxLengthCm = Math.round(clampNum(v.maxLengthCm, 5, 400, 20));
        const achievedAt = typeof v.achievedAt === 'string' ? v.achievedAt.slice(0, 12) : '08:00';
        if (maxWeightKg !== v.maxWeightKg || maxLengthCm !== v.maxLengthCm || v.speciesId !== k) {
          modified = true;
        }
        cleanRecords[k] = {
          speciesId: k,
          maxWeightKg,
          maxLengthCm,
          achievedAt,
        };
      }
      if (modified) {
        localStorage.setItem(SAVE_STORAGE_KEYS.speciesRecords, JSON.stringify(cleanRecords));
        repairedKeys.push('سجل الأوزان القياسية');
      }
    }
  } catch {
    localStorage.setItem(SAVE_STORAGE_KEYS.speciesRecords, '{}');
    repairedKeys.push('سجل الأوزان القياسية (إصلاح)');
  }

  // 4. Repair Discovered POIs
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.discoveredPois);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid POIs');
      }
      const cleanPois: Record<string, string> = {};
      let modified = false;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && k.length > 0 && k.length < 48) {
          cleanPois[k] = v.slice(0, 20);
        } else {
          modified = true;
        }
      }
      if (modified) {
        localStorage.setItem(SAVE_STORAGE_KEYS.discoveredPois, JSON.stringify(cleanPois));
        repairedKeys.push('معالم البحيرة المكتشفة');
      }
    }
  } catch {
    localStorage.setItem(SAVE_STORAGE_KEYS.discoveredPois, '{}');
    repairedKeys.push('معالم البحيرة (إصلاح)');
  }

  // 5. Repair Night Mood
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.nightMood);
    if (raw !== null && !VALID_MOOD_IDS.has(raw)) {
      localStorage.setItem(SAVE_STORAGE_KEYS.nightMood, 'auto');
      repairedKeys.push('مزاج انعكاس الليل');
    }
  } catch {
    // Ignore
  }

  // 6. Repair Character Profile
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.profile);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { name?: unknown; avatarColor?: unknown };
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid profile');
      const rawName = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 20) : '';
      const name = rawName.length >= 2 ? rawName : 'صياد البحيرة';
      const avatarColor: PlayerAvatarStyle =
        typeof parsed.avatarColor === 'string' && VALID_AVATARS.has(parsed.avatarColor)
          ? (parsed.avatarColor as PlayerAvatarStyle)
          : 'emerald';
      if (name !== parsed.name || avatarColor !== parsed.avatarColor) {
        localStorage.setItem(SAVE_STORAGE_KEYS.profile, JSON.stringify({ name, avatarColor }));
        repairedKeys.push('ملف الشخصية');
      }
    }
  } catch {
    localStorage.setItem(
      SAVE_STORAGE_KEYS.profile,
      JSON.stringify({ name: 'صياد البحيرة', avatarColor: 'emerald' }),
    );
    repairedKeys.push('ملف الشخصية (إصلاح)');
  }

  // 7. Repair Adaptive Memory
  try {
    const raw = localStorage.getItem(SAVE_STORAGE_KEYS.adaptive);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid adaptive state');
      }
      const baitCounts = (parsed.baitCounts && typeof parsed.baitCounts === 'object' ? parsed.baitCounts : {}) as Record<
        string,
        unknown
      >;
      let modified = false;
      for (const key of Object.keys(baitCounts)) {
        if (!VALID_BAIT_IDS.has(key) || typeof baitCounts[key] !== 'number' || !Number.isFinite(baitCounts[key])) {
          delete baitCounts[key];
          modified = true;
        }
      }
      if (modified) {
        localStorage.setItem(SAVE_STORAGE_KEYS.adaptive, JSON.stringify({ ...parsed, baitCounts }));
        repairedKeys.push('ذاكرة الذكاء التكيّفي');
      }
    }
  } catch {
    localStorage.removeItem(SAVE_STORAGE_KEYS.adaptive);
    repairedKeys.push('ذاكرة الذكاء التكيّفي (إصلاح)');
  }

  return {
    healthy: true,
    repairedCount: repairedKeys.length,
    repairedKeys,
    checkedAt: nowTimeLabel(),
    webglRecoveries,
  };
}
