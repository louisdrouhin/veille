import { SubmitButton } from "@/components/ui/submit-button";
import { addNote } from "@/lib/actions/topics";
import { NOTE_MAX_LENGTH } from "@/lib/validation";

export function AddNoteForm({ topicId }: { topicId: number }) {
  return (
    <section id="note-form" aria-labelledby="note-form-title" className="scroll-mt-4 overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <h2
        id="note-form-title"
        className="flex h-8 items-center bg-bar-2 px-3.5 font-cond text-xs font-semibold tracking-caps text-bar-fg uppercase"
      >
        Ajouter une note
      </h2>
      <form action={addNote} className="flex flex-col gap-2 p-3.5 md:p-4">
        <input type="hidden" name="topicId" value={topicId} />
        <label htmlFor="note-content" className="text-sm font-semibold">
          Ta note
        </label>
        <textarea
          id="note-content"
          name="content"
          required
          maxLength={NOTE_MAX_LENGTH}
          rows={5}
          className="min-h-30 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-[16px] font-normal text-fg md:text-base"
          placeholder="Ce que tu en retiens, ce qu'il faut vérifier…"
        />
        <div className="flex justify-end">
          <SubmitButton variant="primary" size="md" className="max-md:w-full" pendingLabel="Envoi…">
            Poster
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
