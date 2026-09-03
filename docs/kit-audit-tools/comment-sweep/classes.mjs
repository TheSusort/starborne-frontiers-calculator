/**
 * classes.mjs — the ONE definition of the sweep's candidate classes.
 *
 * census.mjs and blocks.mjs both import this. They used to carry separate copies, and the copies
 * drifted: `SP-\d` matched only a DIGIT after `SP-`, so the entire letter-suffixed vocabulary
 * (`SP-U`, `SP-M`, `SP-F`, `Sub-project I`, `H1 T4`, `W3`) was invisible to both tools. The gap
 * was found by an agent reading code the finder had not flagged — i.e. by not trusting the
 * finder — and it meant the sweep's headline scope figure was an undercount.
 *
 * THESE ARE FINDERS, NOT VERDICTS. A hit locates a candidate; a human/agent read against the
 * surrounding code decides. Known false-positive shapes:
 *   - "Used to" meaning "is used to", not change history.
 *   - "has not yet fired this battle" / "decided but has not yet written" — present-tense
 *     temporal contracts, not pending-work claims.
 */

export const CLASSES = {
    // Dead workstream labels. Covers BOTH `SP-4c-2d` (digit) and `SP-U` (letter) forms.
    'workstream-label':
        /\b(SP-[A-Za-z0-9][\w-]*|[Ss]ub-project [A-Z]\b|Task \d+\w*|Tasks \d+[-–]\d+|Phase \d+\w*|D-PR\d+|PR\d+[a-z]?\b|Wave \d+|[Ss]hip-kit W\d+|W\d+ Task|epic PR\d+|epic [A-Z]\d?\b|A2 Task|H\d T\d|C\d[a-z]?[\d-]* T\d|bySide PR\d+|\bW\d\b)/,

    // "This is not wired yet" claims. The single highest-yield class: mid-workstream notes that
    // were never swept when the workstream landed, so they now describe shipped code as pending.
    'pending-claim':
        /\b(not yet|no production reader|unread until|until .* (lands|wires|flips|populates|provides)|no reader until|later task|filled by a later|future\)|TODO|for now|UNWIRED|nothing reads it yet|no consumer reads)/i,

    'history-claim':
        /\b(used to|previously|formerly|no longer|since (SP|PR|D-PR|Task)|was (removed|deleted|added)|pre-Task|extracted from)/i,

    // Diff justification — argues about the CHANGE rather than describing the code. Policy class 1.
    // `byte-identical` / `zero-churn` are review arguments that mean nothing to a later reader.
    // `/i` matters: `Byte-identical` appears capitalised mid-sentence. And match `churn` broadly
    // rather than enumerating `zero-churn|no churn` — `golden churn` escaped that alternation.
    // A hit here is NOT automatically a delete: `churn` also appears in genuine present-tense
    // stability CONTRACTS ("sorted so entry order can never churn a snapshot"), which are keeps.
    'diff-justification': /\b(byte-identical|churn|identical to the pre-)/i,

    // Counts are stale by construction: nobody updates "four" when they add the fifth.
    'count-enum':
        /\b(the (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (and \w+ )?(call )?sites?|site \d+ of|all (two|three|four|five|six) sites|\d+ sites?, not \d+|The (two|three|four|five|six|seven|eight) [a-z-]+ fields)/i,

    'line-pointer': /\b\w+\.ts:\d+|\(~\d{3,}[,)]/,
};
