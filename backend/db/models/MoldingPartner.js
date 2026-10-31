// db/models/MoldingPartner.js — injection-molding suppliers.
// Collection molding_partners. Not the interest-form collection `partners`.
import mongoose from 'mongoose';

const moldingPartnerSchema = new mongoose.Schema({
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  anonLabel: {
    type: String,
    required: true,
    trim: true,
    maxlength: 64,
  },
  // Free text until a region taxonomy is chosen.
  region: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
  },
  active: {
    type: Boolean,
    required: true,
    default: true,
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 5000,
    default: '',
  },
}, {
  timestamps: true,
  collection: 'molding_partners',
});

moldingPartnerSchema.index({ anonLabel: 1 }, { unique: true });
moldingPartnerSchema.index({ active: 1, anonLabel: 1 });
moldingPartnerSchema.index({ displayName: 1 });

const MoldingPartner = mongoose.model('MoldingPartner', moldingPartnerSchema);

export default MoldingPartner;
