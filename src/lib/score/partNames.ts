/**
 * Readable part names, whatever language the score was written in.
 *
 * Notation programs store the part name in the author's language (a Russian
 * MuseScore writes "Фортепиано" for piano, "Альт" for alto). MusicXML also
 * carries a language-neutral sound id (`<instrument-sound>voice.alto`), and
 * usually a General-MIDI program — so when the written name isn't in Latin
 * script, the name is derived from those instead.
 */

/** `<instrument-sound>` ids (MusicXML standard sounds) by prefix, most specific first. */
const SOUND_NAMES: [string, string][] = [
  ['voice.', 'Voice'],
  ['keyboard.piano', 'Piano'],
  ['keyboard.organ', 'Organ'],
  ['keyboard.harpsichord', 'Harpsichord'],
  ['keyboard.accordion', 'Accordion'],
  ['keyboard.', 'Keyboard'],
  ['strings.violin', 'Violin'],
  ['strings.viola', 'Viola'],
  ['strings.cello', 'Cello'],
  ['strings.contrabass', 'Double bass'],
  ['strings.harp', 'Harp'],
  ['strings.', 'Strings'],
  ['pluck.guitar', 'Guitar'],
  ['pluck.bass', 'Bass'],
  ['pluck.ukulele', 'Ukulele'],
  ['pluck.', 'Guitar'],
  ['wind.flutes.recorder', 'Recorder'],
  ['wind.flutes', 'Flute'],
  ['wind.reed.clarinet', 'Clarinet'],
  ['wind.reed.oboe', 'Oboe'],
  ['wind.reed.saxophone', 'Saxophone'],
  ['wind.reed.bassoon', 'Bassoon'],
  ['wind.', 'Wind'],
  ['brass.trumpet', 'Trumpet'],
  ['brass.trombone', 'Trombone'],
  ['brass.french-horn', 'Horn'],
  ['brass.tuba', 'Tuba'],
  ['brass.', 'Brass'],
  ['drum.', 'Drums'],
  ['metal.', 'Percussion'],
  ['wood.', 'Percussion'],
  ['pitched-percussion.', 'Percussion'],
  ['synth.', 'Synth']
];

/** General-MIDI program families (0-based program / 8). */
const GM_FAMILIES = [
  'Piano',
  'Chromatic percussion',
  'Organ',
  'Guitar',
  'Bass',
  'Strings',
  'Ensemble',
  'Brass',
  'Reed',
  'Pipe',
  'Synth lead',
  'Synth pad',
  'Synth effects',
  'Ethnic',
  'Percussion',
  'Sound effects'
];
/** GM programs 52–54 are choir/voice sounds inside the "Ensemble" family. */
const isVoiceProgram = (p: number) => p >= 52 && p <= 54;

/** Part id → `<instrument-sound>` of its first instrument, read from the raw MusicXML. */
export function instrumentSounds(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const partList = /<part-list>([\s\S]*?)<\/part-list>/.exec(xml)?.[1] ?? '';
  for (const m of partList.matchAll(/<score-part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/score-part>/g)) {
    const sound = /<instrument-sound>\s*([^<\s]+)\s*<\/instrument-sound>/.exec(m[2])?.[1];
    if (sound) out.set(m[1], sound);
  }
  return out;
}

/** True when the name reads fine to a Latin-alphabet user (letters, digits, punctuation). */
function isLatin(name: string): boolean {
  return /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(name);
}

/**
 * The name to show for a part: the written one when it's in Latin script,
 * else one derived from its sound id or GM program, else the written one.
 */
export function friendlyPartName(written: string, sound?: string, program?: number): string {
  const name = written.trim();
  if (name && isLatin(name)) return name;
  if (sound) {
    const hit = SOUND_NAMES.find(([prefix]) => sound.startsWith(prefix));
    if (hit) return hit[1];
  }
  if (program !== undefined && program >= 0 && program < 128) {
    return isVoiceProgram(program) ? 'Voice' : GM_FAMILIES[Math.floor(program / 8)];
  }
  return name;
}
