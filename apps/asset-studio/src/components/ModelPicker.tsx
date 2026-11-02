import { useEffect, useState } from "react";
import { api, type InferModel } from "../api.ts";

export type Choice = { model: string; reasoningEffort: string };

const STORAGE_KEY = "asset-studio-infer-choice";

function readSaved(): Choice | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Choice | null;
  } catch {
    return null;
  }
}

// The Infer model and reasoning effort, kept for the next visit.
export function useInferChoice() {
  const [models, setModels] = useState<InferModel[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.models().then(
      (list) => {
        setModels(list);
        const saved = readSaved();
        const model = list.find((item) => item.id === saved?.model) ?? list[0]!;
        const reasoningEffort = model.reasoningEfforts.includes(saved?.reasoningEffort ?? "")
          ? saved!.reasoningEffort
          : (model.reasoningEfforts[0] ?? "");
        setChoice({ model: model.id, reasoningEffort });
      },
      (reason: Error) => setError(reason.message),
    );
  }, []);

  function change(next: Choice) {
    setChoice(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The choice is only a convenience.
    }
  }

  return { models, choice, change, error };
}

export function ModelPicker({ models, choice, change, error }: ReturnType<typeof useInferChoice>) {
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!choice) return <p className="text-sm text-zinc-400">Loading Infer models…</p>;
  const efforts = models.find((item) => item.id === choice.model)?.reasoningEfforts ?? [];
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <label className="space-y-1">
        <span className="text-zinc-400">Infer model</span>
        <select
          className="field"
          value={choice.model}
          onChange={(event) => {
            const model = models.find((item) => item.id === event.target.value)!;
            const reasoningEffort = model.reasoningEfforts.includes(choice.reasoningEffort)
              ? choice.reasoningEffort
              : (model.reasoningEfforts[0] ?? "");
            change({ model: model.id, reasoningEffort });
          }}
        >
          {models.map((model) => (
            <option key={model.id}>{model.id}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-zinc-400">Reasoning</span>
        <select className="field" value={choice.reasoningEffort} onChange={(event) => change({ ...choice, reasoningEffort: event.target.value })}>
          {efforts.map((effort) => (
            <option key={effort}>{effort}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
