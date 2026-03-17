import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import translationCA from "./ca.json";
import translationDE from "./de.json";
import translationEN from "./en.json";
import translationES from "./es.json";
import translationFR from "./fr.json";
import translationIT from "./it.json";
import translationJA from "./ja.json";
import translationKA from "./ka.json";
import translationKO from "./ko.json";
import translationMS from "./ms.json";
import translationNL from "./nl.json";
import translationPT from "./pt.json";
import translationRU from "./ru.json";
import translationSL from "./sl.json";
import translationTH from "./th.json";

export const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "ca", name: "Catala", flag: "🇦🇩" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Português", flag: "🇧🇷" },
  { code: "ja", name: "日本", flag: "🇯🇵" },
  { code: "ka", name: "ქართული", flag: "🇬🇪" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "ms", name: "Melayu", flag: "🇲🇾" },
  { code: "ru", name: "Русский", flag: "🇷🇺" },
  { code: "sl", name: "Slovenščina", flag: "🇸🇮" },
  { code: "th", name: "ไทย", flag: "🇹🇭" },
];

export const resources = {
  ca: { translation: translationCA },
  de: { translation: translationDE },
  en: { translation: translationEN },
  es: { translation: translationES },
  fr: { translation: translationFR },
  it: { translation: translationIT },
  ja: { translation: translationJA },
  ka: { translation: translationKA },
  ko: { translation: translationKO },
  ms: { translation: translationMS },
  nl: { translation: translationNL },
  pt: { translation: translationPT },
  ru: { translation: translationRU },
  sl: { translation: translationSL },
  th: { translation: translationTH },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    resources,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
