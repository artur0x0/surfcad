// db/models/MoldingToolingRate.js — one rate card per molding partner.
import mongoose from 'mongoose';
import { nonNegativeNumber } from './moldingNumbers.js';

const moldingToolingRateSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MoldingPartner',
    required: true,
  },
  aluminumUsdPerKg: nonNegativeNumber('aluminumUsdPerKg must be 0 or greater'),
  steelUsdPerKg: nonNegativeNumber('steelUsdPerKg must be 0 or greater'),
  aluminumMachiningUsdPerHour: nonNegativeNumber('aluminumMachiningUsdPerHour must be 0 or greater'),
  steelMachiningUsdPerHour: nonNegativeNumber('steelMachiningUsdPerHour must be 0 or greater'),
  baseHoursSimple: nonNegativeNumber('baseHoursSimple must be 0 or greater'),
  coolingLineHoursFactor: nonNegativeNumber('coolingLineHoursFactor must be 0 or greater'),
  slideAdderUsd: nonNegativeNumber('slideAdderUsd must be 0 or greater'),
  lifterAdderUsd: nonNegativeNumber('lifterAdderUsd must be 0 or greater'),
  ejectorPinUsd: nonNegativeNumber('ejectorPinUsd must be 0 or greater'),
  sleeveUsd: nonNegativeNumber('sleeveUsd must be 0 or greater'),
  hotRunnerSuggestionUsd: nonNegativeNumber('hotRunnerSuggestionUsd must be 0 or greater'),
  active: {
    type: Boolean,
    required: true,
    default: true,
  },
}, {
  timestamps: true,
  collection: 'molding_tooling_rates',
});

moldingToolingRateSchema.index({ partnerId: 1 }, { unique: true });

const MoldingToolingRate = mongoose.model('MoldingToolingRate', moldingToolingRateSchema);

export default MoldingToolingRate;
