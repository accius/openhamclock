import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import translationEN from './en.json';
import translationFR from './fr.json';
import translationES from './es.json';
import translationCA from './ca.json';
import translationDE from './de.json';
import translationPT from './pt.json';
import translationJA from './ja.json';
import translationIT from './it.json';
import translationNL from './nl.json';
import translationKO from './ko.json';
import translationSL from './sl.json';
import translationMS from './ms.json';
import translationRU from './ru.json';
import translationKA from './ka.json';

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ca', name: 'Catala', flag: '🇦🇩' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'sl', name: 'Slovenščina', flag: '🇸🇮' },
  { code: 'ms', name: 'Melayu', flag: '🇲🇾' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ka', name: 'ქართული', flag: '🇬🇪' },
];

export const resources = {
  en: { translation: translationEN },
  fr: { translation: translationFR },
  es: { translation: translationES },
  ca: { translation: translationCA },
  de: { translation: translationDE },
  nl: { translation: translationNL },
  pt: { translation: translationPT },
  ja: { translation: translationJA },
  ko: { translation: translationKO },
  it: { translation: translationIT },
  sl: { translation: translationSL },
  ms: { translation: translationMS },
  ru: { translation: translationRU },
  ka: { translation: translationKA },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    resources,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
