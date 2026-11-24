"use client";

import { useId } from "react";
import { LIST_BG, LIST_COLOR_LABELS, LIST_COLORS, type ListColor } from "@/lib/lists/palette";

/** The 8 colors as radios (44 px targets); the checked one gets a double ring in the text color. */
export function ListColorPicker({ value, onChange, listName }: { value: ListColor; onChange: (c: ListColor) => void; listName: string }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold">
        Couleur<span className="sr-only"> de « {listName} »</span>
      </legend>
      <div className="flex flex-wrap gap-1">
        {LIST_COLORS.map((c) => (
          <label key={c} title={LIST_COLOR_LABELS[c]} className="relative inline-flex size-11 cursor-pointer items-center justify-center md:size-9">
            <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="peer sr-only" />
            <span
              aria-hidden
              className={`size-7 rounded-full md:size-6 ${LIST_BG[c]} peer-checked:ring-2 peer-checked:ring-surface peer-checked:outline-2 peer-checked:outline-offset-2 peer-checked:outline-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus`}
            />
            <span className="sr-only">{LIST_COLOR_LABELS[c]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
