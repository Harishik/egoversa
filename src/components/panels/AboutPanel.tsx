import { useEffect, useRef } from 'react';
import { DEFAULT_TOLERANCES } from '../../tasks/generator';
import { RELATION_INFO, RELATIONS } from '../../tasks/types';
import { useStudio } from '../../store/useStudio';
import { FrameTag, Kbd } from '../ui/controls';

const REFS: { title: string; who: string; href: string; note: string }[] = [
  { title: 'Perspective-Aware Reasoning in Vision-Language Models via Mental Imagery Simulation', who: 'Lee, Je, Park, Uy, Guibas, Sung. ICCV 2025 (KAIST Visual AI Group)', href: 'https://arxiv.org/abs/2504.17207', note: 'Motivates the core question: models default to their own egocentric view and struggle when the reference viewpoint changes.' },
  { title: 'Token Warping Helps MLLMs Look from Nearby Viewpoints', who: 'Lee, Park, Park, Yoo, Koo, Sung. CVPR 2026 (KAIST Visual AI Group)', href: 'https://arxiv.org/abs/2604.02870', note: 'Viewpoint change as a first-class evaluation axis for multimodal models.' },
  { title: 'SpatialMosaic: A Multiview VLM Dataset for Partial Visibility', who: 'K. Lee et al. arXiv 2512.23365', href: 'https://kanghee-lee.github.io/spatialmosaic/', note: 'Separating occlusion by other objects from truncation by the frame; best-view selection across sparse views.' },
  { title: 'SpatialAxiom: an open spatial intelligence model', who: 'Y. Lou et al. 2026 (weights CC BY-NC 4.0)', href: 'https://huggingface.co/SpatialAxiom/SpatialAxiom-9B', note: 'The optional 9B research teacher. Its training data and code are not public.' },
  { title: 'CLEVR: A Diagnostic Dataset for Compositional Language and Elementary Visual Reasoning', who: 'Johnson et al. CVPR 2017', href: 'https://arxiv.org/abs/1612.06890', note: 'The template for procedurally generated scenes with programmatic ground truth.' },
];

export function AboutPanel() {
  const open = useStudio((s) => s.aboutOpen);
  const setOpen = useStudio((s) => s.setAboutOpen);
  const setHeroSeen = useStudio((s) => s.setHeroSeen);
  const setWorkspace = useStudio((s) => s.setWorkspace);
  const setDemoStep = useStudio((s) => s.setDemoStep);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;
  const t = DEFAULT_TOLERANCES;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-night-950/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="About EGOVERSA" className="h-full w-full max-w-2xl overflow-y-auto border-l border-night-600 bg-night-900 px-7 py-6" onClick={(e) => e.stopPropagation()} data-testid="about">
        <div className="flex items-start gap-4">
          <div>
            <h2 className="font-display text-4xl leading-none text-ink">About EGOVERSA</h2>
            <p className="mt-2 text-[13.5px] text-muted">An independent portfolio prototype. Not an official project of any lab, and not a reproduction of any paper.</p>
          </div>
          <button ref={closeRef} className="btn ml-auto" onClick={() => setOpen(false)}>Close</button>
        </div>

        <div className="mt-6 space-y-7 text-[13.5px] leading-relaxed text-muted [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:text-ink">
          <section>
            <h3>Why this exists</h3>
            <p>
              “Left of the mug” has no answer until you say whose left. A spatial relation is a statement in a reference frame, and an embodied
              observer’s frame moves with it. Work on perspective-taking in vision-language models, including from the KAIST Visual AI Group, reports
              that models tend to answer from one fixed, image-centred frame. EGOVERSA is a small instrument for studying that failure in the
              simplest possible setting: fully known 3D scenes, one movable camera, questions whose answers are computed, and reasoners whose
              shortcuts are known in advance.
            </p>
          </section>

          <section>
            <h3>Two frames, kept apart everywhere</h3>
            <p className="mb-2"><FrameTag frame="world" /> Right-handed, metres, +Y up. Fixed to the scene. Shown in amber.</p>
            <p><FrameTag frame="viewer" /> Origin at the optical centre, +x right, +y up, looking along −z. Upright (roll = 0). Orbits the scene focus by azimuth, height and distance. Shown in cyan. At azimuth 0° its x axis coincides with world X; nowhere else.</p>
          </section>

          <section>
            <h3>How each answer is defined</h3>
            <dl className="space-y-3">
              {RELATIONS.map((r) => (
                <div key={r}>
                  <dt className="font-bold text-ink">{RELATION_INFO[r].title} <span className="font-medium text-dim">in the {RELATION_INFO[r].frame}</span></dt>
                  <dd>{RELATION_INFO[r].rule}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3">
              Defaults: τ_θ = <span className="num text-ink">{t.azimuthDeg}°</span>, τ_ρ = <span className="num text-ink">{t.rangeFrac * 100}%</span> and τ_y = <span className="num text-ink">{t.heightFrac * 100}%</span> of the pair’s mean range,
              f_vis = <span className="num text-ink">{t.visibleMin}</span>, f_occ = <span className="num text-ink">{t.occludedMax}</span>. Anything inside a tolerance is ambiguous and never scored. Pair questions need both objects at
              least <span className="num text-ink">{t.pairMinVisible * 100}%</span> visible and <span className="num text-ink">{t.inFrameMin * 100}%</span> in frame, otherwise they are unaskable from the image.
              Each object’s reference point is the centre of its world bounding box.
            </p>
          </section>

          <section>
            <h3>Ground truth is not a prediction</h3>
            <p>
              The geometry oracle is arithmetic on known transforms plus ray casts against the same primitives that are drawn. It is the definition of
              the right answer, so it scores 100% by construction and says nothing about intelligence. The world-axis and image-plane baselines are
              hand-written shortcuts, not learned models. A question being generated and scored tells you the task is well posed; it does not tell
              you any model can solve it.
            </p>
          </section>

          <section>
            <h3>Research questions this is built to ask</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>How quickly does a fixed-frame shortcut degrade as the camera leaves the canonical view, per relation?</li>
              <li>Which relations can be read off the image plane, and which need depth or a line-of-sight model?</li>
              <li>Does a bounding-box overlap guess track true occlusion, and where does it over- or under-call?</li>
              <li>With a model attached: does its error profile over viewpoint shift look like either shortcut?</li>
            </ul>
          </section>

          <section>
            <h3>Assumptions and limits</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>All geometry is opaque. There is no transparency, reflection or soft visibility.</li>
              <li>Visibility is estimated on a 20×20 ray grid per object, so fractions are quantised to a fraction of a percent at best.</li>
              <li>Above/below is gravity-aligned. With an upright viewer it does not depend on azimuth; it is a deliberate control relation.</li>
              <li>Scenes are synthetic primitives. Results do not transfer to photographs without evidence.</li>
              <li>Room walls are one-sided and never occlude, in both the picture and the oracle.</li>
              <li>Object-centred frames (“from the chair’s point of view”) are out of scope for v0.1.</li>
            </ul>
          </section>

          <section>
            <h3>Keyboard</h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              <li><Kbd>←</Kbd> <Kbd>→</Kbd> orbit the viewer (Shift for 30°)</li>
              <li><Kbd>↑</Kbd> <Kbd>↓</Kbd> eye height</li>
              <li><Kbd>[</Kbd> <Kbd>]</Kbd> distance</li>
              <li><Kbd>V</Kbd> world view / viewer’s eyes</li>
              <li><Kbd>N</Kbd> new seed</li>
              <li><Kbd>L</Kbd> <Kbd>Q</Kbd> <Kbd>B</Kbd> <Kbd>M</Kbd> switch workspace</li>
              <li><Kbd>1</Kbd> <Kbd>2</Kbd> answer, <Kbd>Enter</Kbd> next</li>
              <li><Kbd>?</Kbd> this panel</li>
            </ul>
          </section>

          <section>
            <h3>References</h3>
            <ul className="space-y-3">
              {REFS.map((r) => (
                <li key={r.href}>
                  <a className="font-semibold text-ink underline decoration-night-500 underline-offset-2 hover:decoration-viewer" href={r.href} target="_blank" rel="noreferrer">{r.title}</a>
                  <span className="block text-[12.5px] text-dim">{r.who}</span>
                  <span className="block text-[12.5px]">{r.note}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap gap-2 pb-6">
            <button className="btn btn-primary" onClick={() => { setOpen(false); setHeroSeen(true); setDemoStep(0); }}>Start the guided tour</button>
            <button className="btn" onClick={() => { setOpen(false); setWorkspace('lab'); setHeroSeen(false); }}>Replay the intro</button>
          </div>
        </div>
      </div>
    </div>
  );
}
