import type { AmbienceMix, WeatherType } from '../types/fishing';

export class NatureSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private valleyEchoSend: GainNode | null = null;

  // Ambient continuous layers
  private waterGain: GainNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;
  private windLowGain: GainNode | null = null;
  private windLowFilter: BiquadFilterNode | null = null;
  private treeRustleLeftGain: GainNode | null = null;
  private treeRustleRightGain: GainNode | null = null;
  private treeRustleLeftFilter: BiquadFilterNode | null = null;
  private treeRustleRightFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;

  private muted = false;
  private initialized = false;
  private mix: AmbienceMix = {
    water: 0.78,
    trees: 0.72,
    birds: 0.75,
    frogs: 0.76,
  };

  private lastBirdTime = 0;
  private nextBirdInterval = 3.2;
  private lastFrogTime = 0;
  private nextFrogInterval = 4.6;
  private lastFrogPreviewAt = 0;
  private lastHawkTime = 0;
  private lastBubbleTime = 0;
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

      // 4. Rain Patter Layer
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

  public updateAmbience(weather: WeatherType, hour: number, elapsed: number, windSpeedKmh = 8): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    const windNorm = Math.max(0, Math.min(1.2, windSpeedKmh / 35));
    const gustL = 0.65 + 0.35 * Math.sin(elapsed * 0.28 + Math.sin(elapsed * 0.11));
    const gustR = 0.65 + 0.35 * Math.sin(elapsed * 0.24 + 1.4 + Math.cos(elapsed * 0.13));

    // Water lapping rises gently with wind waves & swells organically
    const waveSwell = 0.72 + 0.28 * Math.sin(elapsed * 0.72);
    const waterBase = (0.12 + windNorm * 0.15 + (weather === 'storm' ? 0.06 : 0)) * waveSwell;
    const waterTarget = waterBase * this.mix.water;
    const waterFreq = 260 + windNorm * 240 + Math.sin(elapsed * 0.72) * 65;

    // Valley wind + left/right tree foliage rustle
    const windLowTarget = (0.045 + windNorm * 0.22 + (weather === 'storm' ? 0.07 : 0)) * this.mix.trees;
    const rustleBase = (0.014 + windNorm * 0.085) * this.mix.trees;
    const rustleFreq = 920 + windNorm * 880;

    const rainTarget = weather === 'storm' ? 0.24 : weather === 'rain' ? 0.15 : 0;

    this.waterGain?.gain.setTargetAtTime(waterTarget, now, 0.35);
    this.waterFilter?.frequency.setTargetAtTime(waterFreq, now, 0.35);

    this.windLowGain?.gain.setTargetAtTime(windLowTarget, now, 0.45);
    this.windLowFilter?.frequency.setTargetAtTime(240 + windNorm * 420, now, 0.45);

    this.treeRustleLeftGain?.gain.setTargetAtTime(rustleBase * gustL, now, 0.45);
    this.treeRustleRightGain?.gain.setTargetAtTime(rustleBase * gustR, now, 0.45);
    this.treeRustleLeftFilter?.frequency.setTargetAtTime(rustleFreq * (0.92 + gustL * 0.16), now, 0.45);
    this.treeRustleRightFilter?.frequency.setTargetAtTime(rustleFreq * (0.94 + gustR * 0.16), now, 0.45);

    this.rainGain?.gain.setTargetAtTime(rainTarget, now, 0.6);

    if (!this.muted) {
      // Intermittent delicate brook/water babble droplets (خرير وقطرات ماء خفيفة)
      if (this.mix.water > 0.05 && elapsed - this.lastBubbleTime > 0.55 + Math.random() * 1.15) {
        this.lastBubbleTime = elapsed;
        this.playWaterBabbleBubble();
      }

      // Intermittent soothing mountain birds during daytime / dawn / dusk; soft owl & crickets at night
      if (this.mix.birds > 0.05 && elapsed - this.lastBirdTime > this.nextBirdInterval) {
        this.lastBirdTime = elapsed;
        const quietFactor = weather === 'storm' ? 2.6 : weather === 'rain' ? 1.8 : 1.0;
        this.nextBirdInterval = (3.4 + Math.random() * 4.8) * quietFactor;

        if (hour >= 4.8 && hour <= 19.6) {
          if (weather !== 'storm') {
            const roll = Math.random();
            if (roll < 0.38) {
              this.playFluteThrush();
            } else if (roll < 0.72) {
              this.playAlpineFinch();
            } else {
              this.playMountainDove();
            }
          }
        } else if (weather !== 'storm' && weather !== 'rain') {
          if (Math.random() < 0.35) {
            this.playNightOwl();
          } else {
            this.playCricketChirp();
          }
        }
      }

      // Occasional distant soaring mountain eagle/hawk echoing off the peaks
      if (
        this.mix.birds > 0.05 &&
        hour >= 6.5 &&
        hour <= 18.2 &&
        weather !== 'storm' &&
        elapsed - this.lastHawkTime > 16 + Math.random() * 14
      ) {
        this.lastHawkTime = elapsed;
        this.playDistantHawkCall();
      }

      // Ambient shoreline & lily-pad frog croaks (natively active at dawn, dusk, night & calm weather)
      if (this.mix.frogs > 0.05 && weather !== 'storm' && elapsed - this.lastFrogTime > this.nextFrogInterval) {
        this.lastFrogTime = elapsed;
        const nightOrRainBoost = hour < 7.2 || hour > 17.5 || weather === 'rain' || weather === 'mist' ? 0.72 : 1.05;
        this.nextFrogInterval = (4.5 + Math.random() * 5.2) * nightOrRainBoost;
        this.playFrogCroak((Math.random() - 0.5) * 1.35);
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

  /** Delicate babbling brook / lapping water trickle */
  private playWaterBabbleBubble(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const f0 = 360 + Math.random() * 420;
    const dur = 0.045 + Math.random() * 0.055;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.55 + Math.random() * 0.45), now + dur);

    const amp = 0.012 * this.mix.water * (0.6 + Math.random() * 0.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    this.routeAmbientVoice(gain, (Math.random() - 0.5) * 1.1, 0.15);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Soothing flute-like mountain thrush / nightingale melody */
  private playFluteThrush(): void {
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

      const amp = 0.024 * this.mix.birds;
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
  private playAlpineFinch(): void {
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

      const amp = 0.022 * this.mix.birds;
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
  private playMountainDove(): void {
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

      const amp = 0.026 * this.mix.birds;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(amp, start + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + p.dur);

      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.65);
      osc.start(start);
      osc.stop(start + p.dur + 0.03);
    }
  }

  private playDistantHawkCall(): void {
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

    const amp = 0.014 * this.mix.birds;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

    osc.connect(filter);
    filter.connect(gain);
    this.routeAmbientVoice(gain, pan, 0.72);
    osc.start(now);
    osc.stop(now + 0.68);
  }

  private playNightOwl(): void {
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
      gain.gain.linearRampToValueAtTime(0.022 * this.mix.birds, start + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + h.dur);
      osc.connect(gain);
      this.routeAmbientVoice(gain, pan, 0.75);
      osc.start(start);
      osc.stop(start + h.dur + 0.03);
    }
  }

  private playCricketChirp(): void {
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
      gain.gain.linearRampToValueAtTime(0.011 * this.mix.birds, start + 0.015);
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

  public playCrocSnap(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    this.playSplash(1.4);

    // Sharp jaw clap + low predatory thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playFrogCroak(pan = 0): void {
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

      const amp = 0.085 * this.mix.frogs;
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
