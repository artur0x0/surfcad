// db/models/MoldingResin.js — generic injection-resin properties. No price.
import mongoose from 'mongoose';
import { nonNegativeNumber, percentNumber, positiveNumber } from './moldingNumbers.js';

const BANDS = [
  ['shrinkLowPct', 'shrinkHighPct', 'Shrink'],
  ['wallMinMm', 'wallMaxMm', 'Wall'],
  ['meltTempLowC', 'meltTempHighC', 'Melt temperature'],
  ['moldTempLowC', 'moldTempHighC', 'Mold temperature'],
];

const moldingResinSchema = new mongoose.Schema({
  // Stored as entered. "ABS" and "abs" are different grades.
  grade: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  tensileModulusMpa: positiveNumber('tensileModulusMpa must be greater than 0'),
  shrinkLowPct: percentNumber('shrinkLowPct must be from 0 to 100'),
  shrinkHighPct: percentNumber('shrinkHighPct must be from 0 to 100'),
  wallMinMm: positiveNumber('wallMinMm must be greater than 0'),
  wallMaxMm: positiveNumber('wallMaxMm must be greater than 0'),
  meltTempLowC: nonNegativeNumber('meltTempLowC must be 0 or greater'),
  meltTempHighC: nonNegativeNumber('meltTempHighC must be 0 or greater'),
  moldTempLowC: nonNegativeNumber('moldTempLowC must be 0 or greater'),
  moldTempHighC: nonNegativeNumber('moldTempHighC must be 0 or greater'),
  notes: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  active: {
    type: Boolean,
    required: true,
    default: true,
  },
}, {
  timestamps: true,
  collection: 'molding_resins',
});

moldingResinSchema.pre('validate', function checkBands() {
  for (const [lowKey, highKey, label] of BANDS) {
    const low = this[lowKey];
    const high = this[highKey];
    if (Number.isFinite(low) && Number.isFinite(high) && low > high) {
      this.invalidate(highKey, `${label} low must be less than or equal to high`);
    }
  }
});

moldingResinSchema.index({ grade: 1 }, { unique: true });
moldingResinSchema.index({ active: 1, grade: 1 });

const MoldingResin = mongoose.model('MoldingResin', moldingResinSchema);

export default MoldingResin;
