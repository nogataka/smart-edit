import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { fetchMemoryContent } from '../../utils/api';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  memories: string[];
  baseUrl?: string;
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function OnboardingModal({ isOpen, onClose, memories, baseUrl }: OnboardingModalProps) {
  const { t } = useTranslation();
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null);
  const [memoryContent, setMemoryContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedMemory(null);
      setMemoryContent('');
      setError(null);
    }
  }, [isOpen]);

  // Auto-select first memory when modal opens
  useEffect(() => {
    if (isOpen && memories.length > 0 && !selectedMemory) {
      handleSelectMemory(memories[0]);
    }
  }, [isOpen, memories]);

  const handleSelectMemory = async (name: string) => {
    setSelectedMemory(name);
    setIsLoading(true);
    setError(null);

    try {
      const content = await fetchMemoryContent(name, baseUrl);
      setMemoryContent(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
      setMemoryContent('');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('onboarding.title')}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label={t('onboarding.close')}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          {memories.length === 0 ? (
            <div className="no-memories">{t('onboarding.noMemories')}</div>
          ) : (
            <>
              <div className="memory-list">
                {memories.map((name) => (
                  <button
                    key={name}
                    className={`memory-item ${selectedMemory === name ? 'active' : ''}`}
                    onClick={() => handleSelectMemory(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {selectedMemory && (
                <div className="memory-content">
                  <h3>{selectedMemory}</h3>
                  {isLoading ? (
                    <div className="memory-loading">{t('onboarding.loading')}</div>
                  ) : error ? (
                    <div className="memory-error">{error}</div>
                  ) : (
                    <pre>{memoryContent}</pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
