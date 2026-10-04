import { Primitives } from './Primitives';

const colours = [
  { name: 'bg', hex: '#EEF1E8', fill: 'bg-bg' },
  { name: 'surface', hex: '#FFFFFF', fill: 'bg-surface' },
  { name: 'ink', hex: '#1D1D1F', fill: 'bg-ink' },
  { name: 'ink-muted', hex: '#5C5B57', fill: 'bg-ink-muted' },
  { name: 'border', hex: '#D4D2CB', fill: 'bg-border' },
  { name: 'border-strong', hex: '#B8B5AC', fill: 'bg-border-strong' },
  { name: 'brand', hex: '#F5C518', fill: 'bg-brand' },
  { name: 'brand-ink', hex: '#3D2E00', fill: 'bg-brand-ink' },
  { name: 'brand-soft', hex: '#FCEFB4', fill: 'bg-brand-soft' },
  { name: 'duck-gold', hex: '#E8B028', fill: 'bg-duck-gold' },
  { name: 'duck-beak', hex: '#F08838', fill: 'bg-duck-beak' },
  { name: 'duck-outline', hex: '#2A2A2A', fill: 'bg-duck-outline' },
  { name: 'state-grey-bg', hex: '#F1F3F4', fill: 'bg-state-grey-bg' },
  { name: 'state-grey-fg', hex: '#5F6368', fill: 'bg-state-grey-fg' },
  { name: 'state-green-bg', hex: '#E6F4EA', fill: 'bg-state-green-bg' },
  { name: 'state-green-fg', hex: '#1E7B45', fill: 'bg-state-green-fg' },
  { name: 'state-yellow-bg', hex: '#FFF4D6', fill: 'bg-state-yellow-bg' },
  { name: 'state-yellow-fg', hex: '#8A6100', fill: 'bg-state-yellow-fg' },
  { name: 'state-red-bg', hex: '#FCE8E6', fill: 'bg-state-red-bg' },
  { name: 'state-red-fg', hex: '#B3261E', fill: 'bg-state-red-fg' },
] as const;

const typeStyles = [
  { className: 'text-display', sample: 'Display', spec: '64/68 Fredoka 600' },
  { className: 'text-title', sample: 'Title', spec: '32/36 Fredoka 600' },
  { className: 'text-section', sample: 'Section', spec: '22/28 Fredoka 600' },
  { className: 'text-lead', sample: 'Lead. Teach it out loud.', spec: '19/30 Geist, ink-muted' },
  { className: 'text-body', sample: 'Body. The duck listens, then asks.', spec: '16/26 Geist' },
  { className: 'text-small', sample: 'Small. A caption under a card.', spec: '13/20 Geist' },
  { className: 'text-label', sample: 'Label', spec: '13/16 Geist 500, uppercase' },
] as const;

const badges = [
  { label: 'Not yet', dot: 'bg-state-grey-fg' },
  { label: 'Skipped', dot: 'bg-state-grey-fg' },
  { label: 'Owned', dot: 'bg-state-green-fg' },
  { label: 'Assisted', dot: 'bg-state-yellow-fg' },
  { label: 'Explained to', dot: 'bg-state-red-fg' },
  { label: 'Misconception', dot: 'bg-state-red-fg' },
] as const;

const concepts = [
  {
    state: 'Not yet',
    title: 'Osmosis',
    body: 'On the list. Not taught yet.',
    bg: 'bg-state-grey-bg',
    fg: 'text-state-grey-fg',
  },
  {
    state: 'Owned',
    title: 'Photosynthesis',
    body: 'Taught without a hint.',
    bg: 'bg-state-green-bg',
    fg: 'text-state-green-fg',
  },
  {
    state: 'Assisted',
    title: 'Mitosis',
    body: 'Got there with a nudge.',
    bg: 'bg-state-yellow-bg',
    fg: 'text-state-yellow-fg',
  },
  {
    state: 'Explained to',
    title: 'Diffusion',
    body: 'The duck had to explain it.',
    bg: 'bg-state-red-bg',
    fg: 'text-state-red-fg',
  },
] as const;

export default function StyleguidePage() {
  return (
    <main className="max-w-content mx-auto w-full px-5 py-14">
      <p className="text-label">Study Duck</p>
      <h1 className="mt-3 text-title">Styleguide</h1>
      <p className="mt-3 max-w-[36rem] text-lead">
        Paper, yellow, and the six ways a concept can sit with the duck.
      </p>

      <section className="mt-14">
        <h2 className="text-label">Colour</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {colours.map((colour) => (
            <li key={colour.name} className="overflow-hidden rounded-card border border-border bg-surface">
              <div className={`h-14 border-b border-border ${colour.fill}`} />
              <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                <span className="text-small text-ink">{colour.name}</span>
                <span className="text-small text-ink-muted">{colour.hex}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Type</h2>
        <div className="mt-4 flex flex-col gap-8">
          {typeStyles.map((style) => (
            <div key={style.className}>
              <p className={style.className}>{style.sample}</p>
              <p className="mt-1 text-small text-ink-muted">
                {style.className} · {style.spec}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Primitives />

      <section className="mt-14">
        <h2 className="text-label">States</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <li
              key={badge.label}
              className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface py-1 pr-3 pl-2 text-ink"
            >
              <span className={`size-2 rounded-pill ${badge.dot}`} />
              <span className="text-small">{badge.label}</span>
            </li>
          ))}
        </ul>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {concepts.map((concept) => (
            <li key={concept.state} className={`rounded-card p-5 ${concept.bg}`}>
              <p className={`text-small font-medium ${concept.fg}`}>{concept.state}</p>
              <h3 className="mt-1 text-section">{concept.title}</h3>
              <p className="mt-2 text-small text-ink">{concept.body}</p>
            </li>
          ))}
        </ul>
      </section>

    </main>
  );
}
