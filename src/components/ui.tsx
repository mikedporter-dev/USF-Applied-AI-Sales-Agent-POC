import type { ReactNode } from "react";
import { SIGNAL_LABELS } from "../shared/scoring";
import type { Signal, Tier } from "../shared/types";

export const PRODUCT_NAME = "Inroad";

/** Cluster of soft colored shapes used as the brand mark and section accents. */
export function Shapes({ size = 22 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s * 3.4} height={s} viewBox="0 0 68 20" aria-hidden="true">
      <rect x="0" y="5" width="11" height="11" rx="3.5" fill="var(--orange)" transform="rotate(-12 5.5 10.5)" />
      <circle cx="21" cy="10" r="7" fill="var(--pink)" />
      <path d="M32 18V9a7 7 0 0 1 14 0v9l-3.5-2-3.5 2-3.5-2z" fill="var(--purple)" />
      <rect x="51" y="3" width="14" height="14" rx="4" fill="var(--green)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect width="20" height="20" rx="6" fill="var(--ink)" />
        <path d="M6 14V9.5a4 4 0 0 1 8 0V14" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="10" cy="6" r="1.4" fill="var(--pink)" />
      </svg>
      {PRODUCT_NAME}
    </span>
  );
}

export function TierPill({ tier }: { tier: Tier }) {
  return <span className={`tier tier-${tier}`}>Tier {tier}</span>;
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score">
      <span>{label}</span>
      <div
        className="score-track"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="score-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="score-value mono">{value}</span>
    </div>
  );
}

export function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatRevenue(usd: number): string {
  return usd >= 1e9 ? `$${(usd / 1e9).toFixed(1)}B` : `$${Math.round(usd / 1e6)}M`;
}

export function signalLabel(signal: Signal): string {
  return SIGNAL_LABELS[signal.kind];
}

export function WindowFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="window">
      <div className="window-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
