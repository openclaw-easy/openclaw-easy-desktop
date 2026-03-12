import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import zh from './locales/zh.json'
import de from './locales/de.json'
import ja from './locales/ja.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', flag: '\u{1F1FA}\u{1F1F8}', label: 'English' },
  { code: 'es', flag: '\u{1F1EA}\u{1F1F8}', label: 'Espa\u00f1ol' },
  { code: 'pt', flag: '\u{1F1E7}\u{1F1F7}', label: 'Portugu\u00eas' },
  { code: 'zh', flag: '\u{1F1E8}\u{1F1F3}', label: '\u4E2D\u6587' },
  { code: 'de', flag: '\u{1F1E9}\u{1F1EA}', label: 'Deutsch' },
  { code: 'ja', flag: '\u{1F1EF}\u{1F1F5}', label: '\u65E5\u672C\u8A9E' },
] as const

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    pt: { translation: pt },
    zh: { translation: zh },
    de: { translation: de },
    ja: { translation: ja },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
