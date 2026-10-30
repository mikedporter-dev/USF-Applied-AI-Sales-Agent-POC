import { Logo, ScoreBar, Shapes, TierPill, WindowFrame, formatDate, signalLabel } from "../components/ui";
import { SAMPLE_ACCOUNTS, SAMPLE_AS_OF } from "../shared/sampleData";
import { COMPOSITE_WEIGHTS, CONTACT_ROLE_LADDER, OUTREACH_LIST, WINDOW_MONTHS, scoreAccounts } from "../shared/scoring";

const ranked = scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF);
const featured = ranked[0];
const pct = (w: number) => `${Math.round(w * 100)}%`;

const SOURCES: { name: string; role: string; soon?: boolean }[] = [
  { name: "LinkedIn", role: "Your first-degree connections, Manager and above" },
  { name: "Massive", role: "Size, industry, 10-K, 8-K, and Form 3 filings" },
  { name: "SEC EDGAR", role: "8-K exhibits, 10-K and 10-Q MD&A" },
  { name: "Apollo", role: "One target contact per account, email after approval", soon: true },
  { name: "NVIDIA", role: "LLM reads filings and drafts the why-now" },
  { name: "Supabase", role: "Accounts, signals, and approvals in one place" },
];

const STEPS: { title: string; body: string; soon?: boolean }[] = [
  {
    title: "Start from your network",
    body: "Match first-degree LinkedIn connections at Manager level or above against the S&P Composite 1500. Only companies where you know someone get scored.",
  },
  {
    title: "Read 12 months of filings",
    body: "10-K Business and Risk Factors, 8-Ks for officer changes, acquisitions, and restructurings, and Form 3s from Massive. Earnings releases, investor decks, and MD&A from EDGAR. Joined on each company's CIK.",
  },
  {
    title: "Score, demote, rank",
    body: "Score Fit, Intent, and Gap. Demote companies that already publish large-scale AI results. Rank the rest into priority tiers.",
  },
  {
    title: "Find who to reach",
    soon: true,
    body: `For the top ${OUTREACH_LIST.min}–${OUTREACH_LIST.max} accounts, Tier 1 first, Apollo finds one target contact. Emails are enriched only after you approve the list, within your credits.`,
  },
];

const ROADMAP = [
  {
    title: "Apollo contacts",
    status: "Coming soon",
    body: `For the top ${OUTREACH_LIST.min}–${OUTREACH_LIST.max} accounts, find one target contact by walking the role ladder, and enrich their email only after you approve them.`,
  },
  {
    title: "AI team benchmarks",
    status: "Needs paid data",
    body: "How a company's AI headcount and hiring compare with what its stated ambition requires.",
  },
  {
    title: "Peer comparisons",
    status: "Needs paid data",
    body: "Where an account sits against industry peers on AI maturity, to sharpen the gap story.",
  },
];

const SCORES = [
  {
    name: "Fit",
    weight: COMPOSITE_WEIGHTS.fit,
    body: "Company size and industry. Is this an account an AI transformation practice can serve?",
    signals: ["Revenue", "Employees", "GICS sector"],
  },
  {
    name: "Intent",
    weight: COMPOSITE_WEIGHTS.intent,
    body: "Concrete AI commitments, leadership changes, and AI-driven reorgs. Is something moving right now?",
    signals: ["AI commitments", "New officers", "Acquisitions", "Reorgs"],
  },
  {
    name: "Gap",
    weight: COMPOSITE_WEIGHTS.gap,
    body: "Stated ambition with nothing to show for it yet. Pilots and programs with no reported results.",
    signals: ["Pilots, no results", "Ambition without outcomes"],
  },
];

function Nav() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="/" aria-label="Inroad home">
          <Logo />
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#scoring">Scoring</a>
          <a href="#sources">Data sources</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
        <a className="btn btn-primary btn-sm" href="/app/">
          Open accounts
        </a>
      </div>
    </header>
  );
}

function HeroPreview() {
  return (
    <div className="hero-stage">
      <WindowFrame title="Ranked accounts · sample data">
        <div className="preview">
          <ol className="preview-list">
            {ranked.slice(0, 5).map((a) => (
              <li key={a.company.cik} className={a === featured ? "is-active" : undefined}>
                <span className="mono preview-rank">{String(a.rank).padStart(2, "0")}</span>
                <span className="preview-name">
                  <strong>{a.company.name}</strong>
                  <small>{a.whyNow ? signalLabel(a.whyNow) : a.company.industry}</small>
                </span>
                <TierPill tier={a.tier} />
                <span className="mono preview-total">{a.scores.total}</span>
              </li>
            ))}
          </ol>
          <aside className="preview-detail">
            <div className="preview-detail-head">
              <strong>{featured.company.name}</strong>
              <TierPill tier={featured.tier} />
            </div>
            <ScoreBar label="Fit" value={featured.scores.fit} />
            <ScoreBar label="Intent" value={featured.scores.intent} />
            <ScoreBar label="Gap" value={featured.scores.gap} />
            {featured.whyNow && (
              <div className="preview-block">
                <span className="label">Why now</span>
                <p>{featured.whyNow.summary}</p>
                <span className="chip">
                  {featured.whyNow.form} · {formatDate(featured.whyNow.filedAt)}
                </span>
              </div>
            )}
            {featured.warmPath && (
              <div className="preview-block">
                <span className="label">Who can get you in</span>
                <p>
                  {featured.warmPath.name}, {featured.warmPath.title}
                </p>
              </div>
            )}
          </aside>
        </div>
      </WindowFrame>
    </div>
  );
}

function AccountAnatomy() {
  const items = [
    { q: "Why it ranks", a: featured.whyRanks.join(" · ") },
    { q: "Why now", a: featured.whyNow ? `${featured.whyNow.summary} (${featured.whyNow.form}, ${formatDate(featured.whyNow.filedAt)})` : "—" },
    { q: "Who can get you in", a: featured.warmPath ? `${featured.warmPath.name}, ${featured.warmPath.title}` : "—" },
    { q: "Who you're trying to reach", a: featured.targetContact ? `${featured.targetContact.name}, ${featured.targetContact.title}` : "—" },
  ];
  return (
    <div className="anatomy">
      <div className="anatomy-head">
        <div>
          <strong>{featured.company.name}</strong>
          <span>
            {featured.company.industry} · {featured.company.index}
          </span>
        </div>
        <TierPill tier={featured.tier} />
      </div>
      <dl>
        {items.map((item) => (
          <div key={item.q}>
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Landing() {
  return (
    <>
      <Nav />
      <main>
        <section className="hero container">
          <Shapes />
          <h1>
            Find the enterprises ready to buy AI, and the person who can get you in.
          </h1>
          <p className="lede">
            Inroad starts from your LinkedIn network, scores S&amp;P 1500 companies on {WINDOW_MONTHS} months of SEC
            filings, and hands you a ranked list showing why each account ranks, why now, and your warm path.
          </p>
          <div className="actions">
            <a className="btn btn-primary btn-lg" href="/app/">
              Open the account list
            </a>
            <a className="btn btn-ghost btn-lg" href="#scoring">
              How scoring works
            </a>
          </div>
          <HeroPreview />
        </section>

        <section className="container split" id="sources">
          <div className="source-grid">
            {SOURCES.map((s) => (
              <div key={s.name} className="source">
                <strong>
                  {s.name}
                  {s.soon && <em className="soon">Coming soon</em>}
                </strong>
                <span>{s.role}</span>
              </div>
            ))}
          </div>
          <div className="split-copy">
            <h2>
              <span className="dim">Public signals,</span> read the same way <span className="dim">for every account.</span>
            </h2>
            <div className="stats">
              <div>
                <span className="stat-label">Companies in scope</span>
                <span className="stat mono">1,500</span>
                <span className="stat-note">S&amp;P Composite 1500</span>
              </div>
              <div>
                <span className="stat-label">Filing window</span>
                <span className="stat mono">{WINDOW_MONTHS}mo</span>
                <span className="stat-note">Trailing, by CIK</span>
              </div>
            </div>
          </div>
        </section>

        <section className="container section">
          <span className="eyebrow">The problem</span>
          <h2 className="section-title">Every enterprise talks about AI. Few are ready to buy.</h2>
          <div className="cards-3">
            <article className="card">
              <h3>Signals blur together</h3>
              <p>
                Nearly every large company mentions AI. Real buyers combine stated ambition, a visible gap to results,
                and a recent trigger.
              </p>
            </article>
            <article className="card">
              <h3>Maturity judged by instinct</h3>
              <p>Reading filings and announcements by hand is slow, and two sellers rarely reach the same call.</p>
            </article>
            <article className="card">
              <h3>Warm intros left on the table</h3>
              <p>
                Hunting through your own network comes last, so timing windows close before you find a way in.
              </p>
            </article>
          </div>
        </section>

        <section className="container section" id="how">
          <span className="eyebrow">How it works →</span>
          <h2 className="section-title">From your network to a ranked list</h2>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="mono step-num">{String(i + 1).padStart(2, "0")}</span>
                <h3>
                  {step.title}
                  {step.soon && <em className="soon">Coming soon</em>}
                </h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="container section" id="scoring">
          <span className="eyebrow">Scoring</span>
          <h2 className="section-title">Three scores, one ranked list</h2>
          <div className="score-cards">
            {SCORES.map((s) => (
              <article key={s.name} className="score-card">
                <div className="score-card-head">
                  <h3>{s.name}</h3>
                  <span className="mono weight">{pct(s.weight)}</span>
                </div>
                <p>{s.body}</p>
                <div className="chips">
                  {s.signals.map((sig) => (
                    <span key={sig} className="chip">
                      {sig}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            <article className="score-card score-card-demote">
              <div className="score-card-head">
                <h3>Demote</h3>
                <span className="mono weight">↓</span>
              </div>
              <p>
                Companies already publishing large-scale AI results are pushed down. They have less need for help, and
                more vendors calling.
              </p>
              <div className="tiers">
                <TierPill tier={1} />
                <TierPill tier={2} />
                <TierPill tier={3} />
              </div>
            </article>
          </div>
        </section>

        <section className="dark">
          <div className="container dark-inner">
            <div>
              <span className="eyebrow">What you get →</span>
              <h2 className="section-title">Every account answers four questions</h2>
              <p className="dark-lede">
                Success is a ranked list where each account shows why it ranks, why now, who in your network can get you
                in, and who you're trying to reach.
              </p>
              <div className="ladder">
                <span className="label">Target contact search order</span>
                <ol>
                  {CONTACT_ROLE_LADDER.map((roles) => (
                    <li key={roles[0]}>{roles.join(" or ")}</li>
                  ))}
                </ol>
              </div>
            </div>
            <AccountAnatomy />
          </div>
        </section>

        <section className="container section" id="roadmap">
          <span className="eyebrow">Roadmap</span>
          <h2 className="section-title">What's coming next</h2>
          <div className="cards-3">
            {ROADMAP.map((item) => (
              <article key={item.title} className="card card-muted">
                <h3>
                  {item.title}
                  <em className="soon">{item.status}</em>
                </h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container">
          <div className="cta">
            <Shapes />
            <h2>Prospect the right accounts at the right moment</h2>
            <p>See the accounts where you know someone, ranked on 12 months of SEC filings.</p>
            <a className="btn btn-primary" href="/app/">
              Open the account list
            </a>
          </div>
        </section>
      </main>
      <footer className="container footer">
        <Logo />
        <span>Proof of concept · Sample data is fictional</span>
      </footer>
    </>
  );
}
