// db/models/MoldingLead.js — a user asked a molding partner for a number.
// stripePaymentIntentId is an id string only. This model does not call Stripe.
import mongoose from 'mongoose';
import { nonNegativeNumber } from './moldingNumbers.js';

export const MOLDING_LEAD_TYPES = ['firm_quote', 'human_review'];
export const MOLDING_LEAD_STATUSES = ['sent', 'quoted', 'won', 'lost'];

const moldingLeadSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MoldingPartner',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: MOLDING_LEAD_TYPES,
  },
  status: {
    type: String,
    required: true,
    enum: MOLDING_LEAD_STATUSES,
  },
  commissionOwedUsd: {
    ...nonNegativeNumber('commissionOwedUsd must be 0 or greater'),
    default: 0,
  },
  // Quote shape is a later slice. Mixed keeps this document from inventing it.
  budgetaryQuoteSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  stripePaymentIntentId: {
    type: String,
    trim: true,
    maxlength: 255,
    default: '',
  },
  reviewFeePaid: {
    type: Boolean,
    required: true,
    default: false,
  },
}, {
  timestamps: true,
  collection: 'molding_leads',
});

moldingLeadSchema.index({ status: 1, createdAt: -1 });
moldingLeadSchema.index({ partnerId: 1, status: 1 });
moldingLeadSchema.index({ userId: 1, createdAt: -1 });

const MoldingLead = mongoose.model('MoldingLead', moldingLeadSchema);

export default MoldingLead;
