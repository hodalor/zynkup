import { useEffect, useMemo, useState } from 'react';
import './PublicCardPage.css';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://zynkup-api-597625475865.europe-west9.run.app';

type PublicCard = {
  code: string;
  displayName: string;
  title?: string;
  businessName?: string;
  phone?: string;
  handle?: string;
  email?: string;
  bio?: string;
  avatarUrl?: string;
  theme?: string;
  ownerUserId?: string;
  deepLink?: string;
  webUrl?: string;
};

const THEME_STYLES: Record<string, { bg: string; accent: string }> = {
  navy: { bg: '#0A0B30', accent: '#22D3EE' },
  cyan: { bg: '#083344', accent: '#22D3EE' },
  magenta: { bg: '#3B0764', accent: '#EC4899' },
  lime: { bg: '#14532D', accent: '#A3E635' },
  sunset: { bg: '#7C2D12', accent: '#FB923C' },
};

type PublicCardPageProps = {
  code: string;
};

export function getCardCodeFromLocation(search = window.location.search, pathname = window.location.pathname) {
  const params = new URLSearchParams(search);
  const fromQuery = params.get('card')?.trim();
  if (fromQuery) return fromQuery;
  const pathMatch = pathname.replace(/\/+$/, '').match(/^\/card\/([A-Za-z0-9_-]+)$/i);
  return pathMatch?.[1] || '';
}

export default function PublicCardPage({ code }: PublicCardPageProps) {
  const [card, setCard] = useState<PublicCard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE_URL}/api/cards/${encodeURIComponent(code)}`);
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !payload.card) {
          setError(payload.error || 'Card not found');
          setCard(null);
          return;
        }
        setCard(payload.card as PublicCard);
      } catch {
        if (!cancelled) {
          setError('Could not load this card');
          setCard(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const theme = useMemo(
    () => THEME_STYLES[card?.theme || 'navy'] || THEME_STYLES.navy,
    [card?.theme],
  );

  const openInApp = () => {
    const deep = card?.deepLink || `zynkup://card/${code}`;
    window.location.href = deep;
  };

  return (
    <main className="public-card">
      <header className="public-card-top">
        <a className="public-card-brand" href="/">ZynkUp</a>
        <a className="public-card-home" href="/">Open app</a>
      </header>

      {loading ? <p className="public-card-status">Loading card…</p> : null}
      {error ? <p className="public-card-status public-card-error">{error}</p> : null}

      {card ? (
        <article className="public-card-sheet" style={{ background: theme.bg, borderColor: theme.accent }}>
          {card.avatarUrl ? (
            <img alt="" className="public-card-avatar" src={card.avatarUrl} />
          ) : (
            <div className="public-card-avatar public-card-avatar-fallback">
              {(card.displayName || 'ZU').slice(0, 2).toUpperCase()}
            </div>
          )}
          <h1>{card.displayName}</h1>
          {card.title ? <p className="public-card-title">{card.title}</p> : null}
          {card.businessName ? (
            <p className="public-card-business" style={{ color: theme.accent }}>{card.businessName}</p>
          ) : null}
          <p className="public-card-meta">
            {[card.handle, card.phone, card.email].filter(Boolean).join(' · ')}
          </p>
          {card.bio ? <p className="public-card-bio">{card.bio}</p> : null}
          <div className="public-card-actions">
            <button className="public-card-primary" onClick={openInApp} style={{ background: theme.accent }} type="button">
              Open in ZynkUp
            </button>
            {card.phone ? (
              <a className="public-card-secondary" href={`tel:${card.phone}`}>Call</a>
            ) : null}
            {card.email ? (
              <a className="public-card-secondary" href={`mailto:${card.email}`}>Email</a>
            ) : null}
          </div>
          <p className="public-card-code" style={{ color: theme.accent }}>zynkup.app/?card={card.code}</p>
        </article>
      ) : null}
    </main>
  );
}
