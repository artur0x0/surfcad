// db/models/MoldingResinPrice.js — one price per partner and grade.
import mongoose from 'mongoose';
import { nonNegativeNumber, positiveNumber } from './moldingNumbers.js';

const moldingResinPriceSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MoldingPartner',
    required: true,
  },
  // Stored as entered. "ABS" and "abs" are different grades.
  grade: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  usdPerKg: nonNegativeNumber('usdPerKg must be 0 or greater'),
  densityGCm3: positiveNumber('densityGCm3 must be greater than 0'),
  active: {
    type: Boolean,
    required: true,
    default: true,
  },
}, {
  timestamps: true,
  collection: 'molding_resin_prices',
});

moldingResinPriceSchema.index({ partnerId: 1, grade: 1 }, { unique: true });
moldingResinPriceSchema.index({ partnerId: 1, active: 1 });

const MoldingResinPrice = mongoose.model('MoldingResinPrice', moldingResinPriceSchema);

export default MoldingResinPrice;
