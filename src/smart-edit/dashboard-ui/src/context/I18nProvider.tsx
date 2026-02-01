import { useMemo, type ReactNode } from 'react';
import { useDashboardState, useDashboardDispatch } from './DashboardContext';
import { I18nContext, createTranslationFunction } from '../i18n';
import type { Locale } from '../types';

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale } = useDashboardState();
  const dispatch = useDashboardDispatch();

  const value = useMemo(() => {
    const t = createTranslationFunction(locale);
    const setLocale = (newLocale: Locale) => {
      dispatch({ type: 'SET_LOCALE', locale: newLocale });
    };
    return { locale, setLocale, t };
  }, [locale, dispatch]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
