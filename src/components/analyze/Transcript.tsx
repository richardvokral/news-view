"use client";

import StepLog, { type StepEvent } from "./StepLog";

export interface Turn {
  id: string;
  question: string;
  events: StepEvent[];
  answer: string | null;
  error: string | null;
  status: "running" | "done" | "error";
}

interface Props {
  turns: Turn[];
}

export default function Transcript({ turns }: Props) {
  if (turns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        Ask a question below to start a conversation. The conversation lives in
        this browser tab only — refreshing clears it.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {turns.map((turn, idx) => {
        const isLast = idx === turns.length - 1;
        return (
          <article
            key={turn.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                You
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                {turn.question}
              </div>
            </div>

            <StepLog events={turn.events} defaultOpen={isLast && turn.status !== "done"} />

            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Assistant
              </div>
              {turn.answer ? (
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">
                  {turn.answer}
                </div>
              ) : turn.error ? (
                <div className="mt-1 whitespace-pre-wrap text-sm text-red-700">
                  {turn.error}
                </div>
              ) : (
                <div className="mt-1 text-sm italic text-gray-500">
                  {turn.status === "running" ? "Thinking…" : "(no answer)"}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
