export type WeatherType = 'clear' | 'cloudy' | 'mist' | 'rain' | 'storm';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export type TimePresetId = 'dawn' | 'morning' | 'noon' | 'sunset' | 'dusk' | 'night';

export type LakeZoneId = 'dock_shade' | 'shore_reeds' | 'rocky_ledge' | 'deep_basin';

export type BaitId = 'worm' | 'fly' | 'spinner' | 'glow_minnow' | 'golden_corn';

export type HookId = 'light_bronze' | 'barbed_steel' | 'circle_pro' | 'heavy_treble';

export type FishBehaviorProfile =
  | 'surface_cruiser'
  | 'schooling'
  | 'ambush'
  | 'bottom_forager'
  | 'deep_hunter';

export type FishingPhase =
  | 'idle'
  | 'charging'
  | 'casting'
  | 'waiting'
  | 'nibbling'
  | 'biting'
  | 'reeling'
  | 'caught';

export type SkillKey = 'castMastery' | 'reelSpeed' | 'lineStrength' | 'anglerSense';

export interface PlayerSkills {
  castMastery: number; // 1..5
  reelSpeed: number; // 1..5
  lineStrength: number; // 1..5
  anglerSense: number; // 1..5
}

export interface PlayerProgression {
  level: number;
  totalXp: number;
  availableXp: number;
  skills: PlayerSkills;
  unlockedBaits: BaitId[];
  unlockedHooks: HookId[];
}

export interface SkillDefinition {
  key: SkillKey;
  nameAr: string;
  effectAr: string;
  maxLevel: number;
  baseCostXp: number;
}

export interface SeasonDefinition {
  id: SeasonId;
  nameAr: string;
  meadowTint: number;
  treeTint: number;
  snowLineOffset: number;
  windMultiplier: number;
  fogMultiplier: number;
  fishActivityBonus: number;
  preferredWeatherWeights: Record<WeatherType, number>;
  descriptionAr: string;
}

export interface BaitDefinition {
  id: BaitId;
  nameAr: string;
  subtitleAr: string;
  unlockLevel: number;
  color: number;
  glow: boolean;
  preferredZones: LakeZoneId[];
  attractionRadius: number;
  biteSpeedBonus: number; // multiplier on curiosity/bite speed
  targetDepthOffset: number; // how deep beneath bobber it hangs
}

export interface HookDefinition {
  id: HookId;
  nameAr: string;
  subtitleAr: string;
  unlockLevel: number;
  biteWindowBonus: number; // extra seconds to react on bite
  tensionTolerance: number; // multiplier on max safe line tension (higher = stronger)
  cautiousAcceptRate: number; // 0..1 how well small/cautious fish accept it
  holdStrength: number; // reduces escape risk while reeling
}

export interface FishSpecies {
  id: string;
  nameAr: string;
  scientificName: string;
  rarity: 'شائع' | 'نادر' | 'أسطوري';
  behavior: FishBehaviorProfile;
  behaviorLabelAr: string;
  preferredZones: LakeZoneId[];
  favoriteBaits: BaitId[];
  idealHooks: HookId[];
  bodyColor: number;
  bellyColor: number;
  finColor: number;
  stripeColor?: number;
  minLengthCm: number;
  maxLengthCm: number;
  baseWeightKg: number;
  preferredDepth: [number, number];
  fightStrength: number;
  speedMultiplier: number;
  activeWeather: WeatherType[];
  activeTimes: TimePresetId[];
  descriptionAr: string;
}

export interface CaughtFishRecord {
  id: string;
  species: FishSpecies;
  lengthCm: number;
  weightKg: number;
  xpEarned: number;
  caughtAtTime: string;
  weather: WeatherType;
  season: SeasonId;
  zone: LakeZoneId;
  baitUsed: BaitId;
  hookUsed: HookId;
  released: boolean;
}

export interface AmbienceMix {
  water: number; // 0..1
  trees: number; // 0..1
  birds: number; // 0..1
}

export interface FishingHudState {
  phase: FishingPhase;
  castPower: number; // 0..1
  lineTension: number; // 0..1
  fishDistance: number; // meters from dock
  fishStamina: number; // 0..1
  biteUrgency: number; // 0..1
  hookedSpeciesName: string | null;
  statusMessage: string;
  timeOfDay: number; // 0..24 hours
  timePreset: TimePresetId;
  autoTimeCycle: boolean;
  season: SeasonId;
  weather: WeatherType;
  autoWeather: boolean;
  windSpeedKmh: number;
  autoWind: boolean;
  fishingConditionLabel: string;
  soundMuted: boolean;
  ambienceMix: AmbienceMix;
  cinematicActive: boolean;
  cinematicAutoEnabled: boolean;
  fishVisibleCount: number;
  selectedBait: BaitId;
  selectedHook: HookId;
  lineDepthMeters: number; // 0.6 | 1.6 | 2.8
  currentCastZone: LakeZoneId | null;
  activeCatch: CaughtFishRecord | null;
  catchHistory: CaughtFishRecord[];
  lineSnappedNotice: string | null;
  progression: PlayerProgression;
  newlyUnlockedNotice: string | null;
}

export const SEASON_CATALOG: SeasonDefinition[] = [
  {
    id: 'spring',
    nameAr: 'الربيع',
    meadowTint: 0x5d9949,
    treeTint: 0x2f6b3a,
    snowLineOffset: 2,
    windMultiplier: 1.0,
    fogMultiplier: 1.15,
    fishActivityBonus: 1.18,
    preferredWeatherWeights: { clear: 35, cloudy: 25, mist: 22, rain: 15, storm: 3 },
    descriptionAr: 'مروج خضراء نضرة، ضباب فجري لطيف ونشاط ممتاز للسلمون والفرخ.',
  },
  {
    id: 'summer',
    nameAr: 'الصيف',
    meadowTint: 0x4b7d3b,
    treeTint: 0x26542f,
    snowLineOffset: 8,
    windMultiplier: 0.85,
    fogMultiplier: 0.75,
    fishActivityBonus: 1.05,
    preferredWeatherWeights: { clear: 52, cloudy: 22, mist: 8, rain: 10, storm: 8 },
    descriptionAr: 'أشعة شمس صافية تنير قاع البحيرة وتزيد نشاط القاروص والشبوط.',
  },
  {
    id: 'autumn',
    nameAr: 'الخريف',
    meadowTint: 0x8f7139,
    treeTint: 0x5c5328,
    snowLineOffset: 0,
    windMultiplier: 1.35,
    fogMultiplier: 1.3,
    fishActivityBonus: 1.24,
    preferredWeatherWeights: { clear: 25, cloudy: 30, mist: 24, rain: 14, storm: 7 },
    descriptionAr: 'أوراق ذهبية دافئة ورياح متقلبة تحفّز الكراكي والشبوط على التغذية.',
  },
  {
    id: 'winter',
    nameAr: 'الشتاء',
    meadowTint: 0x8fa1a3,
    treeTint: 0x2d4a46,
    snowLineOffset: -12,
    windMultiplier: 1.45,
    fogMultiplier: 1.35,
    fishActivityBonus: 0.86,
    preferredWeatherWeights: { clear: 22, cloudy: 28, mist: 26, rain: 16, storm: 8 },
    descriptionAr: 'قمم مكسوة بالثلج وبرودة تبطئ الأسماك الصغيرة بينما تنشط أسماك العمق.',
  },
];

export const SKILL_CATALOG: SkillDefinition[] = [
  {
    key: 'castMastery',
    nameAr: 'دقة ومدى الرمي',
    effectAr: 'يزيد مدى الرمي للوصول إلى الأعماق ويقلل انحراف الطعم بالرياح',
    maxLevel: 5,
    baseCostXp: 60,
  },
  {
    key: 'reelSpeed',
    nameAr: 'سرعة وقوة السحب',
    effectAr: 'يسرّع لف البكرة ويستنزف طاقة السمكة أسرع أثناء السحب',
    maxLevel: 5,
    baseCostXp: 65,
  },
  {
    key: 'lineStrength',
    nameAr: 'متانة الخيط والتحمّل',
    effectAr: 'يرفع قدرة تحمّل الخيط للشدّ ويمنع انقطاعه مع الأسماك الكبيرة',
    maxLevel: 5,
    baseCostXp: 70,
  },
  {
    key: 'anglerSense',
    nameAr: 'حساسية الصياد والغمز',
    effectAr: 'يطيل مهلة الاستجابة عند الغمز ويجذب الأسماك بشكل أسرع',
    maxLevel: 5,
    baseCostXp: 60,
  },
];

export const LEVEL_XP_THRESHOLDS = [0, 120, 300, 560, 900, 1350, 1900, 2600];

export function computeLevelFromXp(totalXp: number): number {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP_THRESHOLDS.length; i++) {
    if (totalXp >= LEVEL_XP_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

export function getNextLevelThreshold(level: number): number {
  return LEVEL_XP_THRESHOLDS[level] ?? LEVEL_XP_THRESHOLDS[LEVEL_XP_THRESHOLDS.length - 1] + (level - 6) * 750;
}

export function getSkillUpgradeCost(skill: SkillDefinition, currentLevel: number): number {
  return Math.round(skill.baseCostXp * Math.pow(1.45, currentLevel - 1));
}

export const LAKE_ZONE_LABELS: Record<LakeZoneId, string> = {
  dock_shade: 'ظل الرصيف القريب',
  shore_reeds: 'ضفة القصب الضحلة',
  rocky_ledge: 'الحافة الصخرية',
  deep_basin: 'حوض البحيرة العميق',
};

export const BAIT_CATALOG: BaitDefinition[] = [
  {
    id: 'worm',
    nameAr: 'دودة حية',
    subtitleAr: 'جيدة لمعظم الأسماك قرب الصخور والرصيف',
    unlockLevel: 1,
    color: 0xc96a5b,
    glow: false,
    preferredZones: ['dock_shade', 'rocky_ledge', 'shore_reeds'],
    attractionRadius: 5.5,
    biteSpeedBonus: 1.15,
    targetDepthOffset: 1.2,
  },
  {
    id: 'fly',
    nameAr: 'ذبابة ملونة',
    subtitleAr: 'مثالية للسلمون والفرخ في المياه الضحلة',
    unlockLevel: 1,
    color: 0xe8b948,
    glow: false,
    preferredZones: ['shore_reeds', 'dock_shade'],
    attractionRadius: 5.2,
    biteSpeedBonus: 1.25,
    targetDepthOffset: 0.55,
  },
  {
    id: 'golden_corn',
    nameAr: 'ذرة عطرية',
    subtitleAr: 'مفضلة لدى الشبوط الذهبي في الأعماق الهادئة',
    unlockLevel: 2,
    color: 0xf4c430,
    glow: false,
    preferredZones: ['shore_reeds', 'rocky_ledge'],
    attractionRadius: 5.8,
    biteSpeedBonus: 1.1,
    targetDepthOffset: 1.8,
  },
  {
    id: 'spinner',
    nameAr: 'طعم دوّار لامع',
    subtitleAr: 'يجذب المفترسات مثل الكراكي والقاروص',
    unlockLevel: 3,
    color: 0xd9e4ec,
    glow: false,
    preferredZones: ['rocky_ledge', 'deep_basin'],
    attractionRadius: 6.8,
    biteSpeedBonus: 1.18,
    targetDepthOffset: 1.5,
  },
  {
    id: 'glow_minnow',
    nameAr: 'سمكة مضيئة',
    subtitleAr: 'للأعماق والليل والضباب وصيد سلمون القمر',
    unlockLevel: 4,
    color: 0x67e8f9,
    glow: true,
    preferredZones: ['deep_basin', 'rocky_ledge'],
    attractionRadius: 7.4,
    biteSpeedBonus: 1.32,
    targetDepthOffset: 2.3,
  },
];

export const HOOK_CATALOG: HookDefinition[] = [
  {
    id: 'light_bronze',
    nameAr: 'خطاف برونزي خفيف',
    subtitleAr: 'قبول عالٍ من الأسماك الحذرة، تحمّل متوسط',
    unlockLevel: 1,
    biteWindowBonus: 0.2,
    tensionTolerance: 0.9,
    cautiousAcceptRate: 1.25,
    holdStrength: 0.9,
  },
  {
    id: 'barbed_steel',
    nameAr: 'خطاف فولاذي مسنن',
    subtitleAr: 'متوازن ويمسك بالسمكة بثبات أثناء السحب',
    unlockLevel: 1,
    biteWindowBonus: 0.35,
    tensionTolerance: 1.08,
    cautiousAcceptRate: 1.0,
    holdStrength: 1.18,
  },
  {
    id: 'circle_pro',
    nameAr: 'خطاف دائري احترافي',
    subtitleAr: 'يقلل شد الخيط ويمنحك وقتاً أطول للغمز',
    unlockLevel: 2,
    biteWindowBonus: 0.75,
    tensionTolerance: 1.22,
    cautiousAcceptRate: 1.05,
    holdStrength: 1.12,
  },
  {
    id: 'heavy_treble',
    nameAr: 'خطاف ثلاثي ثقيل',
    subtitleAr: 'مصمم للأسماك العملاقة والمفترسة في العمق',
    unlockLevel: 4,
    biteWindowBonus: 0.4,
    tensionTolerance: 1.4,
    cautiousAcceptRate: 0.72,
    holdStrength: 1.35,
  },
];

export const WEATHER_OPTIONS: { id: WeatherType; label: string }[] = [
  { id: 'clear', label: 'صحو ومشمس' },
  { id: 'cloudy', label: 'غيوم متفرقة' },
  { id: 'mist', label: 'ضباب الوادي' },
  { id: 'rain', label: 'مطر خفيف' },
  { id: 'storm', label: 'عاصفة رعدية' },
];

export const TIME_PRESETS: { id: TimePresetId; label: string; hour: number }[] = [
  { id: 'dawn', label: 'الفجر', hour: 5.75 },
  { id: 'morning', label: 'الصباح', hour: 9.0 },
  { id: 'noon', label: 'الظهيرة', hour: 13.0 },
  { id: 'sunset', label: 'الغروب', hour: 17.8 },
  { id: 'dusk', label: 'الشفق', hour: 19.2 },
  { id: 'night', label: 'الليل', hour: 23.0 },
];

export const FISH_SPECIES: FishSpecies[] = [
  {
    id: 'rainbow_trout',
    nameAr: 'سلمون قوس قزح',
    scientificName: 'Oncorhynchus mykiss',
    rarity: 'شائع',
    behavior: 'surface_cruiser',
    behaviorLabelAr: 'سباحة سطحية رشيقة',
    preferredZones: ['shore_reeds', 'rocky_ledge'],
    favoriteBaits: ['fly', 'spinner', 'worm'],
    idealHooks: ['light_bronze', 'circle_pro'],
    bodyColor: 0x4b7f78,
    bellyColor: 0xe6ece8,
    finColor: 0x8ea69a,
    stripeColor: 0xd9738a,
    minLengthCm: 28,
    maxLengthCm: 54,
    baseWeightKg: 1.4,
    preferredDepth: [0.55, 1.9],
    fightStrength: 0.48,
    speedMultiplier: 1.08,
    activeWeather: ['clear', 'cloudy', 'mist'],
    activeTimes: ['dawn', 'morning', 'sunset'],
    descriptionAr: 'يسبح قرب السطح الصافي ويفضل الذبابة الملونة عند القصب في الفجر والصباح.',
  },
  {
    id: 'alpine_bass',
    nameAr: 'قاروص المرتفعات',
    scientificName: 'Micropterus alpinus',
    rarity: 'شائع',
    behavior: 'ambush',
    behaviorLabelAr: 'كمين قرب الصخور',
    preferredZones: ['rocky_ledge', 'dock_shade'],
    favoriteBaits: ['worm', 'spinner'],
    idealHooks: ['barbed_steel', 'circle_pro'],
    bodyColor: 0x3b6342,
    bellyColor: 0xd8dfd2,
    finColor: 0x56744e,
    stripeColor: 0x243b27,
    minLengthCm: 24,
    maxLengthCm: 48,
    baseWeightKg: 1.2,
    preferredDepth: [0.8, 2.3],
    fightStrength: 0.56,
    speedMultiplier: 0.96,
    activeWeather: ['clear', 'cloudy', 'rain'],
    activeTimes: ['morning', 'noon', 'sunset'],
    descriptionAr: 'يتربص في ظل الرصيف والحافة الصخرية ثم يندفع فجأة لابتلاع الدودة أو الدوّار.',
  },
  {
    id: 'lake_perch',
    nameAr: 'فرخ البحيرة المخطط',
    scientificName: 'Perca fluviatilis',
    rarity: 'شائع',
    behavior: 'schooling',
    behaviorLabelAr: 'أسراب متناسقة',
    preferredZones: ['dock_shade', 'shore_reeds'],
    favoriteBaits: ['worm', 'fly'],
    idealHooks: ['light_bronze', 'barbed_steel'],
    bodyColor: 0x6f7f43,
    bellyColor: 0xebe6c9,
    finColor: 0xd66838,
    stripeColor: 0x2d381e,
    minLengthCm: 18,
    maxLengthCm: 36,
    baseWeightKg: 0.7,
    preferredDepth: [0.45, 1.7],
    fightStrength: 0.36,
    speedMultiplier: 0.92,
    activeWeather: ['clear', 'cloudy', 'mist', 'rain'],
    activeTimes: ['morning', 'noon', 'dusk'],
    descriptionAr: 'يتحرك في أسراب قرب الأعشاب وظل الرصيف ويستجيب سريعاً للخطاف البرونزي الخفيف.',
  },
  {
    id: 'golden_carp',
    nameAr: 'الشبوط الذهبي',
    scientificName: 'Cyprinus auratus',
    rarity: 'نادر',
    behavior: 'bottom_forager',
    behaviorLabelAr: 'تغذية قاعية حذرة',
    preferredZones: ['rocky_ledge', 'shore_reeds'],
    favoriteBaits: ['golden_corn', 'worm'],
    idealHooks: ['circle_pro', 'light_bronze'],
    bodyColor: 0xd48b2a,
    bellyColor: 0xf6de9c,
    finColor: 0xe6a83c,
    stripeColor: 0xb85f19,
    minLengthCm: 34,
    maxLengthCm: 68,
    baseWeightKg: 2.8,
    preferredDepth: [1.4, 3.2],
    fightStrength: 0.68,
    speedMultiplier: 0.84,
    activeWeather: ['clear', 'mist', 'rain'],
    activeTimes: ['dawn', 'sunset', 'dusk'],
    descriptionAr: 'يجوب قاع البحيرة ببطء وحذر؛ يعشق الذرة العطرية ويتطلب صبراً عند الغمز.',
  },
  {
    id: 'northern_pike',
    nameAr: 'كراكي الوادي الفضي',
    scientificName: 'Esox lucius',
    rarity: 'نادر',
    behavior: 'deep_hunter',
    behaviorLabelAr: 'مفترس عميق سريع',
    preferredZones: ['deep_basin', 'rocky_ledge'],
    favoriteBaits: ['spinner', 'glow_minnow'],
    idealHooks: ['heavy_treble', 'barbed_steel'],
    bodyColor: 0x3b5b49,
    bellyColor: 0xdde5dd,
    finColor: 0x6e856d,
    stripeColor: 0x99b389,
    minLengthCm: 48,
    maxLengthCm: 92,
    baseWeightKg: 4.5,
    preferredDepth: [1.8, 3.8],
    fightStrength: 0.84,
    speedMultiplier: 1.25,
    activeWeather: ['cloudy', 'rain', 'storm'],
    activeTimes: ['dawn', 'dusk', 'night'],
    descriptionAr: 'صياد شرس في الأعماق يطارد الطعم الدوّار والمضيء في الغيوم والمطر بقوة سحب عالية.',
  },
  {
    id: 'moonlight_salmon',
    nameAr: 'سلمون القمر الملكي',
    scientificName: 'Salmo lunaris',
    rarity: 'أسطوري',
    behavior: 'deep_hunter',
    behaviorLabelAr: 'مطاردة ليلية مهيبة',
    preferredZones: ['deep_basin'],
    favoriteBaits: ['glow_minnow', 'spinner'],
    idealHooks: ['heavy_treble', 'circle_pro'],
    bodyColor: 0x456990,
    bellyColor: 0xeef5fb,
    finColor: 0x8bb6d9,
    stripeColor: 0xcce8ff,
    minLengthCm: 58,
    maxLengthCm: 105,
    baseWeightKg: 6.4,
    preferredDepth: [2.2, 4.4],
    fightStrength: 0.94,
    speedMultiplier: 1.32,
    activeWeather: ['mist', 'storm', 'clear'],
    activeTimes: ['dusk', 'night', 'dawn'],
    descriptionAr: 'جوهرة الحوض العميق؛ يظهر ليلاً وعند الضباب وينجذب بقوة للسمكة المضيئة.',
  },
];

export interface LiveRadioStation {
  id: string;
  nameAr: string;
  genreAr: string;
  category: 'arabic' | 'chill';
  streamUrl: string;
  fallbackUrls?: string[];
}

export const LIVE_RADIO_STATIONS: LiveRadioStation[] = [
  {
    id: 'eg_nogoum_fm',
    nameAr: 'نجوم إف إم 100.6 (مصر)',
    genreAr: 'إف إم مصرية · أغاني عربية',
    category: 'arabic',
    streamUrl: 'https://stream.zeno.fm/qb1zvsykm98uv',
    fallbackUrls: ['https://radiohits882.radioca.st/;', 'https://stream.zeno.fm/na3vpvn10qruv'],
  },
  {
    id: 'eg_hits_882',
    nameAr: 'راديو هيتس 88.2 (القاهرة)',
    genreAr: 'إف إم مصرية · منوعات عربية',
    category: 'arabic',
    streamUrl: 'https://radiohits882.radioca.st/;',
    fallbackUrls: ['https://stream.zeno.fm/qb1zvsykm98uv', 'https://stream.zeno.fm/na3vpvn10qruv'],
  },
  {
    id: 'eg_om_kalthom',
    nameAr: 'أم كلثوم — طرب أصيل',
    genreAr: 'طرب مصري كلاسيكي',
    category: 'arabic',
    streamUrl: 'https://stream.zeno.fm/zsgrfxg71s8uv',
    fallbackUrls: ['https://stream.zeno.fm/wvqgc9kb1d0uv'],
  },
  {
    id: 'eg_arab_mix',
    nameAr: 'ميكس إف إم عربي 87.8',
    genreAr: 'أغاني عربية متواصلة',
    category: 'arabic',
    streamUrl: 'https://stream.zeno.fm/na3vpvn10qruv',
    fallbackUrls: ['https://stream.zeno.fm/wvqgc9kb1d0uv', 'https://radiohits882.radioca.st/;'],
  },
  {
    id: 'eg_90s_fm',
    nameAr: 'تسعينات إف إم (مصر)',
    genreAr: 'نوشتالجيا وأغاني التسعينات',
    category: 'arabic',
    streamUrl: 'https://eu1.fastcast4u.com/proxy/prontofm?mp=/1',
    fallbackUrls: ['https://stream.zeno.fm/xa4yhh4k838uv'],
  },
  {
    id: 'eg_amr_diab',
    nameAr: 'راديو عمرو دياب ورومانسيات',
    genreAr: 'بث عربي هادئ ورومانسي',
    category: 'arabic',
    streamUrl: 'https://stream.zeno.fm/xa4yhh4k838uv',
    fallbackUrls: ['https://stream.zeno.fm/v7n499m8ckhvv'],
  },
  {
    id: 'eg_sha3by_95',
    nameAr: 'شعبي إف إم 95 (مصر)',
    genreAr: 'إف إم مصرية · إيقاعات شعبية',
    category: 'arabic',
    streamUrl: 'https://radio95.radioca.st/;',
    fallbackUrls: ['https://stream.zeno.fm/qb1zvsykm98uv'],
  },
  {
    id: 'rp_mellow',
    nameAr: 'موسيقى هادئة للطبيعة',
    genreAr: 'هادئة · بث عالمي مباشر',
    category: 'chill',
    streamUrl: 'https://stream.radioparadise.com/mellow-128',
    fallbackUrls: ['https://stream.radioparadise.com/mp3-128', 'https://ice2.somafm.com/folkfwd-128-mp3'],
  },
  {
    id: 'somafm_folk',
    nameAr: 'نسيم الريف والأكوستيك',
    genreAr: 'أكوستيك وفولك لايف',
    category: 'chill',
    streamUrl: 'https://ice2.somafm.com/folkfwd-128-mp3',
    fallbackUrls: ['https://ice1.somafm.com/folkfwd-128-mp3', 'https://stream.radioparadise.com/mp3-128'],
  },
  {
    id: 'somafm_groove',
    nameAr: 'أمسيات البحيرة الهادئة',
    genreAr: 'تشيل أوت وأمبيانت',
    category: 'chill',
    streamUrl: 'https://ice4.somafm.com/groovesalad-128-mp3',
    fallbackUrls: ['https://ice1.somafm.com/groovesalad-128-mp3', 'https://ice4.somafm.com/lush-128-mp3'],
  },
];

export function formatHourToClock(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const h = Math.floor(normalized);
  const m = Math.floor((normalized - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getPresetFromHour(hour: number): TimePresetId {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 11.5) return 'morning';
  if (h >= 11.5 && h < 16.5) return 'noon';
  if (h >= 16.5 && h < 18.5) return 'sunset';
  if (h >= 18.5 && h < 20.5) return 'dusk';
  return 'night';
}

export function classifyLakeZone(x: number, z: number, waterDepth: number): LakeZoneId {
  const distFromDock = Math.hypot(x, z - 2.0);
  if (distFromDock < 11.5) return 'dock_shade';
  if (waterDepth < 1.65 || Math.abs(x) > 25.0) return 'shore_reeds';
  if (waterDepth > 2.95 && z < -16) return 'deep_basin';
  return 'rocky_ledge';
}
