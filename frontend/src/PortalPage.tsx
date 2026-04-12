import React from 'react';
import { Link } from 'react-router-dom';
import SectionHeading from './components/SectionHeading';

export default function PortalPage() {
  const portalLinks = [
    {
      href: '/',
      label: 'Webアプリ',
      note: '学習と復習のメイン導線',
      tone: 'bg-[#3d7cce] hover:bg-[#356db5]',
      kind: 'internal' as const,
    },
    {
      href: 'https://kakomonn.com/account/login',
      label: '診断士一次',
      note: '外部サービスへすぐ移動',
      tone: 'bg-[#2cb4ad] hover:bg-[#249a94]',
      kind: 'external' as const,
    },
    {
      href: 'https://www.ap-siken.com/apkakomon.php',
      label: '応用情報',
      note: '関連学習へのショートカット',
      tone: 'bg-[#cf483e] hover:bg-[#b83f36]',
      kind: 'external' as const,
    },
  ];

  return (
    <div className="motion-page mx-auto flex min-h-[calc(100vh-220px)] max-w-6xl flex-col justify-center">
      <section className="motion-rise motion-delay-1 rounded-[2rem] border border-slate-200 bg-white px-6 py-8 shadow-sm md:px-10 md:py-12">
        <SectionHeading
          eyebrow="Study Portal"
          title="学習の入口"
          description="必要な学習先へすばやく移動できる、軽くて見通しの良いポータルです。静かな立ち上がりと、触れたときだけ反応するカードで整理しています。"
          titleClassName="text-4xl md:text-5xl text-slate-900"
          className="max-w-3xl"
          toneClassName="text-[#3d7cce]"
        />
      </section>

      <div className="mt-8 grid w-full grid-cols-1 gap-6 md:grid-cols-3">
        {portalLinks.map((item, index) => {
          const content = (
            <div className={`motion-card motion-rise rounded-[1.75rem] px-6 py-8 text-white shadow-lg ${item.tone} motion-delay-${Math.min(index + 2, 4)}`}>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-white/75">Destination</div>
              <div className="motion-button-text mt-6 text-3xl font-bold tracking-tight">{item.label}</div>
              <p className="mt-4 text-sm leading-7 text-white/80">{item.note}</p>
            </div>
          );

          if (item.kind === 'internal') {
            return (
              <Link key={item.label} to={item.href} className="block">
                {content}
              </Link>
            );
          }

          return (
            <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="block">
              {content}
            </a>
          );
        })}
      </div>
    </div>
  );
}
