#!/usr/bin/env node
// Generates 5 additional buzz alarm WAV files (PCM 16-bit mono 44100Hz)
// Run: node scripts/generate-sounds.js

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const BITS = 16;
const CHANNELS = 1;

function writeWav(filePath, samples) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS / 8), 28);
  buf.writeUInt16LE(CHANNELS * (BITS / 8), 32);
  buf.writeUInt16LE(BITS, 34);
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
  console.log(`  Written: ${filePath} (${(buf.length / 1024).toFixed(1)}KB)`);
}

function tone(freq, duration, volume = 0.9) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE) * volume;
  }
  return out;
}

function silence(duration) {
  return new Float64Array(Math.floor(SAMPLE_RATE * duration));
}

function concat(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Float64Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function applyEnvelope(samples, attackMs, releaseMs) {
  const attackSamples = Math.floor(SAMPLE_RATE * attackMs / 1000);
  const releaseSamples = Math.floor(SAMPLE_RATE * releaseMs / 1000);
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let env = 1;
    if (i < attackSamples) env = i / attackSamples;
    if (i > samples.length - releaseSamples) env = (samples.length - i) / releaseSamples;
    out[i] = samples[i] * env;
  }
  return out;
}

// Sound 2: Urgent - rapid high-pitched beeps
function generateUrgent() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(applyEnvelope(tone(1200, 0.08, 0.9), 5, 5));
    parts.push(silence(0.07));
  }
  parts.push(silence(0.1));
  return concat(...parts);
}

// Sound 3: Siren - rising and falling sweep
function generateSiren() {
  const duration = 1.0;
  const n = Math.floor(SAMPLE_RATE * duration);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Sweep from 600Hz to 1400Hz and back
    const freq = 600 + 800 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t));
    out[i] = Math.sin(2 * Math.PI * freq * t) * 0.85;
  }
  return out;
}

// Sound 4: Radar - pulsing mid-tone
function generateRadar() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const beep = applyEnvelope(tone(880, 0.15, 0.9), 10, 30);
    parts.push(beep);
    parts.push(silence(0.18));
  }
  return concat(...parts);
}

// Sound 5: Chime - pleasant two-tone
function generateChime() {
  const n1 = Math.floor(SAMPLE_RATE * 0.25);
  const n2 = Math.floor(SAMPLE_RATE * 0.35);
  const high = new Float64Array(n1);
  const low = new Float64Array(n2);
  for (let i = 0; i < n1; i++) {
    const t = i / SAMPLE_RATE;
    high[i] = (Math.sin(2 * Math.PI * 1047 * t) * 0.5 + Math.sin(2 * Math.PI * 1319 * t) * 0.35) * 0.85;
  }
  for (let i = 0; i < n2; i++) {
    const t = i / SAMPLE_RATE;
    low[i] = (Math.sin(2 * Math.PI * 784 * t) * 0.5 + Math.sin(2 * Math.PI * 988 * t) * 0.35) * 0.85;
  }
  return concat(
    applyEnvelope(high, 5, 40),
    silence(0.05),
    applyEnvelope(low, 5, 80),
    silence(0.3),
  );
}

// Sound 6: Emergency - harsh fast pulsing with harmonics
function generateEmergency() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const n = Math.floor(SAMPLE_RATE * 0.12);
    const buf = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const t = j / SAMPLE_RATE;
      buf[j] = (Math.sin(2 * Math.PI * 700 * t) * 0.5 +
                 Math.sin(2 * Math.PI * 1400 * t) * 0.3 +
                 Math.sin(2 * Math.PI * 2100 * t) * 0.15) * 0.9;
    }
    parts.push(applyEnvelope(buf, 3, 10));
    parts.push(silence(0.05));
  }
  parts.push(silence(0.15));
  return concat(...parts);
}

// Sound 7: Doorbell - ding-dong two-note
function generateDoorbell() {
  const ding = applyEnvelope(tone(659, 0.3, 0.85), 5, 80);
  const dong = applyEnvelope(tone(523, 0.4, 0.85), 5, 120);
  return concat(ding, silence(0.08), dong, silence(0.25));
}

// Sound 8: Alarm Clock - classic tick-tick-tick-RING
function generateAlarmClock() {
  const parts = [];
  for (let i = 0; i < 8; i++) {
    parts.push(applyEnvelope(tone(2000, 0.04, 0.8), 2, 2));
    parts.push(silence(0.04));
  }
  parts.push(silence(0.05));
  parts.push(applyEnvelope(tone(1500, 0.2, 0.9), 3, 30));
  parts.push(silence(0.15));
  return concat(...parts);
}

// Sound 9: Sonar - deep underwater ping
function generateSonar() {
  const n = Math.floor(SAMPLE_RATE * 0.6);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 4);
    out[i] = Math.sin(2 * Math.PI * 440 * t) * env * 0.9;
  }
  return concat(out, silence(0.4));
}

// Sound 10: Whistle - loud rising pitch whistle with harmonics
function generateWhistle() {
  const duration = 0.4;
  const n = Math.floor(SAMPLE_RATE * duration);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 900 + 1000 * (t / duration);
    const env = Math.sin(Math.PI * t / duration);
    out[i] = (Math.sin(2 * Math.PI * freq * t) * 0.7 +
              Math.sin(2 * Math.PI * freq * 2 * t) * 0.2) * env * 0.9;
  }
  return concat(out, silence(0.1), out, silence(0.08), out, silence(0.25));
}

// Output dirs
const androidRaw = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw');
const iosDir = path.join(__dirname, '..', 'ios', 'Buzzer');

const sounds = [
  { name: 'buzz_alarm_2', gen: generateUrgent },
  { name: 'buzz_alarm_3', gen: generateSiren },
  { name: 'buzz_alarm_4', gen: generateRadar },
  { name: 'buzz_alarm_5', gen: generateChime },
  { name: 'buzz_alarm_6', gen: generateEmergency },
  { name: 'buzz_alarm_7', gen: generateDoorbell },
  { name: 'buzz_alarm_8', gen: generateAlarmClock },
  { name: 'buzz_alarm_9', gen: generateSonar },
  { name: 'buzz_alarm_10', gen: generateWhistle },
];

console.log('Generating buzz alarm sounds...\n');
for (const { name, gen } of sounds) {
  const samples = gen();
  console.log(`${name}:`);
  writeWav(path.join(androidRaw, `${name}.wav`), samples);
  writeWav(path.join(iosDir, `${name}.wav`), samples);
}
console.log('\nDone! Generated 9 sounds for Android + iOS.');
