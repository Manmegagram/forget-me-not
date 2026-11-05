import type { RenderedCard } from '../cards/render';
import { compareTyped } from '../cards/render';
import type { OcclusionMask } from '../cards/noteTypes';

export function Occlusion({ image, masks, active, reveal }: { image: string; masks: OcclusionMask[]; active: number; reveal: boolean }) {
  return (
    <div className="occlusion">
      <img src={image} alt="" />
      {masks.map((m, i) => {
        const isActive = i === active;
        const cls = isActive ? (reveal ? 'mask revealed' : 'mask active') : 'mask';
        return (
          <div
            key={i}
            className={cls}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
            aria-label={isActive && reveal ? m.label : undefined}
          />
        );
      })}
    </div>
  );
}

export function FaceContent({ rendered, side, typed }: { rendered: RenderedCard; side: 'front' | 'back'; typed?: string }) {
  const html = side === 'front' ? rendered.question : rendered.answer;
  return (
    <div className="card-content">
      {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
      {rendered.occlusion && (
        <Occlusion
          image={rendered.occlusion.image}
          masks={rendered.occlusion.masks}
          active={rendered.occlusion.active}
          reveal={side === 'back'}
        />
      )}
      {side === 'back' && rendered.occlusion?.masks[rendered.occlusion.active]?.label && (
        <p className="title-3" style={{ marginTop: 12 }}>{rendered.occlusion.masks[rendered.occlusion.active].label}</p>
      )}
      {side === 'back' && rendered.typeAnswer !== undefined && (
        <div className="typed-compare" aria-live="polite">
          {compareTyped(typed ?? '', rendered.typeAnswer).map((seg, i) => (
            <span key={i} className={seg.kind}>{seg.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
