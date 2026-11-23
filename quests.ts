import type { CaughtFishRecord } from '../types/fishing';
import { FISH_SPECIES } from '../types/fishing';

const QUEST_STORAGE_KEY = 'serene_valley_angler_quests_v1';

export type QuestKind = 'daily' | 'achievement';

export interface QuestDefinition {
  id: string;
  kind: QuestKind;
  titleAr: string;
  descriptionAr: string;
  target: number;
  rewardXp: number;
  /** How much a single catch moves this quest forward (0 = not affected). */
  progressFor: (record: CaughtFishRecord, stats: QuestStats) => number;
}

/** Lifetime counters (persisted) used by achievements. */
export interface QuestStats {
  totalCatches: number;
  totalReleased: number;
  legendaryCatches: number;
  speciesSeen: string[];
}

export interface QuestSave {
  day: string; // YYYY-MM-DD of current daily set
  dailyIds: string[];
  progress: Record<string, number>;
  completed: string[];
  stats: QuestStats;
}

/** What the HUD receives. */
export interface QuestView {
  id: string;
  kind: QuestKind;
  titleAr: string;
  descriptionAr: string;
  progress: number;
  target: number;
  rewardXp: number;
  completed: boolean;
}

function hourOf(record: CaughtFishRecord): number {
  const h = parseInt(record.caughtAtTime.slice(0, 2), 10);
  return Number.isFinite(h) ? h : 12;
}

const DAILY_POOL: QuestDefinition[] = [
  {
    id: 'd_catch_3',
    kind: 'daily',
    titleAr: 'صياد اليوم',
    descriptionAr: 'اصطد 3 أسماك من أي نوع',
    target: 3,
    rewardXp: 60,
    progressFor: () => 1,
  },
  {
    id: 'd_release_1',
    kind: 'daily',
    titleAr: 'حارس البحيرة',
    descriptionAr: 'أطلق سمكة واحدة في الماء',
    target: 1,
    rewardXp: 45,
    progressFor: (r) => (r.released ? 1 : 0),
  },
  {
    id: 'd_rare',
    kind: 'daily',
    titleAr: 'صيدة نادرة',
    descriptionAr: 'اصطد سمكة نادرة أو أسطورية',
    target: 1,
    rewardXp: 110,
    progressFor: (r) => (r.species.rarity !== 'شائع' ? 1 : 0),
  },
  {
    id: 'd_dawn',
    kind: 'daily',
    titleAr: 'طيور الفجر',
    descriptionAr: 'اصطد سمكتين بين الساعة 5 و10 صباحاً',
    target: 2,
    rewardXp: 70,
    progressFor: (r) => (hourOf(r) >= 5 && hourOf(r) < 10 ? 1 : 0),
  },
  {
    id: 'd_night',
    kind: 'daily',
    titleAr: 'سهر الصيادين',
    descriptionAr: 'اصطد سمكة بعد الغروب (من 19 حتى 4 فجراً)',
    target: 1,
    rewardXp: 80,
    progressFor: (r) => (hourOf(r) >= 19 || hourOf(r) < 4 ? 1 : 0),
  },
  {
    id: 'd_rain',
    kind: 'daily',
    titleAr: 'تحت المطر',
    descriptionAr: 'اصطد سمكة أثناء المطر أو العاصفة',
    target: 1,
    rewardXp: 90,
    progressFor: (r) => (r.weather === 'rain' || r.weather === 'storm' ? 1 : 0),
  },
  {
    id: 'd_deep',
    kind: 'daily',
    titleAr: 'غوّاص الأعماق',
    descriptionAr: 'اصطد سمكة من الحوض العميق',
    target: 1,
    rewardXp: 85,
    progressFor: (r) => (r.zone === 'deep_basin' ? 1 : 0),
  },
  {
    id: 'd_big',
    kind: 'daily',
    titleAr: 'سمكة كبيرة',
    descriptionAr: 'اصطد سمكة طولها 50 سم أو أكثر',
    target: 1,
    rewardXp: 75,
    progressFor: (r) => (r.lengthCm >= 50 ? 1 : 0),
  },
];

const ACHIEVEMENTS: QuestDefinition[] = [
  {
    id: 'a_first',
    kind: 'achievement',
    titleAr: 'أول صيدة',
    descriptionAr: 'اصطد أول سمكة لك',
    target: 1,
    rewardXp: 40,
    progressFor: () => 1,
  },
  {
    id: 'a_catch_25',
    kind: 'achievement',
    titleAr: 'صياد متمرس',
    descriptionAr: 'اصطد 25 سمكة',
    target: 25,
    rewardXp: 220,
    progressFor: () => 1,
  },
  {
    id: 'a_catch_100',
    kind: 'achievement',
    titleAr: 'سيد البحيرة',
    descriptionAr: 'اصطد 100 سمكة',
    target: 100,
    rewardXp: 800,
    progressFor: () => 1,
  },
  {
    id: 'a_release_10',
    kind: 'achievement',
    titleAr: 'صديق البيئة',
    descriptionAr: 'أطلق 10 أسماك في الماء',
    target: 10,
    rewardXp: 250,
    progressFor: (r) => (r.released ? 1 : 0),
  },
  {
    id: 'a_legend',
    kind: 'achievement',
    titleAr: 'صائد الأساطير',
    descriptionAr: 'اصطد سمكة أسطورية',
    target: 1,
    rewardXp: 400,
    progressFor: (r) => (r.species.rarity === 'أسطوري' ? 1 : 0),
  },
  {
    id: 'a_collector',
    kind: 'achievement',
    titleAr: 'جامع الأنواع',
    descriptionAr: 'اصطد كل أنواع أسماك البحيرة',
    target: FISH_SPECIES.length,
    rewardXp: 600,
    // progress is derived from stats.speciesSeen (see applyCatchToQuests)
    progressFor: () => 0,
  },
  {
    id: 'a_giant',
    kind: 'achievement',
    titleAr: 'عملاق البحيرة',
    descriptionAr: 'اصطد سمكة طولها 90 سم أو أكثر',
    target: 1,
    rewardXp: 300,
    progressFor: (r) => (r.lengthCm >= 90 ? 1 : 0),
  },
];

const ALL_QUESTS: QuestDefinition[] = [...DAILY_POOL, ...ACHIEVEMENTS];

function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deterministic pick of 3 daily quests from the day string. */
function pickDailyIds(day: string): string[] {
  let seed = 0;
  for (let i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;
  const pool = DAILY_POOL.map((q) => q.id);
  const picked: string[] = [];
  while (picked.length < 3 && pool.length > 0) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const idx = seed % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function createFreshSave(day = todayKey()): QuestSave {
  return {
    day,
    dailyIds: pickDailyIds(day),
    progress: {},
    completed: [],
    stats: { totalCatches: 0, totalReleased: 0, legendaryCatches: 0, speciesSeen: [] },
  };
}

/** Starts a new daily set when the date changed, keeping achievements. */
function rolloverIfNeeded(save: QuestSave): QuestSave {
  const today = todayKey();
  if (save.day === today) return save;
  const dailyIdSet = new Set(DAILY_POOL.map((q) => q.id));
  const keepProgress: Record<string, number> = {};
  for (const [id, value] of Object.entries(save.progress)) {
    if (!dailyIdSet.has(id)) keepProgress[id] = value;
  }
  return {
    ...save,
    day: today,
    dailyIds: pickDailyIds(today),
    progress: keepProgress,
    completed: save.completed.filter((id) => !dailyIdSet.has(id)),
  };
}

export function loadQuestSave(): QuestSave {
  try {
    const raw = localStorage.getItem(QUEST_STORAGE_KEY);
    if (!raw) return createFreshSave();
    const parsed = JSON.parse(raw) as Partial<QuestSave>;
    const base = createFreshSave(typeof parsed.day === 'string' ? parsed.day : todayKey());
    const loaded: QuestSave = {
      day: base.day,
      dailyIds:
        Array.isArray(parsed.dailyIds) && parsed.dailyIds.length > 0 ? parsed.dailyIds : base.dailyIds,
      progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      stats: {
        totalCatches: Math.max(0, parsed.stats?.totalCatches ?? 0),
        totalReleased: Math.max(0, parsed.stats?.totalReleased ?? 0),
        legendaryCatches: Math.max(0, parsed.stats?.legendaryCatches ?? 0),
        speciesSeen: Array.isArray(parsed.stats?.speciesSeen) ? parsed.stats!.speciesSeen : [],
      },
    };
    return rolloverIfNeeded(loaded);
  } catch {
    return createFreshSave();
  }
}

export function saveQuestSave(save: QuestSave): void {
  try {
    localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify(save));
  } catch {
    // ignore storage errors
  }
}

export interface QuestUpdateResult {
  save: QuestSave;
  /** Quests that were completed by this catch. */
  newlyCompleted: QuestDefinition[];
  totalRewardXp: number;
}

/** Applies one resolved catch (after keep / release) to the quest state. */
export function applyCatchToQuests(prev: QuestSave, record: CaughtFishRecord): QuestUpdateResult {
  const save = rolloverIfNeeded(prev);
  const stats: QuestStats = {
    totalCatches: save.stats.totalCatches + 1,
    totalReleased: save.stats.totalReleased + (record.released ? 1 : 0),
    legendaryCatches: save.stats.legendaryCatches + (record.species.rarity === 'أسطوري' ? 1 : 0),
    speciesSeen: save.stats.speciesSeen.includes(record.species.id)
      ? save.stats.speciesSeen
      : [...save.stats.speciesSeen, record.species.id],
  };

  const progress = { ...save.progress };
  const completed = [...save.completed];
  const newlyCompleted: QuestDefinition[] = [];

  const active = ALL_QUESTS.filter((q) => q.kind === 'achievement' || save.dailyIds.includes(q.id));
  for (const quest of active) {
    if (completed.includes(quest.id)) continue;
    let next: number;
    if (quest.id === 'a_collector') {
      next = stats.speciesSeen.length;
    } else {
      next = (progress[quest.id] ?? 0) + quest.progressFor(record, stats);
    }
    next = Math.min(next, quest.target);
    progress[quest.id] = next;
    if (next >= quest.target) {
      completed.push(quest.id);
      newlyCompleted.push(quest);
    }
  }

  return {
    save: { ...save, progress, completed, stats },
    newlyCompleted,
    totalRewardXp: newlyCompleted.reduce((sum, q) => sum + q.rewardXp, 0),
  };
}

/** Builds the list shown in the HUD (today's dailies first, then achievements). */
export function buildQuestViews(prev: QuestSave): QuestView[] {
  const save = rolloverIfNeeded(prev);
  const toView = (q: QuestDefinition): QuestView => ({
    id: q.id,
    kind: q.kind,
    titleAr: q.titleAr,
    descriptionAr: q.descriptionAr,
    progress:
      q.id === 'a_collector'
        ? Math.min(save.stats.speciesSeen.length, q.target)
        : Math.min(save.progress[q.id] ?? 0, q.target),
    target: q.target,
    rewardXp: q.rewardXp,
    completed: save.completed.includes(q.id),
  });
  const dailies = save.dailyIds
    .map((id) => DAILY_POOL.find((q) => q.id === id))
    .filter((q): q is QuestDefinition => Boolean(q))
    .map(toView);
  return [...dailies, ...ACHIEVEMENTS.map(toView)];
}
