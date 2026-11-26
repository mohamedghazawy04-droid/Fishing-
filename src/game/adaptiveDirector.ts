import {
  LAKE_ZONE_LABELS,
  type AdaptiveLakeEvent,
  type AdaptiveTelemetrySummary,
  type BaitId,
  type LakeZoneId,
  type SeasonId,
  type WeatherType,
} from '../types/fishing';
import { SAVE_STORAGE_KEYS } from '../utils/saveRepair';

interface PersistedAdaptiveMemory {
  totalCatches: number;
  rareCatches: number;
  legendaryCatches: number;
  totalSnaps: number;
  totalCrocDevours: number;
  totalCrocEscapes: number;
  streakWithoutSnap: number;
  avgFightSeconds: number;
  baitCounts: Partial<Record<BaitId, number>>;
  zoneCounts: Partial<Record<LakeZoneId, number>>;
  evolveCount: number;
  activeEvent: AdaptiveLakeEvent;
}

const VALID_ZONES: LakeZoneId[] = [
  'dock_shade',
  'shore_reeds',
  'rocky_ledge',
  'deep_basin',
  'alpine_abyss',
];

function createDefaultEvent(): AdaptiveLakeEvent {
  return {
    id: 'initial_spring_tide',
    titleAr: 'تيار الصباح الهادئ',
    descriptionAr: 'تتجمع أسراب الأسماك قرب الحافة الصخرية وظل الرصيف مع بداية نشاط البحيرة.',
    coachingTipAr: 'جرّب الدودة أو الذبابة على عمق 1.4م لتحقيق بداية متوازنة.',
    bonusBiteMult: 1.08,
    bonusRarityMult: 1.06,
    targetZone: 'rocky_ledge',
    source: 'adaptive',
    updatedAt: Date.now(),
  };
}

function createInitialMemory(): PersistedAdaptiveMemory {
  return {
    totalCatches: 0,
    rareCatches: 0,
    legendaryCatches: 0,
    totalSnaps: 0,
    totalCrocDevours: 0,
    totalCrocEscapes: 0,
    streakWithoutSnap: 0,
    avgFightSeconds: 10,
    baitCounts: { worm: 1 },
    zoneCounts: { dock_shade: 1 },
    evolveCount: 0,
    activeEvent: createDefaultEvent(),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class AdaptiveLakeDirector {
  private memory: PersistedAdaptiveMemory;
  private isBusy = false;

  constructor() {
    this.memory = this.load();
  }

  private load(): PersistedAdaptiveMemory {
    try {
      const raw = localStorage.getItem(SAVE_STORAGE_KEYS.adaptive);
      if (!raw) return createInitialMemory();
      const parsed = JSON.parse(raw) as Partial<PersistedAdaptiveMemory>;
      const base = createInitialMemory();
      const evt = parsed.activeEvent;
      const validEvt =
        evt &&
        typeof evt.titleAr === 'string' &&
        typeof evt.descriptionAr === 'string' &&
        typeof evt.coachingTipAr === 'string' &&
        VALID_ZONES.includes(evt.targetZone)
          ? {
              ...evt,
              bonusBiteMult: clamp(Number(evt.bonusBiteMult) || 1.08, 0.95, 1.38),
              bonusRarityMult: clamp(Number(evt.bonusRarityMult) || 1.05, 1.0, 1.48),
            }
          : base.activeEvent;

      return {
        totalCatches: Math.max(0, Math.round(Number(parsed.totalCatches) || 0)),
        rareCatches: Math.max(0, Math.round(Number(parsed.rareCatches) || 0)),
        legendaryCatches: Math.max(0, Math.round(Number(parsed.legendaryCatches) || 0)),
        totalSnaps: Math.max(0, Math.round(Number(parsed.totalSnaps) || 0)),
        totalCrocDevours: Math.max(0, Math.round(Number(parsed.totalCrocDevours) || 0)),
        totalCrocEscapes: Math.max(0, Math.round(Number(parsed.totalCrocEscapes) || 0)),
        streakWithoutSnap: Math.max(0, Math.round(Number(parsed.streakWithoutSnap) || 0)),
        avgFightSeconds: clamp(Number(parsed.avgFightSeconds) || 10, 2, 60),
        baitCounts: parsed.baitCounts && typeof parsed.baitCounts === 'object' ? parsed.baitCounts : base.baitCounts,
        zoneCounts: parsed.zoneCounts && typeof parsed.zoneCounts === 'object' ? parsed.zoneCounts : base.zoneCounts,
        evolveCount: Math.max(0, Math.round(Number(parsed.evolveCount) || 0)),
        activeEvent: validEvt,
      };
    } catch {
      return createInitialMemory();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_STORAGE_KEYS.adaptive, JSON.stringify(this.memory));
    } catch {
      // Ignore quota errors
    }
  }

  public getFavoriteBait(): BaitId {
    let best: BaitId = 'worm';
    let bestCount = -1;
    for (const [k, count] of Object.entries(this.memory.baitCounts)) {
      if (typeof count === 'number' && count > bestCount) {
        bestCount = count;
        best = k as BaitId;
      }
    }
    return best;
  }

  public recordCatch(params: {
    rarity: string;
    baitId: BaitId;
    zone: LakeZoneId;
    fightSeconds: number;
    crocCloseEscape: boolean;
  }): void {
    this.memory.totalCatches += 1;
    if (params.rarity === 'نادر') this.memory.rareCatches += 1;
    if (params.rarity === 'أسطوري') this.memory.legendaryCatches += 1;
    this.memory.streakWithoutSnap += 1;
    if (params.crocCloseEscape) this.memory.totalCrocEscapes += 1;

    const prevAvg = this.memory.avgFightSeconds;
    const clampedFight = clamp(params.fightSeconds, 2, 45);
    this.memory.avgFightSeconds = Number((prevAvg * 0.78 + clampedFight * 0.22).toFixed(1));

    this.memory.baitCounts[params.baitId] = (this.memory.baitCounts[params.baitId] ?? 0) + 1;
    this.memory.zoneCounts[params.zone] = (this.memory.zoneCounts[params.zone] ?? 0) + 1;
    this.save();
  }

  public recordLineSnap(baitId: BaitId): void {
    this.memory.totalSnaps += 1;
    this.memory.streakWithoutSnap = 0;
    this.memory.baitCounts[baitId] = (this.memory.baitCounts[baitId] ?? 0) + 1;
    this.save();
  }

  public recordCrocDevour(): void {
    this.memory.totalCrocDevours += 1;
    this.memory.streakWithoutSnap = Math.max(0, this.memory.streakWithoutSnap - 1);
    this.save();
  }

  public getTelemetrySummary(): AdaptiveTelemetrySummary {
    const totalAttempts = Math.max(1, this.memory.totalCatches + this.memory.totalSnaps + this.memory.totalCrocDevours);
    const successRate = this.memory.totalCatches / totalAttempts;
    const streakFactor = clamp(this.memory.streakWithoutSnap / 10, 0, 1);
    const skillScore = Number(
      clamp(0.32 + successRate * 0.42 + streakFactor * 0.26, 0.15, 0.98).toFixed(2),
    );

    // Fair self-balancing tuning:
    // - Struggling players get slightly faster bites & softer line tension
    // - Veteran streak players get richer rare fish odds & livelier fish fights
    const snapPenalty = clamp(this.memory.totalSnaps - this.memory.streakWithoutSnap, 0, 6);
    const biteSpeedMult = Number(
      clamp((1.0 + snapPenalty * 0.045) * this.memory.activeEvent.bonusBiteMult, 0.9, 1.42).toFixed(2),
    );
    const fishFightScale = Number(
      clamp(0.84 + skillScore * 0.34 - snapPenalty * 0.03, 0.76, 1.24).toFixed(2),
    );
    const rareSpawnBoost = Number(
      clamp(
        (1.0 + streakFactor * 0.18 + Math.min(0.12, this.memory.totalCrocEscapes * 0.03)) *
          this.memory.activeEvent.bonusRarityMult,
        1.0,
        1.55,
      ).toFixed(2),
    );
    const crocAggressionScale = Number(
      clamp(0.86 + skillScore * 0.26 - clamp(this.memory.totalCrocDevours, 0, 4) * 0.04, 0.78, 1.18).toFixed(2),
    );

    return {
      skillScore,
      biteSpeedMult,
      fishFightScale,
      rareSpawnBoost,
      crocAggressionScale,
      totalCatches: this.memory.totalCatches,
      totalSnaps: this.memory.totalSnaps,
      totalCrocDevours: this.memory.totalCrocDevours,
      favoriteBait: this.getFavoriteBait(),
      streakWithoutSnap: this.memory.streakWithoutSnap,
      evolveCount: this.memory.evolveCount,
    };
  }

  public getActiveEvent(): AdaptiveLakeEvent {
    return this.memory.activeEvent;
  }

  public getZoneBonusMultiplier(zone: LakeZoneId): number {
    return zone === this.memory.activeEvent.targetZone ? 1.16 : 1.0;
  }

  public isEvolving(): boolean {
    return this.isBusy;
  }

  private buildDeterministicLocalEvent(weather: WeatherType, season: SeasonId): AdaptiveLakeEvent {
    const summary = this.getTelemetrySummary();
    let targetZone: LakeZoneId = 'rocky_ledge';
    let titleAr = 'تيار الأسماك النشط';
    let descriptionAr = '';
    let coachingTipAr = '';
    let bonusBiteMult = 1.14;
    let bonusRarityMult = 1.15;

    if (summary.totalSnaps > summary.totalCatches * 0.45 && summary.totalSnaps >= 2) {
      targetZone = 'shore_reeds';
      titleAr = 'تكيّف المياه الهادئة';
      descriptionAr = `خفّفت البحيرة تيارات ${LAKE_ZONE_LABELS[targetZone]} لمساعدتك على سحب أكثر سلاسة.`;
      coachingTipAr = 'خفف الضغط لحظة احمرار مؤشر التوتر ثم عاود السحب بالتدريج.';
      bonusBiteMult = 1.2;
      bonusRarityMult = 1.12;
    } else if (weather === 'storm' || weather === 'rain' || season === 'autumn') {
      targetZone = 'deep_basin';
      titleAr = 'نبض الأعماق الممطرة';
      descriptionAr = `انجراف الغذاء نحو ${LAKE_ZONE_LABELS[targetZone]} يجذب الكراكي والأسماك النادرة.`;
      coachingTipAr = 'استخدم الطعم الدوّار أو المضيء على عمق يتجاوز 2.4 متر.';
      bonusBiteMult = 1.16;
      bonusRarityMult = 1.28;
    } else if (summary.streakWithoutSnap >= 4) {
      targetZone = 'alpine_abyss';
      titleAr = 'صحوة الأساطير الجبلية';
      descriptionAr = `سلسلة صيدك الناجحة فتحت نشاطاً استثنائياً للنوادر في ${LAKE_ZONE_LABELS[targetZone]}.`;
      coachingTipAr = 'أبحر بالقارب نحو الهاوية واستخدم خطافاً ثلاثياً ثقيلاً لمواجهة العمالقة.';
      bonusBiteMult = 1.15;
      bonusRarityMult = 1.36;
    } else {
      targetZone = 'rocky_ledge';
      titleAr = 'سرب الحافة الصخرية';
      descriptionAr = `دفء التيارات الصخرية يجمع الأسماك المتنوعة قرب ${LAKE_ZONE_LABELS[targetZone]}.`;
      coachingTipAr = 'راقب حركة السمكة تحت الماء بمجرد اقترابها من الطعم لتثبيت الخطاف في اللحظة المثالية.';
      bonusBiteMult = 1.18;
      bonusRarityMult = 1.18;
    }

    return {
      id: `adaptive_${Date.now()}`,
      titleAr,
      descriptionAr,
      coachingTipAr,
      bonusBiteMult,
      bonusRarityMult,
      targetZone,
      source: 'adaptive',
      updatedAt: Date.now(),
    };
  }

  public async evolveLakeEvent(params: {
    level: number;
    weather: WeatherType;
    season: SeasonId;
  }): Promise<AdaptiveLakeEvent> {
    if (this.isBusy) return this.memory.activeEvent;
    this.isBusy = true;
    const summary = this.getTelemetrySummary();

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7500);
      const response = await fetch('/api/ai/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          level: params.level,
          catchesCount: summary.totalCatches,
          snapsCount: summary.totalSnaps,
          crocDevours: summary.totalCrocDevours,
          streakWithoutSnap: summary.streakWithoutSnap,
          skillScore: summary.skillScore,
          favoriteBait: summary.favoriteBait,
          weather: params.weather,
          season: params.season,
        }),
      });
      window.clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as Partial<AdaptiveLakeEvent>;
        if (
          data &&
          typeof data.titleAr === 'string' &&
          typeof data.descriptionAr === 'string' &&
          typeof data.coachingTipAr === 'string' &&
          VALID_ZONES.includes(data.targetZone as LakeZoneId)
        ) {
          const nextEvt: AdaptiveLakeEvent = {
            id: typeof data.id === 'string' ? data.id : `ai_${Date.now()}`,
            titleAr: data.titleAr.slice(0, 64),
            descriptionAr: data.descriptionAr.slice(0, 180),
            coachingTipAr: data.coachingTipAr.slice(0, 180),
            bonusBiteMult: clamp(Number(data.bonusBiteMult) || 1.15, 0.95, 1.38),
            bonusRarityMult: clamp(Number(data.bonusRarityMult) || 1.18, 1.0, 1.48),
            targetZone: data.targetZone as LakeZoneId,
            source: data.source === 'gemini' ? 'gemini' : 'adaptive',
            updatedAt: Date.now(),
          };
          this.memory.activeEvent = nextEvt;
          this.memory.evolveCount += 1;
          this.save();
          return nextEvt;
        }
      }
    } catch {
      // Fallback gracefully to local adaptive generator
    } finally {
      this.isBusy = false;
    }

    const fallbackEvt = this.buildDeterministicLocalEvent(params.weather, params.season);
    this.memory.activeEvent = fallbackEvt;
    this.memory.evolveCount += 1;
    this.save();
    return fallbackEvt;
  }
}
