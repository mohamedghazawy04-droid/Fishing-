import type {
  NotificationCategory,
  SmartNotificationFeedItem,
  SmartNotificationMode,
  SmartNotificationToast,
  SmartNotificationsHudState,
} from '../types/fishing';

const STORAGE_MODE_KEY = 'alpine_fishing_smart_notif_mode_v1';

interface EventBucket {
  seenCount: number;
  lastToastAt: number;
  lastLoggedAt: number;
}

export interface PushSmartNotificationParams {
  eventKey: string;
  category: NotificationCategory;
  titleAr: string;
  detailAr?: string;
  xpTag?: string;
  durationSec?: number;
  cooldownSec?: number;
  maxToastRepeats?: number;
}

const PRIORITY_WEIGHT: Record<NotificationCategory, number> = {
  critical: 4,
  achievement: 3,
  rival: 2,
  ambient: 1,
};

function loadSavedMode(): SmartNotificationMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_MODE_KEY);
    if (raw === 'smart' || raw === 'essential' || raw === 'all') {
      return raw;
    }
  } catch {
    // Ignore storage issues
  }
  return 'smart';
}

function saveMode(mode: SmartNotificationMode): void {
  try {
    window.localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // Ignore storage issues
  }
}

function formatClockLabel(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export class SmartNotificationEngine {
  private mode: SmartNotificationMode = loadSavedMode();
  private buckets = new Map<string, EventBucket>();
  private feed: SmartNotificationFeedItem[] = [];
  private activeToast: SmartNotificationToast | null = null;
  private activeTimer = 0;
  private unreadCount = 0;
  private suppressedTotal = 0;
  private seq = 0;

  public push(params: PushSmartNotificationParams): { shownAsToast: boolean; stateChanged: boolean } {
    const now = Date.now();
    const bucket = this.buckets.get(params.eventKey) ?? {
      seenCount: 0,
      lastToastAt: 0,
      lastLoggedAt: 0,
    };

    // Guard against tight back-to-back duplicate spam within 2.5s
    if (now - bucket.lastLoggedAt < 2500 && bucket.seenCount > 0) {
      return { shownAsToast: false, stateChanged: false };
    }

    bucket.seenCount += 1;
    bucket.lastLoggedAt = now;
    this.buckets.set(params.eventKey, bucket);

    const shouldToast = this.evaluateToastPolicy(params, bucket, now);

    // Update grouped feed (collapse consecutive/recent same eventKey to avoid noisy feed clutter)
    const existingFeedIdx = this.feed.findIndex(
      (item) => item.eventKey === params.eventKey && item.titleAr === params.titleAr,
    );
    const timeLabel = formatClockLabel();
    if (existingFeedIdx >= 0 && existingFeedIdx < 6) {
      const prev = this.feed[existingFeedIdx];
      const updated: SmartNotificationFeedItem = {
        ...prev,
        detailAr: params.detailAr ?? prev.detailAr,
        xpTag: params.xpTag ?? prev.xpTag,
        repeatCount: prev.repeatCount + 1,
        timeLabel,
        wasSuppressed: !shouldToast,
      };
      this.feed.splice(existingFeedIdx, 1);
      this.feed.unshift(updated);
    } else {
      this.seq += 1;
      this.feed.unshift({
        id: `sn_${this.seq}_${now}`,
        eventKey: params.eventKey,
        category: params.category,
        titleAr: params.titleAr,
        detailAr: params.detailAr,
        xpTag: params.xpTag,
        repeatCount: 1,
        timeLabel,
        wasSuppressed: !shouldToast,
      });
      if (this.feed.length > 28) {
        this.feed.length = 28;
      }
    }

    if (!shouldToast) {
      this.suppressedTotal += 1;
      this.unreadCount += 1;
      return { shownAsToast: false, stateChanged: true };
    }

    // Check active single-slot toast priority (never stack overlapping banners)
    if (this.activeToast && this.activeTimer > 0) {
      const currentPrio = PRIORITY_WEIGHT[this.activeToast.category];
      const nextPrio = PRIORITY_WEIGHT[params.category];
      if (nextPrio < currentPrio && this.activeToast.eventKey !== params.eventKey) {
        this.suppressedTotal += 1;
        this.unreadCount += 1;
        return { shownAsToast: false, stateChanged: true };
      }
    }

    bucket.lastToastAt = now;
    this.seq += 1;
    this.activeToast = {
      id: `toast_${this.seq}`,
      eventKey: params.eventKey,
      category: params.category,
      titleAr: params.titleAr,
      detailAr: params.detailAr,
      xpTag: params.xpTag,
      repeatCount: bucket.seenCount,
    };
    this.activeTimer = params.durationSec ?? (params.category === 'critical' ? 3.4 : 2.9);
    return { shownAsToast: true, stateChanged: true };
  }

  private evaluateToastPolicy(
    params: PushSmartNotificationParams,
    bucket: EventBucket,
    now: number,
  ): boolean {
    const elapsedSinceToastSec = (now - bucket.lastToastAt) / 1000;

    if (this.mode === 'all') {
      const minCooldown = params.category === 'critical' ? 4 : 10;
      return bucket.lastToastAt === 0 || elapsedSinceToastSec >= minCooldown;
    }

    if (this.mode === 'essential') {
      if (params.category === 'critical') {
        return bucket.lastToastAt === 0 || elapsedSinceToastSec >= 10;
      }
      if (params.category === 'achievement') {
        return bucket.seenCount <= 2 || elapsedSinceToastSec >= 30;
      }
      return false;
    }

    // Smart Mode (default): adaptive frequency backoff + repeat capping
    if (params.category === 'critical') {
      const cd = params.cooldownSec ?? 14;
      return bucket.lastToastAt === 0 || elapsedSinceToastSec >= cd;
    }

    if (params.category === 'achievement') {
      const cd = params.cooldownSec ?? 6;
      return bucket.lastToastAt === 0 || elapsedSinceToastSec >= cd;
    }

    // For 'rival' and 'ambient' events:
    // Show first time cleanly, optionally a second time only after long cooldown,
    // then automatically transition to silent Activity Log tracking so the screen stays calm!
    const maxRepeats = params.maxToastRepeats ?? (params.category === 'ambient' ? 1 : 2);
    if (bucket.seenCount > maxRepeats) {
      return false;
    }
    const baseCooldown = params.cooldownSec ?? (params.category === 'ambient' ? 65 : 42);
    const adaptiveCooldown = baseCooldown * Math.pow(1.6, Math.max(0, bucket.seenCount - 1));
    return bucket.lastToastAt === 0 || elapsedSinceToastSec >= adaptiveCooldown;
  }

  public tick(dt: number): boolean {
    if (!this.activeToast) return false;
    this.activeTimer -= dt;
    if (this.activeTimer <= 0) {
      this.activeToast = null;
      this.activeTimer = 0;
      return true;
    }
    return false;
  }

  public dismissActive(): void {
    this.activeToast = null;
    this.activeTimer = 0;
  }

  public setMode(mode: SmartNotificationMode): void {
    this.mode = mode;
    saveMode(mode);
  }

  public markAllRead(): void {
    this.unreadCount = 0;
  }

  public clearFeed(): void {
    this.feed = [];
    this.unreadCount = 0;
    this.suppressedTotal = 0;
  }

  public getState(): SmartNotificationsHudState {
    return {
      mode: this.mode,
      activeToast: this.activeToast,
      unreadCount: this.unreadCount,
      suppressedTotal: this.suppressedTotal,
      feed: this.feed,
    };
  }
}
