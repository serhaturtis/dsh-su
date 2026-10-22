# Pivot spike

Proves — or refutes — the riskiest claim in the rig-studio design: **art generated as separate parts, with pivots placed per the authoring contract, animates through extreme poses with zero joint holes, and a broken pivot is found by tooling rather than by eye.**

This is an experiment, not a demo. The gates are written here *before* the run so the verdict cannot be retro-fitted.

## The claim

| # | Claim | Gate |
| --- | --- | --- |
| 1 | Pivots can be placed correctly without freehand guessing | coverage lint reports **0 holes** at clip extremes after one correction pass |
| 2 | The parts do not drift (scale, palette, silhouette) | human review of **60 sampled frames** finds no gaps, seams or stretch |
| 3 | The loop is affordable | pivot placement **≤ 2 minutes per joint**, measured from generated art |

## The fixture

Minimal on purpose — failing cheap beats failing expensive:

```
rig.json            two legs + hips + torso, 4–6 parts
parts/              real generated art (reference-conditioned, one part per image)
clips/squat.json    a squat reaching the rotation limits
measure.mjs         coverage sampling at clip extremes → holes per joint, timings
```

No arms, no face, no skirt. If pivots can't be proven on a hip and a knee, the full character is a waste of art.

## The two methods under test

- **A — markers.** The generator draws a reserved-colour cross at each joint centre. The importer detects it, extracts the pivot, deletes the marker, and checks **consistency**: the child's joint pivot must coincide with the parent's joint point. Pass/fail is arithmetic.
- **C — manual.** Pivots placed in the editor with limit-angle ghosting; correctness known only through coverage sampling.

Both are measured on the same rig and the same clips. The winner becomes the documented default; the loser is rejected by name, with numbers.

## Procedure

1. Generate parts (marker prompt) and manual-place pivots (editor).
2. Run `measure.mjs`: coverage holes per joint per method, pivot-placement times.
3. Render 60 frames per method; review against the rubric below.
4. Write the verdict in [`report.md`](report.md): numbers, findings, the chosen method, and what changed in the contract as a result.

## Rubric (fixed in advance)

A frame is a **fail** if any of:

- a joint shows background through the limb (a hole),
- two parts visibly shear apart (a seam band of different colour),
- a part scales or stretches relative to neighbouring frames,
- the silhouette changes shape in a way the clip does not intend.

A frame that looks *ugly* but none of the above is a pass — taste is not part of this experiment.

## Verdict rules

| Result | Conclusion |
| --- | --- |
| All gates pass | The workflow is proven; the winning method becomes the documented default |
| Gate 1 or 2 fails | The workflow is the bug, not the art: authoring rules change (markers become mandatory, or pivot ghosting improves) and the spike re-runs |
| Gate 3 fails | Manual placement is uneconomic; markers become mandatory |

## Permanent value

On a pass, the fixture and `measure.mjs` fold into the M3 CI tests: coverage sampling and pivot-consistency checks run on every commit from then on. The proof keeps proving.
