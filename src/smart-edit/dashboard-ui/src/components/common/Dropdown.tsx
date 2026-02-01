import { useState, useRef, useEffect } from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  placeholder?: string;
  className?: string;
  multiple?: boolean;
}

export function Dropdown({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  className = '',
  multiple = true
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleOptionClick = (value: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(value)) {
      newSelected.delete(value);
    } else {
      if (!multiple) {
        newSelected.clear();
      }
      newSelected.add(value);
    }
    onChange(newSelected);
  };

  const handleClearAll = () => {
    onChange(new Set());
  };

  const getDisplayText = () => {
    if (selected.size === 0) {
      return placeholder;
    }
    if (selected.size === 1) {
      const value = Array.from(selected)[0];
      const option = options.find((o) => o.value === value);
      return option?.label || value;
    }
    return `${selected.size} selected`;
  };

  return (
    <div className={`dropdown ${className}`} ref={dropdownRef}>
      <button type="button" className="dropdown-trigger" onClick={handleToggle}>
        <span className="dropdown-text">{getDisplayText()}</span>
        <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="dropdown-menu">
          {multiple && selected.size > 0 && (
            <button type="button" className="dropdown-clear" onClick={handleClearAll}>
              Clear all
            </button>
          )}
          <div className="dropdown-options">
            {options.map((option) => (
              <label key={option.value} className="dropdown-option">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  checked={selected.has(option.value)}
                  onChange={() => handleOptionClick(option.value)}
                />
                <span className="dropdown-option-label">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
