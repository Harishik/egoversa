import { VIEWER_ASPECT, VIEWER_FOV_DEG, viewerPosition, type ViewerPose } from '../../geometry/camera';
import type { Scene } from '../../scenes/types';

export const A_COLOR = '#7C87FF';
export const B_COLOR = '#FF9EB1';

/**
 * Plan view (looking straight down, world +X to the right, world +Z toward the
 * bottom of the picture) with the viewer camera and its horizontal field of view.
 */
export function TopDownMap({ scene, viewer, a, b, size = 220, showLabels = false }: { scene: Scene; viewer: ViewerPose; a?: string; b?: string; size?: number; showLabels?: boolean }) {
  const R = Math.max(scene.extent * 1.15, viewer.distance * 1.08);
  const cx = scene.focus[0];
  const cz = scene.focus[2];
  const S = 100 / R; // world metres -> svg units (viewBox is [-100, 100])
  const X = (x: number) => (x - cx) * S;
  const Y = (z: number) => (z - cz) * S;
  const cam = viewerPosition(viewer, scene.focus);
  const hfov = Math.atan(Math.tan((VIEWER_FOV_DEG * Math.PI) / 360) * VIEWER_ASPECT);
  const heading = Math.atan2(cx - cam[0], cz - cam[2]); // angle of the view direction in the XZ plane
  const reach = R * 2.2 * S;
  const ray = (ang: number) => `${X(cam[0]) + Math.sin(ang) * reach},${Y(cam[2]) + Math.cos(ang) * reach}`;
  const objA = scene.objects.find((o) => o.id === a);
  const objB = scene.objects.find((o) => o.id === b);
  const desc = `Plan view of the scene. Camera at azimuth ${Math.round(viewer.azimuthDeg)} degrees` + (objA ? `; highlighted: ${objA.name}${objB ? ` and ${objB.name}` : ''}.` : '.');
  return (
    <svg viewBox="-100 -100 200 200" width={size} height={size} role="img" aria-label={desc} className="block rounded-xl bg-night-900">
      <defs>
        <clipPath id="tdm-clip"><rect x="-100" y="-100" width="200" height="200" rx="10" /></clipPath>
      </defs>
      <g clipPath="url(#tdm-clip)">
        <circle r={scene.extent * S} fill="#0E1330" stroke="#1C2450" />
        <polygon points={`${X(cam[0])},${Y(cam[2])} ${ray(heading - hfov)} ${ray(heading + hfov)}`} fill="#5CE1E6" opacity="0.09" />
        {scene.fixtures.filter((f) => f.id !== 'floor').map((f) => {
          const p = f.parts[0];
          return <rect key={f.id} x={X(p.position[0]) - (p.scale[0] * S) / 2} y={Y(p.position[2]) - (p.scale[2] * S) / 2} width={p.scale[0] * S} height={p.scale[2] * S} rx="2" fill="none" stroke="#3A4585" strokeWidth="1" />;
        })}
        {scene.objects.map((o) => {
          const hi = o.id === a ? A_COLOR : o.id === b ? B_COLOR : null;
          const w = Math.max(3, o.size[0] * S);
          const h = Math.max(3, o.size[2] * S);
          return (
            <rect key={o.id} x={X(o.center[0]) - w / 2} y={Y(o.center[2]) - h / 2} width={w} height={h} rx={Math.min(w, h) * 0.25}
              fill={hi ?? '#3A4585'} stroke={hi ? '#0A0E22' : 'none'} strokeWidth={1} opacity={hi ? 1 : 0.75} />
          );
        })}
        {showLabels && [objA, objB].map((o, i) => o && (
          <text key={o.id} x={X(o.center[0])} y={Y(o.center[2]) - Math.max(4, (o.size[2] * S) / 2) - 3} textAnchor="middle" fontSize="8" fontWeight="700" fill={i === 0 ? A_COLOR : B_COLOR}>{o.name}</text>
        ))}
        {/* camera */}
        <g transform={`translate(${X(cam[0])} ${Y(cam[2])}) rotate(${(-heading * 180) / Math.PI})`}>
          <polygon points="0,7 -5,-4 5,-4" fill="#5CE1E6" stroke="#0A0E22" strokeWidth="1" />
        </g>
        {/* world axes */}
        <g transform="translate(-88 -88)" stroke="#F0B866" strokeWidth="1.5" fill="#F0B866">
          <line x1="0" y1="0" x2="18" y2="0" /><polygon points="18,-2.5 23,0 18,2.5" stroke="none" />
          <line x1="0" y1="0" x2="0" y2="18" /><polygon points="-2.5,18 0,23 2.5,18" stroke="none" />
          <text x="26" y="3" fontSize="8" stroke="none" fontFamily="JetBrains Mono Variable, monospace">X_w</text>
          <text x="-3" y="32" fontSize="8" stroke="none" fontFamily="JetBrains Mono Variable, monospace">Z_w</text>
        </g>
      </g>
    </svg>
  );
}
