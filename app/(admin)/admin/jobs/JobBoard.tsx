"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { initials } from "@/components/ui";
import { dueState } from "@/lib/job-board-helpers";
import { moveJob } from "./actions";
import type { JobCard, JobStatus } from "@/lib/views/jobs";

// Redefined locally: lib/views/jobs is server-coupled, so a client component may
// only import types from it.
const COLUMNS: { status: JobStatus; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "#94A3B8" },
  { status: "in_progress", label: "In progress", dot: "#185FA5" },
  { status: "waiting", label: "Waiting", dot: "#B45309" },
  { status: "done", label: "Done", dot: "#15803D" },
];

export function JobBoard({ cards, today }: { cards: JobCard[]; today: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  // Local copy so the board reorders instantly; the server revalidation follows.
  const [items, setItems] = useState(cards);
  // Tracks the last `cards` prop we've synced from, so we can tell a genuinely
  // new server payload (after router.refresh(), another tab's edit, etc.) apart
  // from a re-render caused by our own optimistic update. Reset during render
  // (not an effect) per the standard "derive state from props" pattern — this
  // intentionally does NOT use a `key` on the component, which would remount it
  // and lose scroll/focus.
  const [prevCards, setPrevCards] = useState(cards);
  if (cards !== prevCards) {
    setPrevCards(cards);
    setItems(cards);
  }

  const sensors = useSensors(
    // A small drag threshold so clicking a card still navigates to it.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const columnOf = (id: string) => items.find((c) => c.id === id)?.status;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    // Picking a card up and releasing it without moving onto a different
    // target is the common case, not an edge case. Without this guard,
    // `overStatus` resolves to undefined, `toStatus` falls back to the card's
    // own column, the moved card is excluded from `target`, so
    // `target.findIndex` returns -1 and `index` falls back to `target.length`
    // — silently sending the card to the end of its own column and
    // persisting that via moveJob. Bail out before any state change or
    // server call.
    if (overId === activeId) return;

    const from = columnOf(activeId);
    if (!from) return;

    // Dropped on a column shell (empty column) or on another card.
    const overStatus = COLUMNS.find((c) => c.status === overId)?.status;
    const toStatus = overStatus ?? columnOf(overId);
    if (!toStatus) return;

    const target = items.filter((c) => c.status === toStatus && c.id !== activeId);
    const toIndex = overStatus ? target.length : target.findIndex((c) => c.id === overId);
    const index = toIndex < 0 ? target.length : toIndex;

    // Snapshot for rollback if the server call fails.
    const previousItems = items;

    setItems((prev) => {
      const moved = prev.find((c) => c.id === activeId);
      if (!moved) return prev;
      const rest = prev.filter((c) => c.id !== activeId);
      const before = rest.filter((c) => c.status !== toStatus);
      const col = rest.filter((c) => c.status === toStatus);
      col.splice(index, 0, { ...moved, status: toStatus });
      return [...before, ...col];
    });

    start(async () => {
      try {
        await moveJob(activeId, toStatus, index);
        router.refresh();
      } catch (err) {
        console.error("moveJob failed:", err);
        setItems(previousItems);
      }
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colCards = items.filter((c) => c.status === col.status);
          return (
            <Column key={col.status} status={col.status} label={col.label} dot={col.dot} count={colCards.length}>
              <SortableContext items={colCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {colCards.map((c) => (
                  <SortableCard key={c.id} card={c} today={today} />
                ))}
              </SortableContext>
              {colCards.length === 0 && (
                <div className="px-1 py-6 text-center text-xs text-faint">Nothing here</div>
              )}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  label,
  dot,
  count,
  children,
}: {
  status: JobStatus;
  label: string;
  dot: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-2.5 transition-colors ${isOver ? "border-faint bg-line-soft" : "border-line bg-[#FCFCFD]"}`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="ml-auto text-[11px] text-faint">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SortableCard({ card, today }: { card: JobCard; today: string }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const due = dueState(card.dueDate, today);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
      className={`touch-none ${isDragging ? "opacity-50" : ""}`}
    >
      <Link
        href={`/admin/jobs/${card.id}`}
        className="block rounded-lg border border-line bg-card p-3 transition-colors hover:border-faint"
      >
        <div className="text-[13px] font-semibold leading-snug text-ink">{card.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{card.clientName}</div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {card.ownerLabel && (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-semibold uppercase text-white"
              title={card.ownerLabel}
            >
              {initials(card.ownerLabel)}
            </span>
          )}
          {card.taskTotal > 0 && (
            <span className="text-[11px] text-faint">
              {card.taskDone}/{card.taskTotal} done
            </span>
          )}
          {due === "overdue" && (
            <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">Overdue</span>
          )}
          {due === "due_soon" && (
            <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">Due soon</span>
          )}
          {card.fromQuote && (
            <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">from quote</span>
          )}
          {card.status === "waiting" && card.waitingNote && (
            <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">{card.waitingNote}</span>
          )}
          {/* Dragging into Waiting leaves the note empty — prompt for it here
              rather than blocking the drag with a modal. Opens the job, where
              JobStatusControl already has the input. */}
          {card.status === "waiting" && !card.waitingNote && (
            <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-faint">
              + what&rsquo;s it waiting on?
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
