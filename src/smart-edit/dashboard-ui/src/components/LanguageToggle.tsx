import { useTranslation } from '../i18n';

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function LanguageToggle() {
  const { locale, setLocale } = useTranslation();

  const handleToggle = () => {
    const newLocale = locale === 'en' ? 'ja' : 'en';
    setLocale(newLocale);
  };

  return (
    <button
      className="language-toggle"
      onClick={handleToggle}
      title={locale === 'en' ? '日本語に切り替え' : 'Switch to English'}
      aria-label={locale === 'en' ? '日本語に切り替え' : 'Switch to English'}
    >
      <span className="icon"><GlobeIcon /></span>
      <span className="language-code">{locale.toUpperCase()}</span>
    </button>
  );
}
