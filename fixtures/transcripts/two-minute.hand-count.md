# Hand count for two-minute.json

Invented session, 131 seconds from first to last turn. Four candidate answers. All numbers below were counted by reading the transcript, not by running code. A word is anything between spaces, so "Um," is one word and "you know" is two.

## Words per answer

| Turn | Question | Words |
|---|---|---|
| 2 | q-migration | 60 |
| 4 | q-migration (follow-up) | 43 |
| 6 | q-strength | 54 |
| 8 | q-growth | 37 |
| Total | | 194 |

Counted in runs, sentence by sentence. Turn 2 sentences: 12, 12, 15, 11, 10 = 60. Turn 4: 9, 15, 10, 9 = 43. Turn 6: 9, 9, 12, 24 = 54. Turn 8: 8, 15, 14 = 37.

## Candidate speaking time

endMs minus startMs per candidate turn:

- Turn 2: 40000 - 14000 = 26000 ms
- Turn 4: 66500 - 49500 = 17000 ms
- Turn 6: 98500 - 74500 = 24000 ms
- Turn 8: 125000 - 109000 = 16000 ms

Sum: 83000 ms = 83 seconds = 1.3833 minutes.

## wordsPerMinute

194 words / 1.3833 minutes = 194 x 60 / 83 = 11640 / 83 = 140.24. Rounded: **140**.

## fillerCount

Default list: um, uh, er, like (only when set off by commas or repeated), you know, sort of, kind of, basically, actually, I mean.

| Turn | Fillers found | Count |
|---|---|---|
| 2 | "Um," / "Basically" / "uh," | 3 |
| 4 | "you know," / "like," (between commas) / "Actually," | 3 |
| 6 | "Er," / "I mean," / "sort of" / "Um," | 4 |
| 8 | "kind of" / "Basically," | 2 |

Total: 3 + 3 + 4 + 2 = **12**.

Not counted on purpose: "I like to write things down" in turn 6, because "like" there is a verb and is not set off by commas.

## medianAnswerSec

Durations in seconds: 26, 17, 24, 16. Sorted: 16, 17, 24, 26. Four values, so the median is the mean of the middle two: (17 + 24) / 2 = **20.5**.

## longestPauseMs

Gap from the end of an interviewer turn to the start of the next candidate turn. Interviewer turns that are followed by another interviewer turn (turn 0 into turn 1) are not pauses.

- Turn 1 ends 12000, turn 2 starts 14000: 2000 ms
- Turn 3 ends 46000, turn 4 starts 49500: 3500 ms
- Turn 5 ends 74000, turn 6 starts 74500: 500 ms
- Turn 7 ends 107000, turn 8 starts 109000: 2000 ms

Longest: **3500 ms**.

## interruptedCount

Only turn 5 has interrupted true. Count: **1**.

## Expected result

```
wordsPerMinute 140
fillerCount 12
medianAnswerSec 20.5
longestPauseMs 3500
interruptedCount 1
```

## Definitions

- wordsPerMinute: candidate words divided by candidate speaking minutes, rounded to the nearest integer.
- fillerCount: matches over candidate turns only. "like" counts only when its token ends with a comma and the token before it ends with a comma or it starts the turn, or when it is immediately repeated ("like like").
- medianAnswerSec: median candidate turn duration in seconds, rounded to one decimal.
- longestPauseMs: longest gap between the end of an interviewer turn and the start of the next candidate turn.
- interruptedCount: interviewer turns with interrupted true.
