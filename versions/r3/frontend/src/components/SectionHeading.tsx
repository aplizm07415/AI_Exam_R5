import React from 'react';
import AnimatedTitle from './AnimatedTitle';

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
  titleClassName?: string;
  className?: string;
  toneClassName?: string;
}

export default function SectionHeading({
  eyebrow,
  title,
  description,
  titleClassName = '',
  className = '',
  toneClassName = 'text-slate-400',
}: SectionHeadingProps) {
  return (
    <div className={`section-heading ${className}`.trim()}>
      <div className={`section-heading-eyebrow ${toneClassName}`.trim()}>{eyebrow}</div>
      <h2 className={`section-heading-title ${titleClassName}`.trim()}>
        <AnimatedTitle text={title} />
      </h2>
      {description ? <p className="section-heading-description">{description}</p> : null}
    </div>
  );
}
