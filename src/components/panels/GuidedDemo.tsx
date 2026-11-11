import { useEffect } from 'react';
import { useStudio, type StudioState } from '../../store/useStudio';

interface Step {
  title: string;
  body: string;
  enter: (s: StudioState) => void;
}

const STEPS: Step[] = [
  {
    title: 'One world, two sets of axes',
    body: 'The amber axes belong to the world and never move. The cyan camera is the viewer: every question is asked from where it stands. Drag the viewport to look around; nothing about the scene changes.',
    enter: (s) => { s.setWorkspace('lab'); s.setViewMode('world'); s.animateViewer({ azimuthDeg: 0 }); },
  },
  {
    title: 'Move the viewer',
    body: 'The viewer just orbited 130° to the other side. Watch the inset: same objects, mirrored layout. The table below shows world coordinates frozen while camera coordinates change. Try ← and → yourself.',
    enter: (s) => { s.setWorkspace('lab'); s.setViewMode('world'); s.animateViewer({ azimuthDeg: 130 }, 1800); },
  },
  {
    title: 'See through its eyes',
    body: 'The main view is now flying into the viewer’s pose. Press V at any time to swap between the outside view and the viewer’s eyes.',
    enter: (s) => { s.setWorkspace('lab'); s.setViewMode('viewer'); },
  },
  {
    title: 'Answer from the image alone',
    body: 'The Question Arena shows only the viewer’s image. Generate questions, pick an answer, and the app reveals the geometric ground truth next to what two limited heuristics predicted. Ground truth is computed; predictions can be wrong.',
    enter: (s) => { s.setViewMode('world'); s.setWorkspace('arena'); },
  },
  {
    title: 'Measure the shortcuts',
    body: 'Press “Run benchmark”. Hundreds of seeded scenes are viewed from seven camera shifts, and each reasoner is scored per relation. Open any failure to replay it. Every number is measured live.',
    enter: (s) => { s.setWorkspace('bench'); },
  },
];

export function GuidedDemo() {
  const step = useStudio((s) => s.demoStep);
  const setStep = useStudio((s) => s.setDemoStep);
  useEffect(() => {
    if (step === null) return;
    STEPS[step]?.enter(useStudio.getState());
  }, [step]);
  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div role="dialog" aria-label="Guided tour" aria-live="polite" className="pointer-events-auto w-full max-w-lg animate-rise rounded-2xl border border-indigo/60 bg-night-800 p-5 shadow-2xl shadow-black/60" data-testid="tour">
        <p className="num text-[11.5px] font-semibold text-indigo">Step {step + 1} of {STEPS.length}</p>
        <h2 className="mt-1 font-display text-2xl text-ink">{s.title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn btn-ghost" onClick={() => setStep(null)}>End tour</button>
          <span className="ml-auto" />
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          <button className="btn btn-primary" onClick={() => setStep(last ? null : step + 1)}>{last ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
