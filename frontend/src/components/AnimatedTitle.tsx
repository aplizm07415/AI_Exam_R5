import React from 'react';

export default function AnimatedTitle({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`motion-title ${className}`.trim()} aria-label={text}>
      {Array.from(text).map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="motion-title-char"
          style={{ animationDelay: `${index * 45}ms` }}
          aria-hidden="true"
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  );
}
