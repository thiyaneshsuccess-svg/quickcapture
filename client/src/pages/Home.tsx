import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Check, LoaderCircle, Trash2, X } from "lucide-react";
import type { Task } from "../../../drizzle/schema";
import { trpc } from "@/lib/trpc";

const MAX_TASK_LENGTH = 500;
type Filter = "all" | "pending" | "done";

type MutationContext = {
  previous?: Task[];
};

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Something went wrong. Please try again.";
}

function formatTaskAge(value: Date | string) {
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return "just now";
  }
}

function TaskSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading captures" role="status">
      {["w-11/12", "w-8/12", "w-10/12"].map(width => (
        <div key={width} className="h-[72px] animate-pulse rounded-[18px] border border-stone-200/80 bg-white/70 p-5">
          <div className={`h-3 ${width} rounded-full bg-stone-200`} />
          <div className="mt-3 h-2 w-20 rounded-full bg-stone-100" />
        </div>
      ))}
      <span className="sr-only">Loading your captures…</span>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy = {
    all: { title: "Nothing captured yet.", body: "Type something above and press Enter." },
    pending: { title: "Nothing pending.", body: "You’re all caught up for now." },
    done: { title: "Nothing completed yet.", body: "Completed captures will settle here." },
  }[filter];

  return (
    <div className="rounded-[18px] border border-dashed border-stone-300 bg-white/45 px-6 py-12 text-center">
      <p className="font-brand text-[17px] font-semibold tracking-[-0.02em] text-stone-800">{copy.title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-500">{copy.body}</p>
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelDialogRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const utils = trpc.useUtils();
  const tasksQuery = trpc.tasks.list.useQuery(undefined, {
    staleTime: 10_000,
    retry: 1,
  });
  const tasks = tasksQuery.data ?? [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelDialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen]);

  const createMutation = trpc.tasks.create.useMutation({
    onMutate: async ({ text }): Promise<MutationContext> => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      const optimistic: Task = {
        id: -Date.now(),
        text,
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      utils.tasks.list.setData(undefined, old => [optimistic, ...(old ?? [])]);
      setDraft("");
      setMessage(null);
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) utils.tasks.list.setData(undefined, context.previous);
      setDraft(variables.text);
      setMessage(getErrorMessage(error));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    onSuccess: () => {
      setMessage(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    onSettled: () => {
      void utils.tasks.list.invalidate();
    },
  });

  const toggleMutation = trpc.tasks.setCompleted.useMutation({
    onMutate: async ({ id, completed }): Promise<MutationContext> => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, old =>
        old?.map(task => (task.id === id ? { ...task, completed, updatedAt: new Date() } : task)),
      );
      setMessage(null);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.tasks.list.setData(undefined, context.previous);
      setMessage(getErrorMessage(error));
    },
    onSettled: () => {
      void utils.tasks.list.invalidate();
    },
  });

  const clearCompletedMutation = trpc.tasks.clearCompleted.useMutation({
    onMutate: async (): Promise<MutationContext> => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, old => old?.filter(task => !task.completed));
      setMessage(null);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.tasks.list.setData(undefined, context.previous);
      setMessage(getErrorMessage(error));
    },
    onSettled: () => {
      void utils.tasks.list.invalidate();
    },
  });

  const clearAllMutation = trpc.tasks.clearAll.useMutation({
    onMutate: async (): Promise<MutationContext> => {
      await utils.tasks.list.cancel();
      const previous = utils.tasks.list.getData();
      utils.tasks.list.setData(undefined, () => []);
      setMessage(null);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.tasks.list.setData(undefined, context.previous);
      setMessage(getErrorMessage(error));
    },
    onSuccess: () => setConfirmOpen(false),
    onSettled: () => {
      void utils.tasks.list.invalidate();
    },
  });

  const pendingCount = useMemo(() => tasks.filter(task => !task.completed).length, [tasks]);
  const completedCount = tasks.length - pendingCount;
  const visibleTasks = useMemo(() => {
    if (filter === "pending") return tasks.filter(task => !task.completed);
    if (filter === "done") return tasks.filter(task => task.completed);
    return tasks;
  }, [filter, tasks]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setMessage("Type something before pressing Enter.");
      inputRef.current?.focus();
      return;
    }
    if (text.length > MAX_TASK_LENGTH) {
      setMessage(`Keep captures under ${MAX_TASK_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }
    if (!createMutation.isPending) createMutation.mutate({ text });
  };

  const filters: Array<{ id: Filter; label: string; count?: number }> = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending", count: pendingCount },
    { id: "done", label: "Done", count: completedCount },
  ];

  return (
    <main className="min-h-screen bg-[#f5f4ef] px-4 py-5 text-[#1e211d] sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-[680px] flex-col sm:min-h-[calc(100vh-5rem)]">
        <header className="mb-8 px-1 sm:mb-10">
          <p className="font-brand text-[13px] font-bold uppercase tracking-[0.22em] text-[#315b49]">QuickCapture</p>
          <div className="mt-2 flex items-end justify-between gap-4">
            <h1 className="font-brand text-[30px] font-semibold leading-none tracking-[-0.055em] text-[#171916] sm:text-[38px]">
              Capture it. <span className="text-[#838981]">Do it later.</span>
            </h1>
            <span className="hidden pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a9d96] sm:block">One thought at a time</span>
          </div>
        </header>

        <section aria-labelledby="capture-heading" className="flex-1">
          <h2 id="capture-heading" className="sr-only">Capture a new task</h2>
          <form onSubmit={handleSubmit} className="relative">
            <label htmlFor="capture-input" className="sr-only">What do you want to remember?</label>
            <input
              ref={inputRef}
              id="capture-input"
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                if (message) setMessage(null);
              }}
              placeholder="What do you want to remember?"
              maxLength={MAX_TASK_LENGTH + 1}
              autoComplete="off"
              spellCheck="true"
              className="h-[68px] w-full rounded-[19px] border border-[#d9dad2] bg-white px-5 pr-14 font-brand text-[17px] font-medium tracking-[-0.02em] text-[#1e211d] shadow-[0_10px_30px_rgba(35,43,36,0.05)] outline-none transition-[border,box-shadow] placeholder:text-[#a7aaa3] focus:border-[#315b49] focus:shadow-[0_0_0_4px_rgba(49,91,73,0.10),0_12px_34px_rgba(35,43,36,0.07)] sm:h-[76px] sm:px-6 sm:text-[19px]"
            />
            <div aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2 text-[#afb2ab]">
              {createMutation.isPending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <kbd className="hidden rounded-md border border-[#e2e3dc] bg-[#f7f7f3] px-2 py-1 font-sans text-[10px] font-bold tracking-[0.08em] sm:block">ENTER</kbd>}
            </div>
          </form>

          <div className="mt-6 flex items-center justify-between gap-4 border-b border-[#dedfd8] pb-3">
            <div className="flex items-center gap-1" role="tablist" aria-label="Filter captures">
              {filters.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`min-h-[40px] rounded-full px-3.5 text-[13px] font-bold tracking-[-0.01em] transition-[background,color,transform] duration-150 active:scale-[0.97] sm:px-4 ${filter === item.id ? "bg-[#315b49] text-white shadow-[0_4px_12px_rgba(49,91,73,0.18)]" : "text-[#747970] hover:bg-[#e9ebe3] hover:text-[#315b49]"}`}
                >
                  {item.label}
                  {item.count !== undefined && <span className={`ml-1.5 text-[11px] ${filter === item.id ? "text-white/65" : "text-[#a4a8a0]"}`}>{item.count}</span>}
                </button>
              ))}
            </div>
            <p className="shrink-0 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-[#9a9d96] sm:text-xs">
              <span className="text-[#315b49]">{pendingCount}</span> pending <span className="mx-1 text-[#c5c7c0]">·</span> {tasks.length} total
            </p>
          </div>

          {message && (
            <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#e9c9bd] bg-[#fff8f5] px-3.5 py-3 text-sm leading-5 text-[#9b4f3b]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
              <button type="button" onClick={() => setMessage(null)} className="ml-auto rounded-md p-0.5 text-[#b77767] transition hover:bg-[#f5e5df]" aria-label="Dismiss message"><X className="h-4 w-4" /></button>
            </div>
          )}

          <div className="mt-4" aria-live="polite">
            {tasksQuery.isLoading ? <TaskSkeleton /> : tasksQuery.isError ? (
              <div role="alert" className="rounded-[18px] border border-[#e9c9bd] bg-[#fff8f5] px-6 py-10 text-center">
                <AlertCircle className="mx-auto h-5 w-5 text-[#9b4f3b]" />
                <p className="mt-3 font-brand text-[16px] font-semibold text-[#6f3426]">Couldn’t load your captures.</p>
                <p className="mt-1 text-sm text-[#9b4f3b]">{getErrorMessage(tasksQuery.error)}</p>
                <button type="button" onClick={() => void tasksQuery.refetch()} className="mt-5 min-h-[44px] rounded-full bg-[#315b49] px-5 text-sm font-bold text-white transition hover:bg-[#244a3a] active:scale-[0.97]">Try again</button>
              </div>
            ) : visibleTasks.length === 0 ? <EmptyState filter={filter} /> : (
              <ul className="space-y-2" aria-label={`${filter} captures`}>
                {visibleTasks.map(task => (
                  <li key={task.id} className={`group rounded-[18px] border bg-white/80 transition-[background,border,transform,box-shadow] duration-200 hover:border-[#c9d5cb] hover:bg-white hover:shadow-[0_8px_22px_rgba(35,43,36,0.045)] ${task.completed ? "border-[#e3e5df]" : "border-[#e1e2dc]"}`}>
                    <label className="flex min-h-[72px] cursor-pointer items-center gap-4 px-4 py-3.5 sm:px-5">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={event => toggleMutation.mutate({ id: task.id, completed: event.target.checked })}
                        className="peer sr-only"
                        aria-label={`${task.completed ? "Reopen" : "Complete"} capture: ${task.text}`}
                      />
                      <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-[background,border,transform] duration-200 peer-focus-visible:ring-4 peer-focus-visible:ring-[#315b49]/15 ${task.completed ? "border-[#315b49] bg-[#315b49] text-white" : "border-[#b7bbb2] bg-transparent text-transparent group-hover:border-[#315b49]"}`}>
                        <Check className="h-3.5 w-3.5 stroke-[3]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block break-words font-brand text-[16px] font-medium leading-6 tracking-[-0.015em] transition-[color,text-decoration] duration-200 ${task.completed ? "text-[#a3a79f] line-through decoration-[#a3a79f]/70" : "text-[#272a25]"}`}>{task.text}</span>
                        <time dateTime={new Date(task.createdAt).toISOString()} className={`mt-1 block text-[11px] font-medium ${task.completed ? "text-[#c0c3bb]" : "text-[#a3a69e]"}`}>{formatTaskAge(task.createdAt)}</time>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#dedfd8] pt-5 sm:mt-12">
          <p className="text-xs font-medium text-[#a1a49d]">Keep the list light. Keep moving.</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={completedCount === 0 || clearCompletedMutation.isPending}
              onClick={() => clearCompletedMutation.mutate()}
              className="min-h-[44px] rounded-full px-3 text-xs font-bold text-[#747970] transition-[background,color,transform] hover:bg-[#e9ebe3] hover:text-[#315b49] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 sm:px-4"
            >
              {clearCompletedMutation.isPending ? "Clearing…" : "Clear completed"}
            </button>
            <button
              type="button"
              disabled={tasks.length === 0 || clearAllMutation.isPending}
              onClick={() => setConfirmOpen(true)}
              className="min-h-[44px] rounded-full px-3 text-xs font-bold text-[#9b4f3b] transition-[background,color,transform] hover:bg-[#f5e5df] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 sm:px-4"
            >
              Clear all
            </button>
          </div>
        </footer>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1e211d]/35 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="clear-all-title" aria-describedby="clear-all-description" className="w-full max-w-[420px] rounded-[24px] border border-[#dedfd8] bg-[#fbfbf8] p-6 shadow-[0_24px_70px_rgba(30,33,29,0.2)] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9b4f3b]">Destructive action</p>
                <h2 id="clear-all-title" className="mt-2 font-brand text-[22px] font-semibold tracking-[-0.04em] text-[#1e211d]">Clear everything?</h2>
              </div>
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-full p-2 text-[#9a9d96] transition hover:bg-[#eceee8] hover:text-[#1e211d]" aria-label="Close confirmation"><X className="h-5 w-5" /></button>
            </div>
            <p id="clear-all-description" className="mt-3 text-sm leading-6 text-[#747970]">This will permanently remove all captured tasks. There’s no way to undo this.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelDialogRef} type="button" onClick={() => setConfirmOpen(false)} className="min-h-[46px] rounded-full border border-[#d9dad2] px-5 text-sm font-bold text-[#5d625b] transition hover:bg-[#f0f1ec] active:scale-[0.97]">Cancel</button>
              <button type="button" disabled={clearAllMutation.isPending} onClick={() => clearAllMutation.mutate()} className="min-h-[46px] rounded-full bg-[#9b4f3b] px-5 text-sm font-bold text-white transition hover:bg-[#813e2d] active:scale-[0.97] disabled:opacity-60">{clearAllMutation.isPending ? "Clearing…" : "Clear all"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
