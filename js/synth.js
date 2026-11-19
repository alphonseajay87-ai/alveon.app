/* Sample music: short lo-fi loops made on the phone, so a fresh install has something to play offline. */
(function(){
  var AV = window.AV = window.AV || {};

  AV.synthWav = function(c){
    var sr = 16000, beat = 60 / c.bpm, bar = beat * 4, shift = c.shift || 0;
    var total = Math.floor(sr * (bar * c.bars + 1.6)), d = new Float32Array(total), TAU = Math.PI * 2;
    function add(i, v){ if (i >= 0 && i < total) d[i] += v; }
    for (var b = 0; b < c.bars; b++){
      var ch = c.chords[b % c.chords.length], t0 = b * bar;
      ch.forEach(function(m0){
        var m = m0 + shift, f = 440 * Math.pow(2, (m - 69) / 12), s0 = Math.floor(t0 * sr), len = Math.floor((bar + .9) * sr);
        for (var i = 0; i < len && s0 + i < total; i++){
          var t = i / sr, env = Math.min(1, t / .15) * (t > bar ? Math.exp(-(t - bar) * 5) : 1);
          d[s0 + i] += (Math.sin(TAU * f * t) * .6 + Math.sin(TAU * f * 2.003 * t) * .15 + Math.sin(TAU * f * .5 * t) * .25) * .05 * env * (1 + .08 * Math.sin(TAU * .3 * t + m));
        }
      });
      var bf = 440 * Math.pow(2, (ch[0] + shift - 12 - 69) / 12);
      [0, 2.5].forEach(function(bt){
        var s0 = Math.floor((t0 + bt * beat) * sr), len = Math.floor(beat * 1.8 * sr);
        for (var i = 0; i < len && s0 + i < total; i++){ var t = i / sr; d[s0 + i] += Math.sin(TAU * bf * t) * .28 * Math.exp(-t * 3.2) * Math.min(1, t / .01); }
      });
      for (var q = 0; q < 8; q++){
        var tt = t0 + q * beat / 2 + (q % 2 ? beat * .07 : 0), p = Math.floor(tt * sr), i2, t2;
        if (q === 0 || q === 5){ var ph = 0; for (i2 = 0; i2 < .28 * sr; i2++){ t2 = i2 / sr; ph += TAU * (46 + 95 * Math.exp(-t2 * 30)) / sr; add(p + i2, Math.sin(ph) * .55 * Math.exp(-t2 * 9)); } }
        if (q === 2 || q === 6){ for (i2 = 0; i2 < .16 * sr; i2++){ t2 = i2 / sr; add(p + i2, ((Math.random() * 2 - 1) * .16 + Math.sin(TAU * 190 * t2) * .12) * Math.exp(-t2 * 22)); } }
        var vol = q % 2 ? .05 : .03, pn = 0;
        for (i2 = 0; i2 < .04 * sr; i2++){ t2 = i2 / sr; var n = Math.random() * 2 - 1; add(p + i2, (n - pn) * vol * Math.exp(-t2 * 90)); pn = n; }
      }
    }
    var y = 0, peak = 0, i;
    for (i = 0; i < total; i++){ y += .5 * (d[i] - y); d[i] = y; if (Math.abs(y) > peak) peak = Math.abs(y); }
    var g = .8 / (peak || 1);
    for (i = 0; i < total; i++) d[i] *= g;
    for (i = 0; i < total; i++){
      if (Math.random() < .0004){ var a = (.04 + Math.random() * .16) * (Math.random() < .5 ? -1 : 1), l = 4 + Math.floor(Math.random() * 10); for (var k = 0; k < l && i + k < total; k++) d[i + k] += a * Math.exp(-k / 2.5); }
      d[i] += (Math.random() * 2 - 1) * .004;
    }
    var buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
    function str(o, s){ for (var j = 0; j < s.length; j++) v.setUint8(o + j, s.charCodeAt(j)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, total * 2, true);
    for (i = 0; i < total; i++){ var s = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
    return new Blob([buf], { type: 'audio/wav' });
  };

  AV.synthLength = function(c){ return c.bars * (60 / c.bpm) * 4 + 1.6; };

  var A = [[50, 57, 60, 64], [43, 53, 59, 64], [48, 55, 59, 62], [45, 55, 59, 64]];
  var B = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
  var C = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [43, 55, 59, 62]];

  AV.SAMPLES = [
    { title: 'Late Fare', artist: 'House Band', hue: 28, style: 0, tracks: [
      { title: 'Late Fare', bpm: 76, bars: 16, shift: 0, chords: A },
      { title: 'Platform Nine', bpm: 84, bars: 14, shift: 2, chords: B },
      { title: 'Last Train Home', bpm: 70, bars: 16, shift: -3, chords: C } ] },
    { title: 'Paper Lanterns', artist: 'House Band', hue: 205, style: 1, tracks: [
      { title: 'Paper Lanterns', bpm: 88, bars: 16, shift: 0, chords: B },
      { title: 'Night Market', bpm: 92, bars: 14, shift: 3, chords: C },
      { title: 'Soft Rain', bpm: 68, bars: 16, shift: -2, chords: A } ] },
    { title: 'Low Tide Radio', artist: 'House Band', hue: 330, style: 2, tracks: [
      { title: 'Low Tide Radio', bpm: 66, bars: 14, shift: 0, chords: C },
      { title: 'Salt and Static', bpm: 74, bars: 16, shift: 2, chords: A },
      { title: 'Harbour Lights', bpm: 80, bars: 14, shift: -4, chords: B } ] }
  ];
  [['Night Bus', 172, 0], ['Glass Garden', 120, 2], ['Soft Static', 262, 1], ['Amber Hours', 44, 2], ['Blue Letters', 230, 0], ['Open Window', 350, 1]].forEach(function(x, i){
    var cs = [A, B, C];
    AV.SAMPLES.push({ title: x[0], artist: 'House Band', hue: x[1], style: x[2], tracks: [
      { title: x[0], bpm: 70 + i * 4, bars: 14, shift: i - 2, chords: cs[i % 3] },
      { title: 'Side B', bpm: 78 + i * 3, bars: 14, shift: i, chords: cs[(i + 1) % 3] } ] });
  });
})();
