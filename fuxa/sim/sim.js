// Симулятор QT-BoX: публикует в MQTT освещение, нагрев и счётчик; слушает команды с экранов.
const mqtt = require('mqtt');
const c = mqtt.connect(process.env.MQTT_URL || 'mqtt://mosquitto:1883');
const pub = (t, v) => c.publish(t, String(v), { retain: true });
const L = { z1: 60, z2: 30, z3: 0 };
let streetMode = 2; let street = 1, T = { pv: 22, sp: 60, out: 0, run: 0 };
const ld = { kettle: 0, stove: 0, motor: 0, other: 1 };
const P = { kettle: [2000, 0], stove: [3500, 1], motor: [2200, -1], other: [600, 2] };
// установка ALD: цикл ТМА, продувка, H2O, продувка (секунды на шаг)
const A = { run: 1, step: 1, t: 0, cycle: 0, target: 100, temp: 25, press: 10 };
const DUR = [0, 2, 3, 2, 3];
let kwh = 120.0, seq = 0, tick = 0;
c.on('connect', () => {
  console.log('MQTT connected');
  c.subscribe(['qt/light/+/set', 'qt/light/street/set', 'qt/heat/sp/set', 'qt/ald/run/set']);
});
c.on('message', (t, m) => {
  const v = parseFloat(m.toString()); if (Number.isNaN(v)) return;
  if (t === 'qt/light/street/set') { streetMode = v > 1.5 ? 2 : (v > 0.5 ? 1 : 0); }
  let r = t.match(/qt\/light\/(z\d)\/set/);
  if (r) L[r[1]] = Math.max(0, Math.min(100, v));
  if (t === 'qt/heat/sp/set') T.sp = v;
  if (t === 'qt/ald/run/set') { if (v > 0.5 && !A.run) { if (A.cycle >= A.target) A.cycle = 0; A.run = 1; A.step = 1; A.t = 0; } if (v < 0.5) { A.run = 0; A.step = 0; } }
});
setInterval(() => {
  tick++;
  // освещение: уличный светильник по «времени суток»
  street = streetMode === 2 ? ((tick % 60) < 40 ? 1 : 0) : streetMode;
  for (const k in L) pub(`qt/light/${k}`, Math.round(L[k]));
  pub('qt/light/street', street);
  // нагрев: ПИД упрощённо
  const err = T.sp - T.pv;
  T.out = Math.max(0, Math.min(100, err * 8));
  T.run = T.out > 1 ? 1 : 0;
  T.pv += (T.out * 0.05 - (T.pv - 20) * 0.02) + (Math.random() - 0.5) * 0.1;
  pub('qt/heat/pv', T.pv.toFixed(1)); pub('qt/heat/sp', T.sp);
  pub('qt/heat/out', Math.round(T.out)); pub('qt/heat/run', T.run);
  // ALD
  if (A.run) { A.t++; if (A.t >= DUR[A.step]) { A.t = 0; A.step++; if (A.step > 4) { A.step = 1; A.cycle++; if (A.cycle >= A.target) { A.run = 0; A.step = 0; } } } }
  const tT = A.run ? 150 : 25, pT = !A.run ? 10 : (A.step === 1 || A.step === 3 ? 130 : 60);
  A.temp += (tT - A.temp) * 0.1; A.press += (pT - A.press) * 0.5 + (Math.random() - 0.5) * 2;
  pub('qt/ald/step', A.step); pub('qt/ald/v1', A.step === 1 ? 1 : 0); pub('qt/ald/v2', A.step === 2 ? 1 : 0);
  pub('qt/ald/v3', A.step === 3 ? 1 : 0); pub('qt/ald/v4', A.step === 4 ? 1 : 0);
  pub('qt/ald/temp', A.temp.toFixed(0)); pub('qt/ald/press', A.press.toFixed(0)); pub('qt/ald/cycle', A.cycle);
  pub('qt/ald/thick', (A.cycle * 0.11).toFixed(1)); pub('qt/ald/run', A.run); pub('qt/ald/target', A.target);
  // энергия: нагрузки переключаются по кругу
  if (tick % 8 === 0) { const ks = ['stove', 'motor', 'kettle']; const k = ks[seq++ % 3]; ld[k] = ld[k] ? 0 : 1; }
  const a = [0.4, 0.4, 0.4]; let w = 0;
  for (const k in ld) if (ld[k]) {
    const [p, ph] = P[k]; w += p;
    if (ph < 0) { a[0] += p / 3 / 230; a[1] += p / 3 / 230; a[2] += p / 3 / 230; }
    else a[ph] += p / 230;
  }
  const dev = () => (Math.random() - 0.5) * 0.4;
  for (let i = 0; i < 3; i++) { pub(`qt/em/v${i + 1}`, (230 + dev()).toFixed(0)); pub(`qt/em/a${i + 1}`, (a[i] + Math.random() * 0.1).toFixed(1)); }
  kwh += w / 3.6e6 * 1000; w += 300;
  pub('qt/em/kw', (w / 1000).toFixed(2)); pub('qt/em/kwh', kwh.toFixed(1));
  for (const k in ld) pub(`qt/em/load/${k}`, ld[k]);
}, 1000);
