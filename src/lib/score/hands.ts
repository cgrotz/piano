/** One staff of the score, with the part (instrument) it belongs to. */
export interface StaffInfo {
  /** 0-based index across the whole score (OSMD's `Sheet.Staves` order). */
  index: number;
  /** The part's name as written in the file, e.g. "Piano", "Voice", "Фортепиано". */
  partName: string;
  /** Position of this staff within its part (0 = upper). */
  partStaffIndex: number;
  partStaffCount: number;
}

export type HandKind = 'right' | 'left' | 'both' | 'other';

/** A selectable thing to practise: one or more staves graded together. */
export interface HandOption {
  id: string;
  label: string;
  kind: HandKind;
  staves: number[];
  /** Staff to colour as the left hand (both-hands only). */
  leftStaff?: number;
  /** Staves you may play along with without it counting (the other hand). */
  alongStaves: number[];
}

/**
 * Turn the score's staves into practice choices.
 *
 * The keyboard part is the first part with two staves (upper = right hand,
 * lower = left hand), wherever it sits in the score — so a voice + piano song
 * offers Right / Left / Both for the piano rather than grading the vocal line
 * as the "right hand". Any other staves (a vocal line, a second instrument)
 * follow, labelled by their part name. Without a two-staff part, every staff
 * is offered by name.
 */
export function handOptions(staves: StaffInfo[]): HandOption[] {
  if (staves.length <= 1) {
    return [{ id: 'staff-0', label: staves[0]?.partName ?? 'Melody', kind: 'right', staves: [0], alongStaves: [] }];
  }

  const upper = staves.find((s) => s.partStaffCount === 2 && s.partStaffIndex === 0);
  const lower = upper && staves.find((s) => s.partName === upper.partName && s.partStaffIndex === 1 && s.index === upper.index + 1);
  const options: HandOption[] = [];
  if (upper && lower) {
    options.push(
      { id: 'right', label: 'Right', kind: 'right', staves: [upper.index], alongStaves: [lower.index] },
      { id: 'left', label: 'Left', kind: 'left', staves: [lower.index], alongStaves: [upper.index] },
      {
        id: 'both',
        label: 'Both',
        kind: 'both',
        staves: [upper.index, lower.index],
        leftStaff: lower.index,
        alongStaves: []
      }
    );
  }

  for (const s of staves) {
    if (s === upper || s === lower) continue;
    const name = s.partName.trim() || `Staff ${s.index + 1}`;
    const label = s.partStaffCount > 1 ? `${name} ${s.partStaffIndex + 1}` : name;
    options.push({ id: `staff-${s.index}`, label, kind: 'other', staves: [s.index], alongStaves: [] });
  }
  return options;
}
