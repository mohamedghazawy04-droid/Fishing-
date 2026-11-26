import type { AmbienceMix, SeasonId, WeatherType } from '../types/fishing';

export interface AudioLocationContext {
  isOnBoat: boolean;
  isSailing: boolean;
  boatSpeedNorm: number; // 0..1
  waterDepthMeters: number;
  shoreProximity: number; // 0 (open center lake) .. 1 (wooden pier / shoreline)
  nearCaveOrRock: number; // 0..1 proximity to cave / rocky cliffs
  waterfallProximity?: number; // 0 (distant pier) .. 1 (north shoreline near alpine cascade)
}

export interface WeatherSoundContext {
  season: SeasonId;
  coldIntensity: number; // 0..1 smooth frost/winter chill
  stormApproach: number; // 0..1 gradual buildup when storm is approaching or overhead
  rainIntensity: number; // 0..1 liquid rainfall intensity
  snowIntensity: number; // 0..1 quiet snowfall intensity
  mistDensity: number; // 0..1 fog/mist acoustic stillness
}

export class NatureSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private valleyEchoSend: GainNode | null = null;

  // Ambient continuous layers
  private waterGain: GainNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;
  private boatWaveGain: GainNode | null = null;
  private boatWaveFilter: BiquadFilterNode | null = null;
  private boatWakeGain: GainNode | null = null;
  private windLowGain: GainNode | null = null;
  private windLowFilter: BiquadFilterNode | null = null;
  private treeRustleLeftGain: GainNode | null = null;
  private treeRustleRightGain: GainNode | null = null;
  private treeRustleLeftFilter: BiquadFilterNode | null = null;
  private treeRustleRightFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private snowHushGain: GainNode | null = null;
  private snowHushFilter: BiquadFilterNode | null = null;
  private frostWindGain: GainNode | null = null;
  private frostWindFilter: BiquadFilterNode | null = null;
  private stormRumbleGain: GainNode | null = null;
  private stormRumbleFilter: BiquadFilterNode | null = null;
  private waterfallGain: GainNode | null = null;
  private waterfallFilter: BiquadFilterNode | null = null;

  private muted = false;
  private initialized = false;
  private mix: AmbienceMix = {
    water: 0.78,
    trees: 0.72,
    birds: 0.75,
    frogs: 0.76,
  };

  private lastAmbienceElapsed = -1;
  private smoothRain = 0;
  private smoothSnow = 0;
  private smoothStorm = 0;
  private smoothMist = 0;
  private smoothCold = 0;

  private lastBirdTime = 0;
  private nextBirdInterval = 3.2;
  private lastFrogTime = 0;
  private nextFrogInterval = 4.6;
  private lastFrogPreviewAt = 0;
  private lastHawkTime = 0;
  private lastBubbleTime = 0;
  private lastHullWaveTime = 0;
  private nextHullWaveInterval = 1.8;
  private lastDistantThunderTime = 0;
  private nextDistantThunderInterval = 6.5;
  private lastSnowShimmerTime = 0;
  private nextSnowShimmerInterval = 2.0;
  private lastMistDropTime = 0;
  private lastReelClickTime = 0;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Warm Alpine Valley Echo Bus (soft cross-channel mountain reflection for birds & water trickles)
      const echoSend = ctx.createGain();
      echoSend.gain.value = 0.28;
      const delayL = ctx.createDelay(1.0);
      delayL.delayTime.value = 0.23;
      const delayR = ctx.createDelay(1.0);
      delayR.delayTime.value = 0.34;
      const echoDamp = ctx.createBiquadFilter();
      echoDamp.type = 'lowpass';
      echoDamp.frequency.value = 1450;
      const fbL = ctx.createGain();
      fbL.gain.value = 0.24;
      const fbR = ctx.createGain();
      fbR.gain.value = 0.22;
      const panL = this.createPanner(ctx, -0.55);
      const panR = this.createPanner(ctx, 0.55);

      echoSend.connect(echoDamp);
      echoDamp.connect(delayL);
      echoDamp.connect(delayR);
      delayL.connect(fbL);
      fbL.connect(delayR);
      delayR.connect(fbR);
      fbR.connect(delayL);
      delayL.connect(panL);
      delayR.connect(panR);
      panL.connect(master);
      panR.connect(master);
      this.valleyEchoSend = echoSend;

      const brownBuffer = this.createBrownNoiseBuffer(ctx, 5);
      const pinkBuffer = this.createPinkNoiseBuffer(ctx, 5);

      // 1. Babbling & Lapping Lake Water Layer (خرير المياه وحركة الموج)
      const waterSrc = ctx.createBufferSource();
      waterSrc.buffer = brownBuffer;
      waterSrc.loop = true;
      const waterFilter = ctx.createBiquadFilter();
      waterFilter.type = 'bandpass';
      waterFilter.frequency.value = 310;
      waterFilter.Q.value = 0.65;
      const waterGain = ctx.createGain();
      waterGain.gain.value = 0.14 * this.mix.water;
      waterSrc.connect(waterFilter);
      waterFilter.connect(waterGain);
      waterGain.connect(master);
      waterSrc.start();
      this.waterGain = waterGain;
      this.waterFilter = waterFilter;

      // 1b. Deep Crashing Wave & Boat Hull Swell Layer (أقوى على متن القارب وفي الأعماق)
      const boatWaveSrc = ctx.createBufferSource();
      boatWaveSrc.buffer = brownBuffer;
      boatWaveSrc.loop = true;
      const boatWaveFilter = ctx.createBiquadFilter();
      boatWaveFilter.type = 'lowpass';
      boatWaveFilter.frequency.value = 210;
      boatWaveFilter.Q.value = 1.25;
      const boatWaveGain = ctx.createGain();
      boatWaveGain.gain.value = 0;
      boatWaveSrc.connect(boatWaveFilter);
      boatWaveFilter.connect(boatWaveGain);
      boatWaveGain.connect(master);
      boatWaveSrc.start(0, 1.3);
      this.boatWaveGain = boatWaveGain;
      this.boatWaveFilter = boatWaveFilter;

      // 1c. Boat Wake & Bow Foam Splash Hiss (رذاذ مقدمة القارب أثناء الإبحار)
      const wakeSrc = ctx.createBufferSource();
      wakeSrc.buffer = pinkBuffer;
      wakeSrc.loop = true;
      const wakeFilter = ctx.createBiquadFilter();
      wakeFilter.type = 'bandpass';
      wakeFilter.frequency.value = 880;
      wakeFilter.Q.value = 0.7;
      const boatWakeGain = ctx.createGain();
      boatWakeGain.gain.value = 0;
      wakeSrc.connect(wakeFilter);
      wakeFilter.connect(boatWakeGain);
      boatWakeGain.connect(master);
      wakeSrc.start(0, 0.7);
      this.boatWakeGain = boatWakeGain;

      // 2. Gentle Valley Breeze (low-frequency mountain air)
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = brownBuffer;
      windSrc.loop = true;
      const windLowFilter = ctx.createBiquadFilter();
      windLowFilter.type = 'lowpass';
      windLowFilter.frequency.value = 340;
      windLowFilter.Q.value = 1.1;
      const windLowGain = ctx.createGain();
      windLowGain.gain.value = 0.08 * this.mix.trees;
      windSrc.connect(windLowFilter);
      windLowFilter.connect(windLowGain);
      windLowGain.connect(master);
      windSrc.start();
      this.windLowGain = windLowGain;
      this.windLowFilter = windLowFilter;

      // 3. Stereo Tree Foliage Rustle Layers (حفيف الأشجار والصنوبر يميناً ويساراً)
      const treeSrcL = ctx.createBufferSource();
      treeSrcL.buffer = pinkBuffer;
      treeSrcL.loop = true;
      const treeFilterL = ctx.createBiquadFilter();
      treeFilterL.type = 'bandpass';
      treeFilterL.frequency.value = 1180;
      treeFilterL.Q.value = 0.85;
      const treeGainL = ctx.createGain();
      treeGainL.gain.value = 0.032 * this.mix.trees;
      const treePanL = this.createPanner(ctx, -0.62);
      treeSrcL.connect(treeFilterL);
      treeFilterL.connect(treeGainL);
      treeGainL.connect(treePanL);
      treePanL.connect(master);
      treeSrcL.start(0, 0.3);
      this.treeRustleLeftGain = treeGainL;
      this.treeRustleLeftFilter = treeFilterL;

      const treeSrcR = ctx.createBufferSource();
      treeSrcR.buffer = pinkBuffer;
      treeSrcR.loop = true;
      const treeFilterR = ctx.createBiquadFilter();
      treeFilterR.type = 'bandpass';
      treeFilterR.frequency.value = 1360;
      treeFilterR.Q.value = 0.9;
      const treeGainR = ctx.createGain();
      treeGainR.gain.value = 0.028 * this.mix.trees;
      const treePanR = this.createPanner(ctx, 0.62);
      treeSrcR.connect(treeFilterR);
      treeFilterR.connect(treeGainR);
      treeGainR.connect(treePanR);
      treePanR.connect(master);
      treeSrcR.start(0, 2.1);
      this.treeRustleRightGain = treeGainR;
      this.treeRustleRightFilter = treeFilterR;

      // 4. Rain Patter Layer (warmly crossfaded with rain intensity)
      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = pinkBuffer;
      rainSrc.loop = true;
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'highpass';
      rainFilter.frequency.value = 1450;
      const rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rainSrc.connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(master);
      rainSrc.start();
      this.rainGain = rainGain;
      this.rainFilter = rainFilter;

      // 5. Quiet Falling Snow Velvet Hush (صوت تساقط الثلوج الهادئ في الأجواء الباردة)
      const snowSrc = ctx.createBufferSource();
      snowSrc.buffer = pinkBuffer;
      snowSrc.loop = true;
      const snowHushFilter = ctx.createBiquadFilter();
      snowHushFilter.type = 'bandpass';
      snowHushFilter.frequency.value = 2350;
      snowHushFilter.Q.value = 0.55;
      const snowHushGain = ctx.createGain();
      snowHushGain.gain.value = 0;
      snowSrc.connect(snowHushFilter);
      snowHushFilter.connect(snowHushGain);
      snowHushGain.connect(master);
      snowSrc.start(0, 1.6);
      this.snowHushGain = snowHushGain;
      this.snowHushFilter = snowHushFilter;

      // 6. Crisp Winter Frost Breeze Shimmer (نسيم الصقيع البارد)
      const frostSrc = ctx.createBufferSource();
      frostSrc.buffer = pinkBuffer;
      frostSrc.loop = true;
      const frostWindFilter = ctx.createBiquadFilter();
      frostWindFilter.type = 'bandpass';
      frostWindFilter.frequency.value = 540;
      frostWindFilter.Q.value = 2.6;
      const frostWindGain = ctx.createGain();
      frostWindGain.gain.value = 0;
      frostSrc.connect(frostWindFilter);
      frostWindFilter.connect(frostWindGain);
      frostWindGain.connect(master);
      frostSrc.start(0, 3.1);
      this.frostWindGain = frostWindGain;
      this.frostWindFilter = frostWindFilter;

      // 7. Distant Approaching Storm Sub-Rumble Bed (هدير العاصفة المقتربة)
      const stormSrc = ctx.createBufferSource();
      stormSrc.buffer = brownBuffer;
      stormSrc.loop = true;
      const stormRumbleFilter = ctx.createBiquadFilter();
      stormRumbleFilter.type = 'lowpass';
      stormRumbleFilter.frequency.value = 88;
      stormRumbleFilter.Q.value = 1.35;
      const stormRumbleGain = ctx.createGain();
      stormRumbleGain.gain.value = 0;
      stormSrc.connect(stormRumbleFilter);
      stormRumbleFilter.connect(stormRumbleGain);
      stormRumbleGain.connect(master);
      stormSrc.start(0, 2.5);
      this.stormRumbleGain = stormRumbleGain;
      this.stormRumbleFilter = stormRumbleFilter;

      // 8. Distant Horizon Waterfall Cascade Roar & Mist Shimmer (هدير الشلال البعيد في الأفق)
      const wfSrc = ctx.createBufferSource();
      wfSrc.buffer = pinkBuffer;
      wfSrc.loop = true;
      const wfFilter = ctx.createBiquadFilter();
      wfFilter.type = 'lowpass';
      wfFilter.frequency.value = 540;
      wfFilter.Q.value = 0.7;
      const wfGain = ctx.createGain();
      wfGain.gain.value = 0;
      const wfPan = this.createPanner(ctx, -0.06);
      wfSrc.connect(wfFilter);
      wfFilter.connect(wfGain);
      wfGain.connect(wfPan);
      wfPan.connect(master);
      wfSrc.start(0, 1.8);
      this.waterfallGain = wfGain;
      this.waterfallFilter = wfFilter;

      this.initialized = true;
    } catch {
      // AudioContext unavailable
    }
  }

  private createPanner(ctx: AudioContext, pan: number): StereoPannerNode | GainNode {
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    return ctx.createGain();
  }

  private createBrownNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.035 * white) / 1.035;
      data[i] = lastOut * 2.5;
    }
    return buffer;
  }

  private createPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.075;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.08);
    }
  }

  public setAmbienceMix(partial: Partial<AmbienceMix>): void {
    const prevFrogs = this.mix.frogs;
    const nextFrogs =
      partial.frogs !== undefined ? Math.max(0, Math.min(1, partial.frogs)) : this.mix.frogs;
    this.mix = {
      water: partial.water !== undefined ? Math.max(0, Math.min(1, partial.water)) : this.mix.water,
      trees: partial.trees !== undefined ? Math.max(0, Math.min(1, partial.trees)) : this.mix.trees,
      birds: partial.birds !== undefined ? Math.max(0, Math.min(1, partial.birds)) : this.mix.birds,
      frogs: nextFrogs,
    };

    if (partial.frogs !== undefined && nextFrogs > 0.08 && nextFrogs >= prevFrogs) {
      const nowMs = performance.now();
      if (nowMs - this.lastFrogPreviewAt > 650) {
        this.lastFrogPreviewAt = nowMs;
        this.playFrogCroak((Math.random() - 0.5) * 0.6);
      }
    }
  }

  public getAmbienceMix(): AmbienceMix {
    return { ...this.mix };
  }

  public updateAmbience(
    weather: WeatherType,
    hour: number,
    elapsed: number,
    windSpeedKmh = 8,
    location: AudioLocationContext = {
      isOnBoat: false,
      isSailing: false,
      boatSpeedNorm: 0,
      waterDepthMeters: 1.4,
      shoreProximity: 1,
      nearCaveOrRock: 0,
    },
    weatherCtx?: WeatherSoundContext,
  ): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;
    const dt =
      this.lastAmbienceElapsed >= 0
        ? Math.max(0.001, Math.min(0.25, elapsed - this.lastAmbienceElapsed))
        : 0.016;
    this.lastAmbienceElapsed = elapsed;

    // Smooth internal weather envelope crossfading (~2.2s natural fade on weather transitions)
    const isWinter = weatherCtx?.season === 'winter';
    const targetCold = weatherCtx ? weatherCtx.coldIntensity : 0;
    const rawPrecip = weather === 'storm' ? 1.0 : weather === 'rain' ? 0.68 : 0;
    const targetSnow = weatherCtx
      ? weatherCtx.snowIntensity
      : isWinter
        ? rawPrecip
        : 0;
    const targetRain = weatherCtx
      ? weatherCtx.rainIntensity
      : isWinter
        ? 0
        : rawPrecip;
    const targetStorm = weatherCtx
      ? weatherCtx.stormApproach
      : weather === 'storm'
        ? 1.0
        : weather === 'rain'
          ? 0.25
          : 0;
    const targetMist = weatherCtx
      ? weatherCtx.mistDensity
      : weather === 'mist'
        ? 1.0
        : weather === 'cloudy'
          ? 0.3
          : 0;

    const fadeAlpha = 1 - Math.exp(-dt * 0.55);
    this.smoothRain += (targetRain - this.smoothRain) * fadeAlpha;
    this.smoothSnow += (targetSnow - this.smoothSnow) * fadeAlpha;
    this.smoothStorm += (targetStorm - this.smoothStorm) * fadeAlpha;
    this.smoothMist += (targetMist - this.smoothMist) * fadeAlpha;
    this.smoothCold += (targetCold - this.smoothCold) * fadeAlpha;

    const windNorm = Math.max(0, Math.min(1.2, windSpeedKmh / 35));
    const shore = Math.max(0, Math.min(1, location.shoreProximity));
    const openWater = 1 - shore;
    const depthNorm = Math.max(0, Math.min(1, (location.waterDepthMeters - 1.2) / 10.5));
    const boatMove = Math.max(0, Math.min(1, location.boatSpeedNorm));

    const gustL = 0.65 + 0.35 * Math.sin(elapsed * 0.28 + Math.sin(elapsed * 0.11));
    const gustR = 0.65 + 0.35 * Math.sin(elapsed * 0.24 + 1.4 + Math.cos(elapsed * 0.13));

    // Snowfall & cold frost gently mute sharp splash treble for natural winter hush
    const winterMuteFactor = 1 - this.smoothSnow * 0.34 - this.smoothCold * 0.12 - this.smoothMist * 0.14;

    // Crashing & lapping waves intensify significantly when aboard the boat & in open/deep lake waters
    const boatBoost = location.isOnBoat ? 1.65 + openWater * 0.45 + boatMove * 0.35 : 1.0;
    const waveCycleFreq = location.isOnBoat ? 0.92 : 0.66;
    const waveSwell = (location.isOnBoat ? 0.62 : 0.74) + (location.isOnBoat ? 0.38 : 0.26) * Math.sin(elapsed * waveCycleFreq);
    const waterBase = (0.11 + windNorm * 0.15 + this.smoothStorm * 0.06) * waveSwell * boatBoost * winterMuteFactor;
    const waterTarget = waterBase * this.mix.water;
    const waterFreq =
      ((location.isOnBoat ? 320 : 250) + windNorm * 230 + openWater * 75 + Math.sin(elapsed * waveCycleFreq) * 85) *
      (1 - this.smoothSnow * 0.28 - this.smoothMist * 0.18);

    // Deep hull wave surge & bow wake hiss (audible only on boat / deep open water)
    const hullSwell = 0.55 + 0.45 * Math.sin(elapsed * 1.15 + 0.8);
    const boatWaveTarget = location.isOnBoat
      ? (0.11 + depthNorm * 0.12 + windNorm * 0.12 + boatMove * 0.09) * hullSwell * this.mix.water
      : 0.02 * openWater * this.mix.water;
    const boatWaveFreq = 165 + windNorm * 140 + boatMove * 180 + Math.sin(elapsed * 1.15) * 55;
    const wakeTarget = location.isOnBoat ? boatMove * (0.075 + windNorm * 0.03) * this.mix.water : 0;

    // Shoreline trees & forest foliage rustle (softened slightly in snowy winter hush)
    const shoreTreeScale = 0.36 + 0.74 * shore;
    const openWindBoost = 1.0 + 0.36 * openWater;
    const windLowTarget =
      (0.045 + windNorm * 0.21 + this.smoothStorm * 0.075) * openWindBoost * this.mix.trees;
    const rustleBase =
      (0.015 + windNorm * 0.088) * shoreTreeScale * (1 - this.smoothSnow * 0.38) * this.mix.trees;
    const rustleFreq = (920 + windNorm * 880) * (1 - this.smoothSnow * 0.22);

    // Valley/Cave/Mist acoustic reflection depth
    const echoTarget = 0.24 + Math.max(location.nearCaveOrRock * 0.22, openWater * 0.14, this.smoothMist * 0.16);
    this.valleyEchoSend?.gain.setTargetAtTime(echoTarget, now, 0.9);

    // Gradual weather-specific acoustic beds: liquid rain vs quiet falling snow vs storm rumble vs frost breeze
    const rainTarget = this.smoothRain * 0.23 * (1 - this.smoothSnow * 0.9);
    const rainCutoff = 1650 - this.smoothRain * 420 - this.smoothStorm * 180;
    const snowHushTarget =
      (this.smoothSnow * 0.068 + Math.max(0, this.smoothCold - 0.35) * 0.022 * (0.35 + windNorm * 0.65)) *
      (0.75 + 0.25 * Math.sin(elapsed * 0.42));
    const snowHushFreq = 2150 + Math.sin(elapsed * 0.31) * 240 + windNorm * 320;
    const frostWindTarget =
      Math.max(0, this.smoothCold - 0.28) * (0.014 + windNorm * 0.032) * (0.6 + 0.4 * Math.sin(elapsed * 0.37));
    const frostWindFreq = 480 + windNorm * 260 + Math.sin(elapsed * 0.45) * 75;
    const stormRumbleTarget =
      this.smoothStorm > 0.05
        ? Math.pow(this.smoothStorm, 1.35) * (0.075 + 0.035 * Math.sin(elapsed * 0.52))
        : 0;
    const stormRumbleFreq = 72 + this.smoothStorm * 42;

    this.waterGain?.gain.setTargetAtTime(waterTarget, now, 0.55);
    this.waterFilter?.frequency.setTargetAtTime(waterFreq, now, 0.55);

    this.boatWaveGain?.gain.setTargetAtTime(boatWaveTarget, now, 0.4);
    this.boatWaveFilter?.frequency.setTargetAtTime(boatWaveFreq, now, 0.4);
    this.boatWakeGain?.gain.setTargetAtTime(wakeTarget, now, 0.35);

    this.windLowGain?.gain.setTargetAtTime(windLowTarget, now, 0.8);
    this.windLowFilter?.frequency.setTargetAtTime(240 + windNorm * 420, now, 0.8);

    this.treeRustleLeftGain?.gain.setTargetAtTime(rustleBase * gustL, now, 0.7);
    this.treeRustleRightGain?.gain.setTargetAtTime(rustleBase * gustR, now, 0.7);
    this.treeRustleLeftFilter?.frequency.setTargetAtTime(rustleFreq * (0.92 + gustL * 0.16), now, 0.7);
    this.treeRustleRightFilter?.frequency.setTargetAtTime(rustleFreq * (0.94 + gustR * 0.16), now, 0.7);

    this.rainGain?.gain.setTargetAtTime(rainTarget, now, 1.15);
    this.rainFilter?.frequency.setTargetAtTime(Math.max(850, rainCutoff), now, 1.15);

    this.snowHushGain?.gain.setTargetAtTime(snowHushTarget, now, 1.25);
    this.snowHushFilter?.frequency.setTargetAtTime(snowHushFreq, now, 1.25);

    this.frostWindGain?.gain.setTargetAtTime(frostWindTarget, now, 1.2);
    this.frostWindFilter?.frequency.setTargetAtTime(frostWindFreq, now, 1.2);

    this.stormRumbleGain?.gain.setTargetAtTime(stormRumbleTarget, now, 1.35);
    this.stormRumbleFilter?.frequency.setTargetAtTime(stormRumbleFreq, now, 1.35);

    const wfProx = Math.max(0, Math.min(1, location.waterfallProximity ?? 0));
    const wfShimmer = 0.90 + 0.10 * Math.sin(elapsed * 0.48);
    const waterfallTarget = (0.014 + wfProx * 0.056) * wfShimmer * winterMuteFactor * this.mix.water;
    const waterfallFreq = (480 + wfProx * 620) * (1 - this.smoothMist * 0.2);
    this.waterfallGain?.gain.setTargetAtTime(waterfallTarget, now, 0.85);
    this.waterfallFilter?.frequency.setTargetAtTime(waterfallFreq, now, 0.85);

    if (!this.muted) {
      // Faint Distant Rolling Thunder when storm approaches or rumbles afar between lightning strikes
      if (this.smoothStorm > 0.16 && elapsed - this.lastDistantThunderTime > this.nextDistantThunderInterval) {
        this.lastDistantThunderTime = elapsed;
        const intervalBase = weather === 'storm' ? 8.5 : 13.5 - this.smoothStorm * 6.0;
        this.nextDistantThunderInterval = Math.max(4.5, intervalBase + Math.random() * 6.5);
        const distantAmp = 0.25 + this.smoothStorm * 0.55;
        this.playDistantThunder(distantAmp, (Math.random() - 0.5) * 1.45);
      }

      // Delicate crystalline snowflake / frost whisper in cold snowy weather
      if (
        (this.smoothSnow > 0.18 || this.smoothCold > 0.52) &&
        elapsed - this.lastSnowShimmerTime > this.nextSnowShimmerInterval
      ) {
        this.lastSnowShimmerTime = elapsed;
        this.nextSnowShimmerInterval = 1.4 + Math.random() * 2.2 - this.smoothSnow * 0.55;
        this.playSnowFlakeShimmer(Math.max(this.smoothSnow, this.smoothCold * 0.55), (Math.random() - 0.5) * 1.4);
      }

      // Soft misty dew droplets echoing across calm foggy water
      if (this.smoothMist > 0.35 && elapsed - this.lastMistDropTime > 1.8 + Math.random() * 2.4) {
        this.lastMistDropTime = elapsed;
        this.playWaterDrip((Math.random() - 0.5) * 1.25, 0.55 * this.smoothMist);
      }

      // Pier / shallow shoreline water babble vs Rhythmic Boat Hull Wave Slaps
      if (location.isOnBoat && this.mix.water > 0.05 && elapsed - this.lastHullWaveTime > this.nextHullWaveInterval) {
        this.lastHullWaveTime = elapsed;
        this.nextHullWaveInterval = Math.max(0.65, (2.2 - boatMove * 1.15 - windNorm * 0.65) * (0.8 + Math.random() * 0.45));
        this.playBoatHullWaveSlap(0.55 + openWater * 0.35 + boatMove * 0.45, (Math.random() - 0.5) * 1.1);
      }

      if (this.mix.water > 0.05 && elapsed - this.lastBubbleTime > (0.55 + Math.random() * 1.15) * (1.5 - shore * 0.65)) {
        this.lastBubbleTime = elapsed;
        this.playWaterBabbleBubble((0.55 + shore * 0.65) * winterMuteFactor);
      }

      // Intermittent soothing mountain birds (quieter in cold snow, rain, and storm)
      const birdProximityGain = (0.42 + 0.68 * shore) * (1 - this.smoothSnow * 0.45);
      if (this.mix.birds > 0.05 && elapsed - this.lastBirdTime > this.nextBirdInterval) {
        this.lastBirdTime = elapsed;
        const quietFactor =
          (weather === 'storm' ? 2.6 : weather === 'rain' ? 1.8 : 1.0) * (1 + this.smoothSnow * 0.85);
        const shoreFreqMult = 1.38 - shore * 0.38;
        this.nextBirdInterval = (3.4 + Math.random() * 4.8) * quietFactor * shoreFreqMult;

        if (hour >= 4.8 && hour <= 19.6) {
          if (weather !== 'storm' && this.smoothSnow < 0.72) {
            const roll = Math.random();
            if (roll < 0.38) {
              this.playFluteThrush(birdProximityGain);
            } else if (roll < 0.72) {
              this.playAlpineFinch(birdProximityGain);
            } else {
              this.playMountainDove(birdProximityGain);
            }
          }
        } else if (weather !== 'storm' && weather !== 'rain' && this.smoothCold < 0.75) {
          if (Math.random() < 0.35) {
            this.playNightOwl(0.7 + shore * 0.3);
          } else {
            this.playCricketChirp(birdProximityGain);
          }
        }
      }

      // Soaring distant mountain eagle/hawk echoing over open lake & cliffs
      if (
        this.mix.birds > 0.05 &&
        hour >= 6.5 &&
        hour <= 18.2 &&
        weather !== 'storm' &&
        this.smoothSnow < 0.5 &&
        elapsed - this.lastHawkTime > (16 + Math.random() * 14) * (1.15 - openWater * 0.3)
      ) {
        this.lastHawkTime = elapsed;
        this.playDistantHawkCall(0.85 + openWater * 0.4);
      }

      // Shoreline & lily-pad frog croaks (hibernates in winter snow/frost)
      if (
        this.mix.frogs > 0.05 &&
        weather !== 'storm' &&
        this.smoothCold < 0.65 &&
        elapsed - this.lastFrogTime > this.nextFrogInterval
      ) {
        this.lastFrogTime = elapsed;
        const nightOrRainBoost = hour < 7.2 || hour > 17.5 || weather === 'rain' || weather === 'mist' ? 0.72 : 1.05;
        const distWaitMult = 1.65 - shore * 0.65;
        this.nextFrogInterval = (4.5 + Math.random() * 5.2) * nightOrRainBoost * distWaitMult;
        this.playFrogCroak((Math.random() - 0.5) * 1.35, (0.32 + 0.72 * shore) * (1 - this.smoothCold * 0.65));
      }
    }
  }

  private routeAmbientVoice(node: AudioNode, pan: number, echoAmount = 0.45): void {
    if (!this.ctx || !this.masterGain) return;
    const panner = this.createPanner(this.ctx, pan);
    node.connect(panner);
    panner.connect(this.masterGain);
    if (this.valleyEchoSend && echoAmount > 0) {
      const send = this.ctx.createGain();
      send.gain.value = echoAmount;
      panner.connect(send);
      send.connect(this.valleyEchoSend);
    }
  }

  /** Rhythmic wave slap & gentle hull thump audible on the boat */
  private playBoatHullWaveSlap(strength = 0.8, pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted || this.mix.water < 0.05) return;
    const now = this.ctx.currentTime;
    const dur = 0.36;
    const buf = this.createBrownNoiseBuffer(this.ctx, dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(240 + Math.random() * 120, now);
    filter.frequency.exponentialRampToValueAtTime(115, now + dur);
    filter.Q.value = 1.3;

    const gain = this.ctx.createGain();
    const amp = 0.14 * strength * this.mix.water;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.18);
    src.start(now);
    oscSafeStop(src, now + dur + 0.02);
  }

  /** Delicate babbling brook / lapping water trickle */
  private playWaterBabbleBubble(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const f0 = 360 + Math.random() * 420;
    const dur = 0.045 + Math.random() * 0.055;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.55 + Math.random() * 0.45), now + dur);

    const amp = 0.012 * ampMult * this.mix.water * (0.6 + Math.random() * 0.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    this.routeAmbientVoice(gain, (Math.random() - 0.5) * 1.1, 0.15);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Soothing flute-like mountain thrush / nightingale melody */
  private playFluteThrush(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.45;
    const notes = 3 + Math.floor(Math.random() * 3);
    const scale = [1760, 1975, 2217, 2489, 2637];
    let t = now;

    for (let i = 0; i < notes; i++) {
      const dur = 0.18 + Math.random() * 0.16;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const f0 = scale[Math.floor(Math.random() * scale.length)];

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0 * 0.96, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (i === notes - 1 ? 0.88 : 1.04), t + dur);

      const amp = 0.024 * ampMult * this.mix.birds;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(amp, t + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.55);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      t += dur + 0.06 + Math.random() * 0.08;
    }
  }

  /** Soft gentle alpine finch trill */
  private playAlpineFinch(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.5;
    const notes = 2 + Math.floor(Math.random() * 3);
    const rootFreq = 2150 + Math.random() * 900;

    for (let i = 0; i < notes; i++) {
      const start = now + i * (0.14 + Math.random() * 0.06);
      const dur = 0.11 + Math.random() * 0.07;
      const osc = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      const f0 = rootFreq * (0.92 + Math.random() * 0.24);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f0 * (1.14 + Math.random() * 0.12), start + dur * 0.55);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.95, start + dur);

      mod.type = 'sine';
      mod.frequency.setValueAtTime(24 + Math.random() * 14, start);
      modGain.gain.setValueAtTime(48, start);
      mod.connect(modGain);
      modGain.connect(osc.frequency);

      const amp = 0.022 * ampMult * this.mix.birds;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp, start + 0.024);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.42);
      osc.start(start);
      mod.start(start);
      osc.stop(start + dur + 0.02);
      mod.stop(start + dur + 0.02);
    }
  }

  /** Warm, deeply relaxing distant mountain wood-dove coo */
  private playMountainDove(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.3;
    const pattern = [
      { offset: 0, dur: 0.36, f1: 510, f2: 470 },
      { offset: 0.48, dur: 0.28, f1: 495, f2: 440 },
      { offset: 0.88, dur: 0.44, f1: 470, f2: 420 },
    ];

    for (const p of pattern) {
      const start = now + p.offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.f1, start);
      osc.frequency.exponentialRampToValueAtTime(p.f2, start + p.dur);

      const amp = 0.026 * ampMult * this.mix.birds;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp, start + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + p.dur);

      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.65);
      osc.start(start);
      osc.stop(start + p.dur + 0.03);
    }
  }

  private playDistantHawkCall(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.2;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1580, now);
    osc.frequency.exponentialRampToValueAtTime(1080, now + 0.62);

    filter.type = 'bandpass';
    filter.frequency.value = 1380;
    filter.Q.value = 3.5;

    const amp = 0.014 * ampMult * this.mix.birds;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.connect(filter);
    filter.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.72);
    osc.start(now);
    osc.stop(now + 0.68);
  }

  private playNightOwl(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.3;
    const hoots = [
      { offset: 0, dur: 0.34, freq: 390 },
      { offset: 0.62, dur: 0.22, freq: 370 },
      { offset: 0.92, dur: 0.42, freq: 350 },
    ];
    for (const h of hoots) {
      const start = now + h.offset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(h.freq, start);
      osc.frequency.exponentialRampToValueAtTime(h.freq * 0.92, start + h.dur);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.022 * ampMult * this.mix.birds, start + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + h.dur);
      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.75);
      osc.start(start);
      osc.stop(start + h.dur + 0.03);
    }
  }

  private playCricketChirp(ampMult = 1.0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = (Math.random() - 0.5) * 1.4;
    for (let i = 0; i < 4; i++) {
      const start = now + i * 0.065;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(4050, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.011 * ampMult * this.mix.birds, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.048);
      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.25);
      osc.start(start);
      osc.stop(start + 0.055);
    }
  }

  public playCast(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.3);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  public playSplash(intensity = 1): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const buf = this.createBrownNoiseBuffer(this.ctx, 0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.42);
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2 * intensity, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.48);
  }

  public playNibble(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playBiteAlert(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.playSplash(0.95);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playReelTick(elapsed: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (elapsed - this.lastReelClickTime < 0.075) return;
    this.lastReelClickTime = elapsed;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1150 + Math.random() * 140, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.028, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  public playCatchChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const start = now + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.48);
    });
  }

  public playDiscoveryChime(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((f, idx) => {
      if (!this.ctx) return;
      const start = now + idx * 0.085;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.085, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.72);
      osc.connect(gain);
      this.routeAmbientVoice(gain, (idx - 2) * 0.25, 0.52);
      osc.start(start);
      osc.stop(start + 0.75);
    });
  }

  public playThunder(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const buf = this.createBrownNoiseBuffer(this.ctx, 2.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.exponentialRampToValueAtTime(48, now + 2.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    oscSafeStop(src, now + 2.45);
  }

  /** Faint rolling mountain thunder heard gradually as a storm approaches */
  public playDistantThunder(intensity = 0.5, pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 2.6 + Math.random() * 0.9;
    const buf = this.createBrownNoiseBuffer(this.ctx, dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(105 + intensity * 35, now);
    filter.frequency.exponentialRampToValueAtTime(38, now + dur * 0.9);

    const amp = Math.min(0.16, 0.05 + intensity * 0.095);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.42);
    gain.gain.exponentialRampToValueAtTime(amp * 0.55, now + dur * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.65);
    src.start(now);
    oscSafeStop(src, now + dur + 0.05);
  }

  /** Delicate snow-crystal hush & icy frost breeze puff in snowy/cold conditions */
  private playSnowFlakeShimmer(intensity = 0.6, pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.24 + Math.random() * 0.16;
    const buf = this.createPinkNoiseBuffer(this.ctx, dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2450 + Math.random() * 850, now);
    bp.Q.value = 3.2;

    const amp = Math.min(0.022, 0.008 + intensity * 0.012);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.28);
    src.start(now);
    oscSafeStop(src, now + dur + 0.02);
  }

  /** Light wet tail/snout slap on the water surface when a crocodile lunges or attacks */
  public playCrocWaterSlap(pan = 0, intensity = 0.72): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clInt = Math.max(0.2, Math.min(1.2, intensity));
    const safePan = Math.max(-0.9, Math.min(0.9, pan));

    // 1. Soft hollow water-impact thump ("خبطة خفيفة في الماء")
    const thumpOsc = this.ctx.createOscillator();
    const thumpLp = this.ctx.createBiquadFilter();
    const thumpGain = this.ctx.createGain();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime(142 + Math.random() * 22, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(52, now + 0.115);

    thumpLp.type = 'lowpass';
    thumpLp.frequency.setValueAtTime(280, now);

    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.linearRampToValueAtTime(0.145 * clInt, now + 0.009);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.135);

    thumpOsc.connect(thumpLp);
    thumpLp.connect(thumpGain);
    this.routeAmbientVoice(thumpGain, safePan, 0.22);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.15);

    // 2. Crisp flat surface-slap burst
    const slapDur = 0.11;
    const slapBuf = this.createBrownNoiseBuffer(this.ctx, slapDur);
    const slapSrc = this.ctx.createBufferSource();
    slapSrc.buffer = slapBuf;

    const slapBp = this.ctx.createBiquadFilter();
    slapBp.type = 'bandpass';
    slapBp.frequency.setValueAtTime(540 + Math.random() * 90, now);
    slapBp.frequency.exponentialRampToValueAtTime(220, now + slapDur);
    slapBp.Q.value = 1.15;

    const slapGain = this.ctx.createGain();
    slapGain.gain.setValueAtTime(0.0001, now);
    slapGain.gain.linearRampToValueAtTime(0.115 * clInt, now + 0.006);
    slapGain.gain.exponentialRampToValueAtTime(0.0001, now + slapDur);

    slapSrc.connect(slapBp);
    slapBp.connect(slapGain);
    this.routeAmbientVoice(slapGain, safePan, 0.18);
    slapSrc.start(now);
    oscSafeStop(slapSrc, now + slapDur + 0.015);

    // 3. Light trailing splash wash
    const washDur = 0.26;
    const washBuf = this.createBrownNoiseBuffer(this.ctx, washDur);
    const washSrc = this.ctx.createBufferSource();
    washSrc.buffer = washBuf;

    const washBp = this.ctx.createBiquadFilter();
    washBp.type = 'bandpass';
    washBp.frequency.setValueAtTime(760, now + 0.015);
    washBp.frequency.exponentialRampToValueAtTime(260, now + washDur);
    washBp.Q.value = 0.75;

    const washGain = this.ctx.createGain();
    washGain.gain.setValueAtTime(0.0001, now + 0.015);
    washGain.gain.linearRampToValueAtTime(0.068 * clInt, now + 0.04);
    washGain.gain.exponentialRampToValueAtTime(0.0001, now + washDur);

    washSrc.connect(washBp);
    washBp.connect(washGain);
    this.routeAmbientVoice(washGain, safePan, 0.24);
    washSrc.start(now + 0.015);
    oscSafeStop(washSrc, now + washDur + 0.02);
  }

  public playCrocSnap(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const safePan = Math.max(-0.9, Math.min(0.9, pan));
    this.playCrocWaterSlap(safePan, 0.92);
    this.playSplash(0.75);

    // Muffled predatory jaw-snap thump
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.15);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(310, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(lp);
    lp.connect(gain);
    this.routeAmbientVoice(gain, safePan, 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playFrogCroak(pan = 0, ampMult = 1.0): void {
    if (!this.ctx || !this.masterGain || this.muted || this.mix.frogs < 0.05) return;
    const now = this.ctx.currentTime;
    const pulses = Math.random() < 0.45 ? 3 : 2;
    const basePitch = 108 + Math.random() * 24;

    for (let pulse = 0; pulse < pulses; pulse++) {
      const t = now + pulse * 0.165;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(basePitch + pulse * 14, t);
      osc.frequency.exponentialRampToValueAtTime(basePitch + 72 + pulse * 18, t + 0.085);
      filter.type = 'bandpass';
      filter.frequency.value = 520 + pulse * 35;
      filter.Q.value = 3.0;

      const amp = 0.085 * ampMult * this.mix.frogs;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(amp, t + 0.022);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.125);

      osc.connect(filter);
      filter.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.28);
      osc.start(t);
      osc.stop(t + 0.145);
    }
  }

  /** Delicate close-range songbird chirp when a bird lands or perches nearby */
  public playCloseBirdChirp(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted || this.mix.birds < 0.05) return;
    const now = this.ctx.currentTime;
    const notes = Math.random() < 0.5 ? 3 : 2;
    const baseFreq = 2650 + Math.random() * 650;

    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.105;
      const dur = 0.065 + Math.random() * 0.03;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const fStart = baseFreq * (1 + i * 0.11);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(fStart, t);
      osc.frequency.exponentialRampToValueAtTime(fStart * 1.24, t + dur * 0.65);
      osc.frequency.exponentialRampToValueAtTime(fStart * 0.94, t + dur);

      const amp = 0.022 * this.mix.birds;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(amp, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.22);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  /** Soft feathered wing-flutter burst when a bird lands, flutters, or takes off */
  public playWingFlutter(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted || this.mix.birds < 0.05) return;
    const now = this.ctx.currentTime;
    const beats = 4;

    for (let i = 0; i < beats; i++) {
      const t = now + i * 0.065;
      const dur = 0.055;
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.sin((j / bufferSize) * Math.PI);
      }

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900 + i * 110;
      filter.Q.value = 1.4;

      const gain = this.ctx.createGain();
      const amp = 0.042 * (1 - i * 0.14) * this.mix.birds;
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      src.connect(filter);
      filter.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.12);
      src.start(t);
      oscSafeStop(src, t + dur + 0.01);
    }
  }

  /** Delicate individual water-drop plink hitting wood or lake surface */
  public playWaterDrip(pan = 0, intensity = 1.0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const f0 = 780 + Math.random() * 520;
    const dur = 0.055;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.95, now + dur);

    const amp = Math.min(0.06, 0.022 * intensity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.14);
    osc.start(now);
    osc.stop(now + dur + 0.015);
  }

  /** Soft woven keepnet cage thud + wet splash when placing a caught fish into the cage */
  public playKeepnetDrop(pan = -0.3): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.playSplash(0.42);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(88, now + 0.19);
    gain.gain.setValueAtTime(0.0001, now + 0.04);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.055);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.21);
    osc.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.18);
    osc.start(now + 0.04);
    osc.stop(now + 0.23);
  }

  /** Muffled wooden hull thud + light splash when nudging rocks or canyon banks */
  public playBoatRockBump(intensity = 0.65): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clInt = Math.max(0.2, Math.min(1.0, intensity));

    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(118 + Math.random() * 18, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.11 * clInt, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(lp);
    lp.connect(gain);
    this.routeAmbientVoice(gain, 0, 0.18);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /** Tactile vintage mechanical switch click & brief warm radio tuning crackle */
  public playRadioSwitchClick(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1450, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.028);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.036);
    osc.connect(gain);
    this.routeAmbientVoice(gain, -0.25, 0.08);
    osc.start(now);
    osc.stop(now + 0.042);

    // Subtle analog tuning whisper
    const dur = 0.045;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850;
    bp.Q.value = 1.2;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.035, now + 0.008);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008 + dur);
    src.connect(bp);
    bp.connect(nGain);
    this.routeAmbientVoice(nGain, -0.25, 0.06);
    src.start(now + 0.008);
    oscSafeStop(src, now + 0.015 + dur);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}

function oscSafeStop(src: AudioBufferSourceNode, when: number): void {
  try {
    src.stop(when);
  } catch {
    // ignore already stopped
  }
}
