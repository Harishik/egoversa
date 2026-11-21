import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AboutPanel } from './components/panels/AboutPanel';
import { GuidedDemo } from './components/panels/GuidedDemo';
import { Tip } from './components/ui/controls';
import { ENVIRONMENTS } from './scenes/environments';
import { useStudio, type Workspace } from './store/useStudio';

const SceneLab = lazy(() => import('./components/workspaces/SceneLab').then((m) => ({ default: m.SceneLab })));
const QuestionArena = lazy(() => import('./components/workspaces/QuestionArena').then((m) => ({ default: m.QuestionArena })));
const Benchmark = lazy(() => import('./components/workspaces/Benchmark').then((m) => ({ default: m.Benchmark })));
const PhysicsLab = lazy(() => import('./components/workspaces/PhysicsLab').then((m) => ({ default: m.PhysicsLab })));
const Models = lazy(() => import('./components/workspaces/Models').then((m) => ({ default: m.Models })));

const NAV: { id: Workspace; label: string; key: string; blurb: string; icon: ReactNode }[] = [
  {
    id: 'lab', label: 'Scene Lab', key: 'L', blurb: 'Build a world and place the viewer',
    icon: <path d="M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  },
  {
    id: 'physics', label: 'Physics Lab', key: 'P', blurb: 'MuJoCo scenes and what-if rollouts',
    icon: <path d="M12 3v5m0 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-7 13h14M7 21h10" />,
  },
  {
    id: 'arena', label: 'Question Arena', key: 'Q', blurb: 'Answer viewpoint questions',
    icon: <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  },
  {
    id: 'bench', label: 'Benchmark', key: 'B', blurb: 'Score reasoners across viewpoints',
    icon: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  },
  {
    id: 'models', label: 'Models', key: 'M', blurb: 'Compare real vision-language models',
    icon: <path d="M9 3h6m-6 18h6M4 9v6m16-6v6M7 7h10v10H7zM10 10h4v4h-4z" />,
  },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="panel m-auto max-w-lg p-8 text-center">
        <p className="font-display text-3xl text-ink">This workspace stopped</p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{this.state.error.message}</p>
        <p className="mt-2 text-[12.5px] text-dim">Your saved scenarios are untouched. If the 3D view failed, check that WebGL is enabled.</p>
        <button className="btn btn-primary mt-5" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function Loading() {
  return (
    <div className="grid h-full place-items-center" role="status">
      <p className="text-[13px] text-muted">Loading workspace…</p>
    </div>
  );
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStudio.getState();
      if (s.aboutOpen) return;
      const lim = s.scene.limits;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const handled = (): boolean => {
        switch (k) {
          case 'ArrowLeft': s.nudgeAzimuth(e.shiftKey ? -30 : -5); return true;
          case 'ArrowRight': s.nudgeAzimuth(e.shiftKey ? 30 : 5); return true;
          case 'ArrowUp': s.setViewer({ height: s.viewer.height + (lim.maxHeight - lim.minHeight) / 24 }); return true;
          case 'ArrowDown': s.setViewer({ height: s.viewer.height - (lim.maxHeight - lim.minHeight) / 24 }); return true;
          case '[': s.setViewer({ distance: s.viewer.distance - (lim.maxDistance - lim.minDistance) / 24 }); return true;
          case ']': s.setViewer({ distance: s.viewer.distance + (lim.maxDistance - lim.minDistance) / 24 }); return true;
          case 'v': if (s.workspace === 'lab') s.setViewMode(s.viewMode === 'world' ? 'viewer' : 'world'); return s.workspace === 'lab';
          case 'n': s.newSeed(); return true;
          case 'l': s.setWorkspace('lab'); return true;
          case 'q': s.setWorkspace('arena'); return true;
          case 'b': s.setWorkspace('bench'); return true;
          case 'm': s.setWorkspace('models'); return true;
          case 'p': s.setWorkspace('physics'); return true;
          case '?': s.setAboutOpen(true); return true;
          default: return false;
        }
      };
      if (handled()) {
        if (!s.heroSeen && k.startsWith('Arrow')) s.setHeroSeen(true);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const workspace = useStudio((s) => s.workspace);
  const setWorkspace = useStudio((s) => s.setWorkspace);
  const spec = useStudio((s) => s.spec);
  const fingerprint = useStudio((s) => s.scene.fingerprint);
  const nObjects = useStudio((s) => s.scene.objects.length);
  const setAboutOpen = useStudio((s) => s.setAboutOpen);
  const setDemoStep = useStudio((s) => s.setDemoStep);
  const setHeroSeen = useStudio((s) => s.setHeroSeen);
  const toast = useStudio((s) => s.toast);
  useGlobalKeys();
  const active = NAV.find((n) => n.id === workspace)!;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-indigo focus:px-3 focus:py-2 focus:text-night-950">Skip to workspace</a>

      <nav aria-label="Workspaces" className="order-last flex shrink-0 items-center gap-1 border-t hairline bg-night-900/80 px-2 py-2 lg:order-first lg:w-[216px] lg:flex-col lg:items-stretch lg:border-r lg:border-t-0 lg:px-3 lg:py-5">
        <div className="hidden items-center gap-2.5 px-2 pb-6 lg:flex">
          <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
            <circle cx="32" cy="32" r="19" fill="none" stroke="#F0B866" strokeWidth="3.5" />
            <path d="M8 32c7-12 15-18 24-18s17 6 24 18c-7 12-15 18-24 18S15 44 8 32z" fill="none" stroke="#5CE1E6" strokeWidth="3.5" />
            <circle cx="32" cy="32" r="6" fill="#7C87FF" />
          </svg>
          <div>
            <p className="text-[15px] font-extrabold tracking-[0.14em] text-ink">EGOVERSA</p>
            <p className="text-[11px] text-dim">Same world. Different eyes.</p>
          </div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            data-testid={`nav-${n.id}`}
            aria-current={workspace === n.id ? 'page' : undefined}
            onClick={() => setWorkspace(n.id)}
            className={`flex flex-1 items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors lg:flex-none lg:justify-start ${workspace === n.id ? 'bg-night-700 text-ink shadow-glow' : 'text-muted hover:bg-night-800 hover:text-ink'}`}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{n.icon}</svg>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-bold">{n.label}</span>
              <span className="hidden text-[11.5px] font-medium text-dim lg:block">{n.blurb}</span>
            </span>
          </button>
        ))}
        <div className="hidden lg:mt-auto lg:block">
          <button className="btn btn-ghost w-full justify-start" onClick={() => { setHeroSeen(true); setDemoStep(0); }}>Guided tour</button>
          <button className="btn btn-ghost w-full justify-start" onClick={() => setAboutOpen(true)} data-testid="open-about">About and methods</button>
          <p className="mt-3 px-3 text-[11px] leading-relaxed text-dim">v0.3, independent prototype. Local-first: nothing leaves this browser.</p>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-2 pt-3 lg:px-5">
          <h1 className="font-display text-[1.7rem] leading-none text-ink">{active.label}</h1>
          {workspace !== 'physics' && workspace !== 'models' && (
            <>
            <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-world" />{ENVIRONMENTS[spec.env].label}</span>
          <Tip side="bottom" text="Seed of the current scene. The fingerprint is a digest of every object transform; equal fingerprints mean identical worlds.">
            <span className="chip num" tabIndex={0}>{spec.seed} <span className="text-dim">#{fingerprint}</span></span>
          </Tip>
          <span className="chip num">{nObjects} objects</span>
            </>
          )}
          <span className="ml-auto flex gap-1.5 lg:hidden">
            <button className="btn" onClick={() => { setHeroSeen(true); setDemoStep(0); }}>Tour</button>
            <button className="btn" onClick={() => setAboutOpen(true)}>About</button>
          </span>
        </header>
        <main id="main" className="min-h-0 flex-1 px-3 pb-3 lg:px-5 lg:pb-4">
          <ErrorBoundary key={workspace}>
            <Suspense fallback={<Loading />}>
              {workspace === 'lab' && <SceneLab />}
              {workspace === 'physics' && <PhysicsLab />}
              {workspace === 'arena' && <QuestionArena />}
              {workspace === 'bench' && <Benchmark />}
              {workspace === 'models' && <Models />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <AboutPanel />
      <GuidedDemo />
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-end px-4">
          <div key={toast.id} role="status" className={`animate-rise rounded-xl border px-4 py-2.5 text-[13px] font-semibold shadow-2xl ${toast.tone === 'ok' ? 'border-mint/40 bg-night-800 text-ink' : 'border-rose/50 bg-night-800 text-rose'}`}>
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
