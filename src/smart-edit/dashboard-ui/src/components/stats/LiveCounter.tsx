import { useEffect, useState, useRef } from 'react';

interface LiveCounterProps {
  value: number;
  duration?: number;
  formatter?: (value: number) => string;
  className?: string;
}

export function LiveCounter({
  value,
  duration = 500,
  formatter = (v) => v.toLocaleString(),
  className = ''
}: LiveCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const startValue = previousValue.current;
    const endValue = value;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth animation
      const easeOutQuad = 1 - (1 - progress) * (1 - progress);
      const currentValue = Math.round(startValue + (endValue - startValue) * easeOutQuad);

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValue.current = endValue;
      }
    };

    if (startValue !== endValue) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return <span className={`live-counter ${className}`}>{formatter(displayValue)}</span>;
}
