"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toIsbn13 } from "@/lib/isbn";
import { cn } from "@/lib/utils";

/** Typed ISBN (10 or 13 digits, hyphens allowed). The fallback for a camera that will not open, and the desktop path. */
export function ManualIsbn({
  onAdd,
  autoFocus,
  className,
}: {
  /** Returns false when the book is already in the tray. */
  onAdd: (isbn: string) => boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const isbn = toIsbn13(value);
    if (!isbn) {
      setMessage({ kind: "error", text: "That doesn't look like a valid ISBN. Check the digits on the back cover." });
      return;
    }
    const added = onAdd(isbn);
    setMessage(added ? null : { kind: "info", text: "That book is already in your tray." });
    if (added) setValue("");
  }

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-2", className)} noValidate>
      <Label htmlFor={id}>Or type the ISBN</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          name="isbn"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          enterKeyHint="done"
          placeholder="978 0 441 17271 9"
          maxLength={20}
          aria-invalid={message?.kind === "error" || undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={value.trim() === ""}>
          <Plus aria-hidden /> Add to tray
        </Button>
      </div>
      {message && (
        <p id={`${id}-msg`} role={message.kind === "error" ? "alert" : "status"} className={cn("text-sm", message.kind === "error" ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
        </p>
      )}
    </form>
  );
}
