/**
 * Piper voice discovery.
 *
 * Scans the existing model folders (config/piper/en and config/piper/vn) for
 * *.onnx models with a matching *.onnx.json sidecar. Model filenames are
 * discovered, never assumed.
 */
const fs = require('fs');
const path = require('path');

const VOICE_DIRS = {
  en: path.join(__dirname, '..', 'config', 'piper', 'en'),
  vi: path.join(__dirname, '..', 'config', 'piper', 'vn')
};

const LABELS = {
  'en_US-amy-medium': 'Amy — US English (female)',
  'en_US-arctic-medium': 'Arctic — US English (male, multi-speaker)',
  'en_US-hfc_female-medium': 'HFC — US English (female)',
  'vi_VN-vais1000-medium': 'VAIS 1000 — Vietnamese (female)',
  banmai: 'Ban Mai — Vietnamese (female)',
  cuc: 'Cúc — Vietnamese (female)',
  taian2: 'Tài An — Vietnamese (male)',
  phuongtrang: 'Phương Trang — Vietnamese (female)',
  ngochuyennew: 'Ngọc Huyền (New) — Vietnamese (female)',
  ngochuyen: 'Ngọc Huyền — Vietnamese (female)',
  minhquang: 'Minh Quang — Vietnamese (male)',
  minhkhang: 'Minh Khang — Vietnamese (male)',
  manhdung: 'Mạnh Dũng — Vietnamese (male)',
  maiphuong: 'Mai Phương — Vietnamese (female)',
  lacphi: 'Lạc Phi — Vietnamese',
  chieuthanh: 'Chiêu Thanh — Vietnamese (southern)',
  duyoryx3175: 'Duy — Vietnamese'
};

const LANGUAGE_NAMES = { en: 'English', vi: 'Vietnamese' };

function readVoiceMeta(modelPath) {
  try {
    return JSON.parse(fs.readFileSync(`${modelPath}.json`, 'utf8'));
  } catch (_) {
    return {};
  }
}

function discoverVoices() {
  const voices = [];
  for (const [language, dir] of Object.entries(VOICE_DIRS)) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith('.onnx')) continue;
      const id = file.replace(/\.onnx$/, '');
      const modelPath = path.join(dir, file);
      if (!fs.existsSync(`${modelPath}.json`)) continue;
      const meta = readVoiceMeta(modelPath);
      const sampleRate = Number((meta.audio && meta.audio.sample_rate) || 22050);
      const speakers = Number(meta.num_speakers || 1);
      const espeakVoice = (meta.espeak && meta.espeak.voice) || '';
      voices.push({
        id,
        language,
        languageName: LANGUAGE_NAMES[language] || language,
        label: LABELS[id] || `${id} — ${LANGUAGE_NAMES[language] || language}`,
        file: `config/piper/${language === 'en' ? 'en' : 'vn'}/${file}`,
        sampleRate,
        speakers,
        espeakVoice,
        available: true
      });
    }
  }
  voices.sort((a, b) => (a.language === b.language ? a.label.localeCompare(b.label) : a.language.localeCompare(b.language)));
  return voices;
}

function resolveVoice(voices, language, requested) {
  const langVoices = voices.filter((v) => v.language === language);
  if (langVoices.length === 0) return null;
  if (requested && requested !== 'auto') {
    const exact = langVoices.find((v) => v.id === requested);
    if (exact) return exact;
  }
  return langVoices[0];
}

function defaultVoiceId(voices, config, language) {
  const configured = (config && config.tts && config.tts.voices && config.tts.voices[language]) || 'auto';
  const resolved = resolveVoice(voices, language, configured);
  return resolved ? resolved.id : 'auto';
}

module.exports = { VOICE_DIRS, discoverVoices, resolveVoice, defaultVoiceId };
