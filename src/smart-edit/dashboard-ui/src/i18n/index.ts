import { createContext, useContext } from 'react';
import { en } from './en';
import { ja } from './ja';

export type Locale = 'en' | 'ja';

const translations = { en, ja } as const;

type TranslationKeys = typeof en;

function getNestedValue(obj: unknown, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : undefined;
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function createTranslationFunction(locale: Locale) {
  return function t(key: string, params?: Record<string, string | number>): string {
    let text = getNestedValue(translations[locale], key);

    if (!text) {
      // Fallback to English
      text = getNestedValue(translations.en, key);
    }

    if (!text) {
      // Return key if not found
      return key;
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text!.replace(`{${k}}`, String(v));
      });
    }

    return text;
  };
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem('smart-edit-locale');
  if (stored === 'ja' || stored === 'en') return stored;
  // Default based on browser language
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

export function storeLocale(locale: Locale): void {
  localStorage.setItem('smart-edit-locale', locale);
}

export type { TranslationKeys };
