"use client";

import { useEffect, useRef, useState, useCallback, DragEvent as ReactDragEvent } from "react";

export type DragKind = "note" | "bin";

export interface DragPayload {
  kind: DragKind;
  id: string;
  /** Optional context bin id (for notes — the bin currently displayed). */
  contextBinId?: string | null;
}

const MIME = "application/x-dashboard";

/**
 * Tracks whether ⌘/Ctrl is currently held while a drag is active.
 * Returns a function to call before reading state in a drop handler.
 */
export function useIsCommandHeld(): { current: boolean } {
  const ref = useRef(false);
  useEffect(() => {
    function down(e: KeyboardEvent) { if (e.metaKey || e.ctrlKey) ref.current = true; }
    function up(e: KeyboardEvent) { if (!e.metaKey && !e.ctrlKey) ref.current = false; }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => { ref.current = false; });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return ref;
}

/**
 * Returns props to spread onto a draggable element.
 * Generates a faded clone of the source for the drag preview (spec §5.5).
 */
export function useDrag(payload: DragPayload | (() => DragPayload)) {
  return {
    draggable: true,
    onDragStart: (e: ReactDragEvent) => {
      const data = typeof payload === "function" ? payload() : payload;
      e.dataTransfer.setData(MIME, JSON.stringify(data));
      e.dataTransfer.effectAllowed = "copyMove";
      // Drag preview: clone the source element, scale to 80%, opacity 70%
      const src = e.currentTarget as HTMLElement;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.top = "-1000px";
      clone.style.transform = "scale(0.8)";
      clone.style.opacity = "0.7";
      clone.style.pointerEvents = "none";
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, 10, 10);
      // Clean up the clone after the browser captures the image
      setTimeout(() => clone.remove(), 0);
    },
  };
}

interface UseDropOptions {
  /** Decide if a drop with given payload should be accepted. */
  accept(payload: DragPayload): boolean;
  /** Called on drop. */
  onDrop(payload: DragPayload, e: ReactDragEvent): void;
}

// HTML5 drag-and-drop limitation: dataTransfer.getData() returns "" during dragover
// and dragenter in most browsers (data is only readable on the actual drop event).
// Our useDrop accept() runs against the cached payload when available; when not,
// the hover indicator falls back to "valid" and the actual validation happens
// at drop time (server returns 400 if invalid → toast surfaces error).
// This means visual indicators for invalid drops (e.g., dragging a parent onto
// its own child) may show cyan instead of red dashed during hover. Not a blocker
// for v1.2.1 — server-side cycle validation (Task 11) catches it on drop.

/**
 * Returns props + state for a drop target. State indicates whether a valid drag is hovering it.
 */
export function useDrop({ accept, onDrop }: UseDropOptions) {
  const [hover, setHover] = useState<"none" | "valid" | "invalid">("none");

  const onDragOver = useCallback((e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) {
      // Some browsers don't expose data during dragover — be permissive
      e.preventDefault();
      return;
    }
    let payload: DragPayload | null = null;
    try { payload = JSON.parse(raw) as DragPayload; } catch { /* ignore */ }
    if (!payload) return;
    if (accept(payload)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, [accept]);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(MIME);
    let payload: DragPayload | null = null;
    if (raw) { try { payload = JSON.parse(raw) as DragPayload; } catch { /* ignore */ } }
    if (!payload) {
      // Show valid as default during enter (data may be unavailable until drop in some browsers)
      setHover("valid");
      return;
    }
    setHover(accept(payload) ? "valid" : "invalid");
  }, [accept]);

  const onDragLeave = useCallback(() => { setHover("none"); }, []);

  const onDropFn = useCallback((e: ReactDragEvent) => {
    setHover("none");
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) return;
    let payload: DragPayload | null = null;
    try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
    if (!payload || !accept(payload)) return;
    e.preventDefault();
    onDrop(payload, e);
  }, [accept, onDrop]);

  return {
    hover,
    dropProps: { onDragOver, onDragEnter, onDragLeave, onDrop: onDropFn },
  };
}

export function parseDragPayload(e: ReactDragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(MIME);
  if (!raw) return null;
  try { return JSON.parse(raw) as DragPayload; } catch { return null; }
}

/**
 * Tracks whether ANY drag is currently in progress at the document level.
 * Used by the modifier hint pill (spec §5.6) to know when to render.
 */
export function useIsDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    function onStart() { setDragging(true); }
    function onEnd() { setDragging(false); }
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);
  return dragging;
}
