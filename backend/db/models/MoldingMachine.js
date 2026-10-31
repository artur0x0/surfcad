// db/models/MoldingMachine.js — presses on a molding partner's floor.
import mongoose from 'mongoose';
import { nonNegativeNumber, percentNumber, positiveNumber } from './moldingNumbers.js';

const moldingMachineSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MoldingPartner',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  tonnage: positiveNumber('tonnage must be greater than 0'),
  platenWidthMm: positiveNumber('platenWidthMm must be greater than 0'),
  platenHeightMm: positiveNumber('platenHeightMm must be greater than 0'),
  tieBarSpacingXMm: positiveNumber('tieBarSpacingXMm must be greater than 0'),
  tieBarSpacingYMm: positiveNumber('tieBarSpacingYMm must be greater than 0'),
  barrelShotCm3: positiveNumber('barrelShotCm3 must be greater than 0'),
  utilizationPct: percentNumber('utilizationPct must be from 0 to 100'),
  // When utilizationPct was last set. updatedAt also moves on other edits.
  utilizationUpdatedAt: {
    type: Date,
    default: null,
  },
  hourlyRateUsd: nonNegativeNumber('hourlyRateUsd must be 0 or greater'),
  active: {
    type: Boolean,
    required: true,
    default: true,
  },
}, {
  timestamps: true,
  collection: 'molding_machines',
});

moldingMachineSchema.index({ partnerId: 1, name: 1 }, { unique: true });
moldingMachineSchema.index({ partnerId: 1, active: 1 });

const MoldingMachine = mongoose.model('MoldingMachine', moldingMachineSchema);

export default MoldingMachine;
