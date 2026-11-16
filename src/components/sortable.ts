"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Pointer-based drag reordering for rows or grid cells. Mouse, touch and pen all go through pointer events
 * on a handle (touch-action: none on the handle only, so the page still scrolls elsewhere). Keyboard and
 * button alternatives are the caller's job: this only reports where a drag ended.
 */
export function useDragSort({ ids, onMove }: { ids: string[]; onMove: (id: string, toIndex: number) => void }) {
  const els = useRef(new Map<string, HTMLElement>());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const over = useRef<number | null>(null);

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    [],
  );

  /** Index of the item whose box is nearest the pointer (by centre distance, rows weigh the vertical axis). */
  function indexAt(x: number, y: number): number {
    let best = 0;
    let bestD = Infinity;
    ids.forEach((id, i) => {
      const el = els.current.get(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot((x - (r.left + r.width / 2)) * 0.6, y - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function handleProps(id: string) {
    return {
      style: { touchAction: "none" as const },
      onPointerDown(e: React.PointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragId(id);
        over.current = ids.indexOf(id);
        setOverIndex(over.current);
      },
      onPointerMove(e: React.PointerEvent<HTMLElement>) {
        if (dragId !== id) return;
        const i = indexAt(e.clientX, e.clientY);
        if (i !== over.current) {
          over.current = i;
          setOverIndex(i);
        }
        // Keep the item under the finger in view while dragging near an edge.
        const margin = 56;
        if (e.clientY < margin) window.scrollBy({ top: -14 });
        else if (e.clientY > window.innerHeight - margin) window.scrollBy({ top: 14 });
      },
      onPointerUp(e: React.PointerEvent<HTMLElement>) {
        if (dragId !== id) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const to = over.current;
        setDragId(null);
        setOverIndex(null);
        if (to !== null && to !== ids.indexOf(id)) onMove(id, to);
      },
      onPointerCancel() {
        setDragId(null);
        setOverIndex(null);
      },
    };
  }

  return { register, handleProps, dragId, overIndex };
}
