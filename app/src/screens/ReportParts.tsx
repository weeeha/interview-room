import { useState } from "react";
import type { Turn } from "../../../shared/types.ts";
import { isLong } from "./reportView.ts";

/** One audio element for the whole screen. */
export type Player = {
  playing: number | undefined;
  broken: ReadonlySet<number>;
  toggle: (turnIndex: number, url: string) => void;
};

export function PlayButton({ turn, url, player }: { turn: Turn | undefined; url: string | undefined; player: Player }) {
  const index = turn?.index;
  const reason = index === undefined ? "This turn is not in the session log." : !url ? "No audio was saved for this turn." : player.broken.has(index) ? "The audio file was not found." : undefined;
  const playing = index !== undefined && player.playing === index;
  const reasonId = index === undefined ? undefined : `why-no-audio-${index}`;
  return (
    <>
      <button
        type="button"
        className="btn btn-small play"
        aria-pressed={playing}
        disabled={reason !== undefined}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => index !== undefined && url && player.toggle(index, url)}
      >
        {playing ? `Stop turn ${index}` : `Play turn ${index ?? "?"}`}
        <span className="visually-hidden">{playing ? " audio, playing" : " audio"}</span>
      </button>
      {reason ? (
        <span id={reasonId} className="play-reason">
          {reason}
        </span>
      ) : null}
    </>
  );
}

/** A quote that collapses to three lines when long. */
export function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = isLong(text);
  return (
    <div className="quote-wrap">
      <blockquote className={`quote${long && !open ? " clamped" : ""}`}>
        <p>{text}</p>
      </blockquote>
      {long ? <ShowMore open={open} onToggle={() => setOpen(!open)} /> : null}
    </div>
  );
}

export function ShowMore({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="link-button" aria-expanded={open} onClick={onToggle}>
      {open ? "Show less" : "Show more"}
    </button>
  );
}
