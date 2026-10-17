/* speech.js: read text aloud with the browser's built-in voice (Som)
 * Registers only where speechSynthesis exists, so the card hides its button elsewhere.
 * Text always stays on screen; the voice is a bonus, not the only channel.
 */
(function () {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;

  function say(text) {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // ponytail: first British English voice; demo laptops differ, pick by name here if one sounds off
    u.voice = synth.getVoices().find(v => v.lang === 'en-GB') || null;
    u.rate = 1.02;
    synth.speak(u);
  }

  window.Views = window.Views || {};
  window.Views.speech = {
    say,
    stop() { synth.cancel(); },
    // the card's read-aloud: who, score, the contradiction, the analysis
    speak(s) {
      const flags = s.flags.map(f => f.detail).filter(Boolean).join('. ');
      say([`${s.name}. Suspicion score ${s.score.toFixed(1)}.`, flags, s.llm_reasoning].filter(Boolean).join(' ').replace(/MOCK:\s*/g, ''));
    }
  };
})();
